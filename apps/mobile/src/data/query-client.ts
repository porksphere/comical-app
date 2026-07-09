/**
 * App-wide TanStack Query client + AsyncStorage persistence.
 *
 * This is the caching layer comical-web hand-rolled in `client/app.ts`
 * (in-memory series/list caches, TTL, write-driven invalidation) and its
 * service-worker thumbnail cache, ported to the app: a single keyed cache that
 * every screen reads through so revisiting a series or reopening the reader is
 * instant instead of a fresh network round-trip. Persisting it through
 * AsyncStorage is the equivalent of the web's `localStorage` / SW disk cache —
 * the cache survives an app restart / web reload.
 *
 * Screens still fetch through `useDataSource()` (see `source.ts`); queries only
 * wrap those calls. Query keys carry the real/mock discriminator (see
 * `queries.ts`) so real and mock data never share a cache entry, and the
 * persister's `buster` is keyed off the server URL so pointing at a different
 * backend drops the stale persisted cache.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query';

import { getApiBase, isAbort } from './api';
import { getResolvedModeSync } from './embedded/preference';
import { logDiagnostic } from '@/lib/diagnostics';

// Content (series detail, chapters, lists, pages) is effectively immutable for
// a browsing session, so keep it fresh for a few minutes (no refetch on
// revisit) and retained for a day so it repaints instantly across navigations.
const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — mirrors web's "reuse within session"
const GC_TIME_MS = 24 * 60 * 60 * 1000; // 24 h — kept for the persisted cache's maxAge

/** Message + which query/mutation, for the diagnostics log. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function keyContext(key: unknown): string | undefined {
  if (key == null) return undefined;
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

export const queryClient = new QueryClient({
  // Every query/mutation failure flows through these two caches, so logging here feeds the Settings →
  // Diagnostics window with ALL comical-core failures (bridge scrapes, writes, network) in one place
  // — including ones that fail quietly (a `retry:false` favorite check, a background refetch) with no
  // visible RetryBlock. Error-path only (never on success), and aborts — the constant cancellations
  // from scope switches / unmounts — are skipped, so there's no hot-path or scroll cost.
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (isAbort(error)) return;
      logDiagnostic('query', errMessage(error), { context: keyContext(query.queryKey) });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (isAbort(error)) return;
      logDiagnostic('mutation', errMessage(error), { context: keyContext(mutation.options.mutationKey) });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      gcTime: GC_TIME_MS,
      retry: 1,
      // The app's screens have always fetched on mount and never on focus; keep
      // that behavior (the cache, not focus refetch, is what makes it feel fast).
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/** Persisted-cache backend: AsyncStorage on every platform (localStorage on web). */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'comical:query-cache',
  // The persister re-serializes the WHOLE dehydrated cache (synchronous
  // JSON.stringify, on the JS thread) on its throttle interval whenever anything
  // settles. With big scraped chapter lists cached that was a ~400ms main-thread
  // stall firing ~1×/s (the default 1s throttle). Bump the interval and drop the
  // heaviest keys from what gets persisted (see `shouldDehydrateQuery`) so the
  // serialized blob stays small.
  throttleTime: 3000,
});

// Big, volatile content queries (per-series detail, chapter lists, page-URL
// lists, related rails) stay in the IN-MEMORY cache — so a within-session
// revisit is still instant via `staleTime` — but are excluded from the persisted
// disk cache: writing them was what made the serialize above expensive, and the
// only thing lost is an instant repaint after a full app restart (scraped
// content is re-fetched anyway). The cheap keys (library, history, activity,
// favorites, bridges) still persist.
// `isFavorite` is a slow per-series scrape of the bridge's favorites list (up to 20 pages, see
// host-server router). Persisting it would rehydrate a *stale* ★/☆ on cold start that (a) reads
// as tappable before the true state is known and (b) can land its stale value on top of an
// optimistic toggle, reverting the star while the write actually succeeded. Keep it out of disk
// so it always starts `null` (button disabled) and re-scrapes fresh after a restart.
// `pageThumb` is a per-page lazy scrape (potentially hundreds per long series) — keep it in memory
// for scroll-back within a session, but never write that volume to the AsyncStorage blob.
// `browseGrid` is the Browse screen's infinite-scroll grid (search / "See all" / page-list /
// favorites / Home's terminal section): every `fetchNextPage` appends a page, so as you scroll it
// grows without bound, and — being persisted — each new page scheduled a full-cache re-serialize on
// the 3s throttle (synchronous JSON.stringify on the JS thread over an ever-larger blob), the exact
// stall pattern noted above but paid *while scrolling*. It's volatile scraped content re-fetched on
// mount anyway (same as `seriesList`), so keep it in memory for instant same-session scroll-back via
// `staleTime` but never write it to disk; the only thing lost is an instant grid repaint on cold
// start, which re-fetches page 1 regardless. (`homeSections` stays persisted — it's page 1 only, one
// bounded fetch that gives an instant Home repaint on restart; its pages 2+ live under `browseGrid`.)
const NO_PERSIST_KEYS = new Set([
  'seriesDetail',
  'seriesList',
  'chapterPages',
  'directPages',
  'relatedGroups',
  'isFavorite',
  'pageThumb',
  'browseGrid',
]);

/** Persist only the light keys (see `NO_PERSIST_KEYS`), keeping the default
 *  "successful queries only" rule. */
export function shouldDehydrateQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && !NO_PERSIST_KEYS.has(String(query.queryKey[0]));
}

/** How long a persisted entry is trusted after being written (the disk-cache TTL). */
export const PERSIST_MAX_AGE_MS = GC_TIME_MS;

/**
 * Bumping this drops the whole persisted cache. Keyed off the active transport so switching data
 * sources can't restore another origin's stale data: the on-device embedded runtime and each remote
 * backend URL get disjoint persisted caches. (Resolved at module load from the startup preference;
 * a mid-session swap also clears the cache — see settings.tsx — so the two never mix.)
 */
export const PERSIST_BUSTER = `v2:${getResolvedModeSync() === 'embedded' ? 'embedded' : getApiBase()}`;
