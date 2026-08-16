/**
 * Thin client for the real Comical backend API (`@comical/host-server` — the
 * same server the legacy web app talks to). Mirrors the reference's `k()`
 * fetch wrapper: `${BASE}${path}`, throw on non-2xx with the server's `error`
 * message, return parsed JSON.
 *
 * Base URL resolution order: a Settings-configured override (persisted, user-editable — see
 * `useApiBase`/`setApiBaseOverride` below) beats `EXPO_PUBLIC_COMICAL_SERVER` (inlined by Expo at
 * build time), which beats `DEFAULT_API_BASE` (`http://localhost:3100`, matching the sibling
 * `comical-web` dev server's default port). The Settings row that edits this is hidden while the
 * on-device embedded runtime is enabled, since this value is meaningless there.
 *
 * No credentialed cookies: unlike `comical-web` (reverse-proxied same-origin
 * with its backend in prod, so no CORS involved at all), this app is a
 * standalone client that's cross-origin from the API on every platform and
 * environment — dev, the GH Pages preview, and native. `host-server` defaults
 * to a wildcard CORS origin (`origin: "*"`), which browsers refuse to honor
 * for a `credentials: 'include'` request, so plain unauthenticated requests
 * are what actually works here. If per-user auth is needed later, use the
 * server's bearer-token support (`COMICAL_TOKEN` / `Authorization` header),
 * not cookies.
 *
 * This module returns shapes close to the server's contract. The `Api*` types
 * below are type-only re-exports of `@comical/contract` (imported via a
 * `tsconfig.json` `paths` mapping onto the `external/comical` submodule — see
 * that file). Being type-only, they're erased entirely at build time: no
 * runtime dependency on the `comical` repo, no Metro config, no extra
 * package — the same tsconfig-paths trick `comical-web` already uses for
 * `@comical/host-server`. The submodule needs to be checked out and installed
 * for type-checking/editor support; its absence doesn't affect runtime or the
 * current CI jobs. `source.ts` adapts these into the UI-facing types in
 * `types.ts` — this file has no knowledge of mock data or the UI shapes.
 *
 * The `@comical/*` type imports deliberately sit DOWN the file, each one directly above the section
 * whose shapes it types, rather than collected at the top — the contract is large and split across
 * several packages, and keeping each import beside the block it explains is what makes those blocks
 * readable. That costs `import/first` (and `import/no-duplicates`, where two sections both draw from
 * `@comical/contract`); the arrangement is the point, so both are off for this file only. Erased at
 * build time either way, so position has no runtime meaning here.
 */
/* eslint-disable import/first, import/no-duplicates -- see the note above: contract type imports are filed beside the sections they type. */
import { use$ } from '@legendapp/state/react';

import { getResolvedModeSync } from './embedded/preference';
import type { Bridge, BridgeList } from './types';
import { logDiagnostic } from '@/lib/diagnostics';
import { migrateLegacyKey, persisted$ } from '@/lib/observable';

// JSON-owned key for the Legend State store; the old store wrote a bare URL string
// under `comical:remoteServerUrl`, which we migrate off of once (below).
const SERVER_KEY = 'comical:remoteServer';
const LEGACY_SERVER_KEY = 'comical:remoteServerUrl';

/** Default remote server when nothing else is configured. */
const DEFAULT_API_BASE = 'http://localhost:3100';

/**
 * Runtime-injected backend URL (web only). The static Docker image can't re-bake
 * `EXPO_PUBLIC_COMICAL_SERVER` (Metro inlines it at export time), so the container's entrypoint
 * writes `window.__COMICAL_SERVER__` into every page's <head> from its `COMICAL_SERVER` env var —
 * mirroring `comical-web`'s `window.COMICAL_SERVER` trick. Undefined on native and during static
 * prerender (no `window`), where the baked env / default apply instead.
 */
const RUNTIME_API_BASE: string | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { __COMICAL_SERVER__?: string }).__COMICAL_SERVER__
    : undefined;

/** The runtime-injected / build-time / default base, before any Settings override. */
const BUILT_IN_API_BASE = RUNTIME_API_BASE || process.env.EXPO_PUBLIC_COMICAL_SERVER || DEFAULT_API_BASE;

// The Settings server override, persisted as JSON. Wrapped in an object because a
// persisted *primitive* observable reads back as `{}` before anything is stored,
// whereas an object initial round-trips cleanly; `{ url: null }` means "no override".
type ServerOverride = { url: string | null };
const serverOverride$ = persisted$<ServerOverride>(SERVER_KEY, { url: null });

// Defensive read: the empty / pre-hydration state can surface as `{}` (no `url`),
// so treat a missing field as "no override".
function overrideUrl(): string | null {
  return (serverOverride$.peek() as Partial<ServerOverride>).url ?? null;
}

// One-time migration from the old bare-string key (a raw URL, not JSON). No-ops once a
// value has been set through the new store, so a stale legacy key never wins.
migrateLegacyKey(LEGACY_SERVER_KEY, serverOverride$, (rawUrl) => {
  if (overrideUrl() == null) serverOverride$.set({ url: rawUrl });
});

/** The current effective remote base URL — a Settings override if one is set, else the built-in
 *  (env var or `DEFAULT_API_BASE`). Read this instead of caching the value: it can change at
 *  runtime via the Settings screen. */
export function getApiBase(): string {
  return overrideUrl() ?? BUILT_IN_API_BASE;
}

/** Set (or, with `null`, clear) the user's remote-server override from the Settings screen.
 *  Persisted; trailing slashes are stripped so `${getApiBase()}${path}` never double-slashes.
 *  Callers are responsible for clearing any cached data that assumed the old server (see
 *  `settings.tsx`'s `queryClient.clear()` + `bumpDataEpoch()`). This store owns only the URL
 *  value — the query-cache side of a server switch stays with the caller, keeping the local
 *  preference and the TanStack Query cache cleanly separated. */
export function setApiBaseOverride(url: string | null): void {
  const trimmed = url?.trim().replace(/\/+$/, '') || null;
  serverOverride$.set({ url: trimmed });
}

/** `[effectiveUrl, setOverride]` for the Settings screen's remote-server row. */
export function useApiBase(): [string, (url: string | null) => void] {
  const url = (use$(serverOverride$) as Partial<ServerOverride>).url ?? null;
  return [url ?? BUILT_IN_API_BASE, setApiBaseOverride];
}

export type { Bridge, BridgeList };

/** Manual base64 (no `btoa`/`Buffer` — neither is guaranteed present across Hermes/JSC/QuickJS). */
function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : chars[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : chars[b2 & 0x3f];
  }
  return out;
}

async function responseToDataUri(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

/**
 * Resolves a bridge-supplied asset URL (a sprite sheet, a page image, …) into something an
 * `<Image>` can actually load. The contract documents these as "absolute or server-relative".
 *
 * - Already absolute → passed through unchanged.
 * - Server-relative, remote transport → prefixed with `getApiBase()`, a real network-reachable
 *   server for both the JSON and the follow-up image request.
 * - Server-relative, embedded transport → resolved through the *same in-process transport* that
 *   served the page/series data, not the shared remote server. This isn't just avoiding an extra
 *   hop: some of these routes redirect to (or proxy) a CDN URL that's scoped to whichever
 *   client/session negotiated it. Routing it through the remote server instead means *that*
 *   server's network identity ends up fetching a URL negotiated by *this device* — the CDN can
 *   reject that or hand back an error page, which downloads fine but fails to decode as an image
 *   (indistinguishable from a real network failure without inspecting the actual bytes). A
 *   redirect response resolves to its `Location` header, still a real absolute URL this device can
 *   fetch directly; anything else is read as bytes and handed back as a `data:` URI, since there's
 *   no second URL to hand `<Image>` for a route that proxies bytes rather than redirecting.
 */
export async function resolveAssetSource(url: string): Promise<string> {
  if (!url.startsWith('/')) return url;
  if (getResolvedModeSync() !== 'embedded') return `${getApiBase()}${url}`;
  try {
    const res = await transport(url);
    const location = res.headers.get('Location');
    if (location && res.status >= 300 && res.status < 400) return location;
    if (!res.ok) {
      // Error routes answer with a JSON `{ error }` body; surface it so the diagnostic shows the
      // bridge's real failure reason instead of a bare status (statusText is empty in-process).
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status} ${detail || res.statusText}`.trim());
    }
    return await responseToDataUri(res);
  } catch (e) {
    logDiagnostic('resolve-asset-embedded', (e as Error).message || String(e), { url });
    throw e;
  }
}

/**
 * Per-path memoized `resolveAssetSource`. The reader resolves a page's asset lazily as it scrolls
 * into the render window, and the warm-ahead prefetch resolves the same paths — dedupe so each path
 * costs a single resolve, not several (a resolve can be a rate-limited network round-trip for bridges
 * whose page URLs are lazy resolve-routes). A rejected resolve is evicted so a retry re-runs it;
 * `invalidateAssetSource` lets a caller bust a stale entry (e.g. an expired time-scoped CDN URL)
 * before retrying. Absolute URLs resolve synchronously inside `resolveAssetSource`, so caching them
 * is just a cheap identity map.
 */
const assetResolveCache = new Map<string, Promise<string>>();
/** The SETTLED results of the cache above, readable synchronously — see `peekResolvedAssetSource`.
 *  Same lifetime and eviction as the promise cache. */
const assetResolvedValues = new Map<string, string>();

/**
 * ── THE RESOLVE QUEUE ───────────────────────────────────────────────────────────────────────────
 *
 * A page resolve on the embedded transport is a bridge round-trip, and the bridges that need one
 * answer them STRICTLY SERIALLY — measured on device at almost exactly two per second, whether
 * three are outstanding or forty. So the only thing that decides when a given page appears is where
 * it sits in the order, and until this queue existed the order was "whenever the cell happened to
 * mount", which is the worst possible one: swiping from page 1 to 47 mounts every page on the way,
 * each firing its own resolve, so the page you STOPPED on was the last of forty to be asked for and
 * came back twenty seconds later. Every page you flicked past was fetched ahead of the one you were
 * looking at. That is the "pages never load" — not lost requests, a queue served backwards.
 *
 * Two rules fix the order, and neither is about doing less work:
 *
 *   NEWEST FIRST. The most recently asked-for page is the one nearest the viewport, because that is
 *   what mounting means. A queue drained newest-first tracks where the reader IS; drained
 *   oldest-first it retraces where the reader has been.
 *
 *   FOREGROUND BEFORE WARM. A page that has mounted is on screen or a swipe away; a warm-ahead is a
 *   guess. Guesses wait, and they never get in front of something real.
 *
 * And re-asking BUMPS: `resolveAssetSourceCached` on a URL that is still queued re-stamps it (and
 * promotes a warm to foreground), which is what lets the page you land on overtake the queue it was
 * already sitting in. Without that the dedupe works against us — the visible page doesn't get a
 * request of its own, it inherits the warm's place in line from thirty pages ago.
 *
 * Only requests that actually do I/O are queued (see `resolvesImmediately`): an absolute URL, and
 * every URL at all under the remote transport, is pure string work and must not be made to wait
 * behind a bridge.
 */
const RESOLVE_CONCURRENCY = 3;

type QueuedResolve = {
  url: string;
  background: boolean;
  seq: number;
  /** How many live callers still want this. A mounted page claims one and gives it back when it
   *  unmounts (`releaseAssetResolve`); a warm-ahead claims none, because a guess has no one waiting
   *  on it. At zero, a request that hasn't started yet is dropped — see `releaseAssetResolve`. */
  claims: number;
  start: () => void;
  cancel: () => void;
};

let resolveSeq = 0;
let resolvesRunning = 0;
const resolveQueue = new Map<string, QueuedResolve>();

/** True when `resolveAssetSource` will answer without a round-trip, so queueing it would be pure
 *  latency. Mirrors that function's own first two lines — deliberately, since the whole point is to
 *  keep the free cases out of a queue built for the expensive one. */
function resolvesImmediately(url: string): boolean {
  return !url.startsWith('/') || getResolvedModeSync() !== 'embedded';
}

function pumpResolves(): void {
  while (resolvesRunning < RESOLVE_CONCURRENCY && resolveQueue.size > 0) {
    let next: QueuedResolve | undefined;
    for (const candidate of resolveQueue.values()) {
      if (!next) {
        next = candidate;
      } else if (candidate.background !== next.background) {
        if (!candidate.background) next = candidate;
      } else if (candidate.seq > next.seq) {
        next = candidate;
      }
    }
    if (!next) return;
    resolveQueue.delete(next.url);
    resolvesRunning += 1;
    next.start();
  }
}

/**
 * How many resolves are OUTSTANDING — queued plus running.
 *
 * Queued counts, and counts for more than running does: it is the number of requests standing
 * between a page and its turn. The reader stamps it onto its trace lines and onto the stall it
 * eventually reports, which is what tells a page that was never asked about apart from a page that
 * was asked about fortieth.
 *
 * A plain counter, and no tracing from this module on purpose — the trace lives on Reanimated's
 * shared values, and this file is imported by plain-JS tests that must not have to boot that.
 */
export function assetResolvesInFlight(): number {
  return resolvesRunning + resolveQueue.size;
}

export function resolveAssetSourceCached(url: string, opts?: { background?: boolean }): Promise<string> {
  const background = !!opts?.background;
  const hit = assetResolveCache.get(url);
  if (hit) {
    // Still waiting its turn: re-asking moves it to the head, and a real mount outranks the
    // warm-ahead that may have queued it. This is the line that lets the page under your thumb
    // overtake the thirty pages you swiped past to reach it.
    const queued = resolveQueue.get(url);
    if (queued) {
      queued.seq = (resolveSeq += 1);
      if (!background) {
        queued.background = false;
        queued.claims += 1;
      }
    }
    return hit;
  }

  if (resolvesImmediately(url)) {
    const p = resolveAssetSource(url).then((resolved) => {
      assetResolvedValues.set(url, resolved);
      return resolved;
    });
    assetResolveCache.set(url, p);
    return p;
  }

  const p = new Promise<string>((settle, fail) => {
    const start = () => {
      resolveAssetSource(url).then(
        (resolved) => {
          resolvesRunning -= 1;
          assetResolvedValues.set(url, resolved);
          settle(resolved);
          pumpResolves();
        },
        (e: unknown) => {
          resolvesRunning -= 1;
          assetResolveCache.delete(url);
          fail(e);
          pumpResolves();
        },
      );
    };
    // `cancel` exists for `invalidateAssetSource`, which drops the cache entry so the next ask
    // re-runs — and a queued entry dropped without settling its promise is a page that waits
    // forever, which is the exact failure this queue is here to end.
    const cancel = () => fail(new Error('resolve cancelled'));
    resolveQueue.set(url, { url, background, seq: (resolveSeq += 1), claims: background ? 0 : 1, start, cancel });
  });
  assetResolveCache.set(url, p);
  pumpResolves();
  return p;
}

/**
 * Retire queued warm-ahead requests that a newer guess has superseded.
 *
 * A warm holds no claim, so nothing else ever drops one — and without this they accumulate: every
 * place the reader pauses leaves its window queued behind the current one, and with a deep
 * `prefetchAhead` that is a dozen pages a stop. They are background, so they never delay a page
 * being read, but they are still round-trips for pages the reader has since left, and the bridge
 * would work through all of them. There is only ever ONE live guess about where reading is going;
 * this makes that literally true.
 *
 * `keep` is the new window. Anything background and queued outside it is dropped — never anything
 * a page has claimed, which is no longer a guess whatever queued it first.
 */
export function supersedeBackgroundResolves(keep: ReadonlySet<string>): void {
  for (const queued of [...resolveQueue.values()]) {
    if (!queued.background || queued.claims > 0 || keep.has(queued.url)) continue;
    resolveQueue.delete(queued.url);
    assetResolveCache.delete(queued.url);
    queued.cancel();
  }
}

/**
 * Give back the claim a mounted page took, and DROP the request if nobody else wants it.
 *
 * Reordering the queue was only half of what a swipe through forty pages needed. Every page it
 * passes mounts, asks, and unmounts again — and an unmounted page's request used to sit in the
 * queue and get served anyway, which on a bridge that answers by proxying the bytes back means
 * downloading forty full-size images nobody is going to look at, at two per second, for a minute
 * after the swipe ended. Reading the queue from the correct end fixes WHEN the page you stopped on
 * arrives; this is what stops the other thirty-nine being fetched at all.
 *
 * Only a request that hasn't STARTED can be dropped — one already at the bridge is left to finish,
 * and there are at most three of those. A warm-ahead is never dropped this way: it holds no claim,
 * so it has none to give back, and it stays at the back of the queue where it belongs.
 */
export function releaseAssetResolve(url: string): void {
  const queued = resolveQueue.get(url);
  if (!queued || queued.claims <= 0) return;
  queued.claims -= 1;
  if (queued.claims > 0) return;
  resolveQueue.delete(url);
  // The cache entry goes too, so a page that comes back asks again — and asks as the NEWEST
  // request, which is exactly the priority a page being returned to should have.
  assetResolveCache.delete(url);
  queued.cancel();
}

/**
 * The resolution of `url` if it's knowable RIGHT NOW, without awaiting anything — else `undefined`.
 *
 * `resolveAssetSourceCached` is promise-only, so a component rendering an asset it (or another
 * component) already resolved still had to learn the answer from an effect, i.e. a commit late. For
 * a recycled `<Image>` that lateness is visible: the view is handed a new `recyclingKey` paired with
 * the PREVIOUS item's URI, paints that (it's in the image cache, so instantly), and then gets the
 * right URI under an unchanged recycling key — which expo-image treats as a cross-fade from the old
 * bitmap rather than a reset, so the old cover lingers until the new one decodes. Peeking
 * synchronously during render keeps the key and the URI in the same commit.
 *
 * An absolute URL (the overwhelmingly common case) resolves to itself — no map lookup even needed.
 */
export function peekResolvedAssetSource(url: string): string | undefined {
  if (!url.startsWith('/')) return url;
  return assetResolvedValues.get(url);
}

/** Drop a cached resolution so the next `resolveAssetSourceCached` re-runs it (retry after a stale/
 *  expired resolved URL fails to load). */
export function invalidateAssetSource(url: string): void {
  const queued = resolveQueue.get(url);
  if (queued) {
    resolveQueue.delete(url);
    queued.cancel();
  }
  assetResolveCache.delete(url);
  assetResolvedValues.delete(url);
}

/**
 * The transport every helper in this module goes through. `path` is a server-relative path like
 * `/bridges/x/search?q=…`; the transport returns a `Response` exactly as `fetch` would.
 *
 * The default `remoteTransport` is a bare `fetch` against `getApiBase()` — behavior-identical to
 * how this file worked before. On iOS/Android an *embedded* transport (see `./embedded`) can be
 * installed with `setTransport()` to resolve the same paths against an on-device bridge runtime
 * (the reused `@comical/host-server` router driving proxy bridges in a native JS engine) instead
 * of hitting an external URI. Everything above this module — `source.ts`, react-query, screens —
 * is unchanged regardless of which transport is active, so remote↔embedded is a one-call swap.
 */
export type Transport = (path: string, init?: RequestInit) => Promise<Response>;

/** The default transport: plain HTTP against `getApiBase()`. */
export const remoteTransport: Transport = (path, init) => fetch(`${getApiBase()}${path}`, init);

let transport: Transport = remoteTransport;

/** Swap the active transport. Passing `null` restores the remote HTTP transport. */
export function setTransport(next: Transport | null): void {
  transport = next ?? remoteTransport;
}

/** True for an aborted-request error, so callers can ignore unmount cancels. */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Like `fetchJson`, but resolves `null` on a 404 instead of throwing — for endpoints that are
 *  only mounted when an optional server capability (trackers, registries) is enabled. Hono's
 *  default not-found response is plain text, not JSON, for routes that were never registered. */
async function fetchJsonOptional<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const res = await transport(path, { signal });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** GET /bridges → the installed bridges (id, display name, nsfw, capabilities, icon). */
export async function getBridges(signal?: AbortSignal): Promise<Bridge[]> {
  const raw = await fetchJson<{ info: Bridge & { iconUrl?: string } }[]>('/bridges', signal);
  return raw.map((b) => ({
    id: b.info.id,
    name: b.info.name,
    nsfw: b.info.nsfw ?? false,
    capabilities: b.info.capabilities ?? [],
    cardSubtitles: b.info.cardSubtitles ?? false,
    thumbnail: b.info.iconUrl,
  }));
}

/** One entry of the raw `GET /bridges` response — unlike `getBridges()` above (which discards
 *  everything but the browse-card fields), this keeps `configured`/`missingRequired`/`source`/
 *  `availableVersion` for the Settings screen's bridge rows (status badges, Uninstall visibility
 *  for `source === "registry"`), without an extra per-bridge fetch. */
export interface BridgeSummary {
  info: Bridge & { iconUrl?: string };
  configured: boolean;
  missingRequired: string[];
  source: 'local' | 'registry';
  availableVersion?: string;
  /** Installed but no longer offered by its registry (dropped from the index) — kept working from
   *  its pinned bundle. The Settings screen surfaces a "no longer offered" badge. */
  discontinued?: boolean;
}

/** GET /bridges → the raw per-bridge summaries (see `BridgeSummary`), for the Settings screen. */
export function getBridgeSummaries(signal?: AbortSignal): Promise<BridgeSummary[]> {
  return fetchJson('/bridges', signal);
}

/** GET /bridges/{id}/lists → the bridge's browse lists (home rails + pages). */
export function getBridgeLists(id: string, signal?: AbortSignal): Promise<BridgeList[]> {
  return fetchJson<BridgeList[]>(`/bridges/${encodeURIComponent(id)}/lists`, signal);
}

// ─── @comical/contract shapes (type-only, erased at build — see header) ─────

import type {
  SeriesEntry as ApiSeriesEntry,
  TagGroup as ApiTagGroup,
  RelatedSeriesGroup as ApiRelatedGroup,
  SeriesInfo as ApiSeriesInfo,
  Chapter as ApiChapter,
  PageThumbnail as ApiPageThumbnail,
  Page as ApiPage,
  FilterIncludeExclude as ApiFilterIncludeExclude,
  FilterValue as ApiFilterValue,
  Filter as ApiFilter,
  SortOption as ApiSortOption,
  SortSelection as ApiSortSelection,
  Tag as ApiTag,
  Cursor,
  PagedResults,
} from '@comical/contract';

export type {
  ApiSeriesEntry,
  ApiTagGroup,
  ApiRelatedGroup,
  ApiSeriesInfo,
  ApiChapter,
  ApiPageThumbnail,
  ApiPage,
  ApiFilterIncludeExclude,
  ApiFilterValue,
  ApiFilter,
  ApiSortOption,
  ApiSortSelection,
  ApiTag,
  Cursor,
  PagedResults,
};

/**
 * Query options a bridge accepts on a list/search fetch — filters + sort, plus
 * an optional free-text `query` for the list endpoint's scoped-search case
 * (`GET /bridges/:id/lists/:listId?q=...`, used when the active list is
 * `searchable` instead of always hitting `/search`).
 */
export type QueryOptions = { query?: string; filters?: ApiFilterValue[]; sort?: ApiSortSelection };

/**
 * Query string for a paged list/search read. The `cursor` is the bridge's own opaque resume token,
 * handed back verbatim — nothing on this side decodes or increments it, so no code here has to know
 * whether the source behind it pages by number, offset, or continuation token. Omitted entirely for
 * the first read: absence of a cursor is what "start at the beginning" means.
 */
function queryParamsFor(cursor: Cursor | undefined, opts?: QueryOptions): URLSearchParams {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (opts?.query) qs.set('q', opts.query);
  if (opts?.filters?.length) qs.set('filters', JSON.stringify(opts.filters));
  if (opts?.sort) {
    qs.set('sort', opts.sort.key);
    qs.set('dir', opts.sort.ascending ? 'asc' : 'desc');
  }
  return qs;
}

/** GET /bridges/{id}/lists/{listId} → one page of a browsable list's series. */
export function getSeriesListItems(
  bridgeId: string,
  listId: string,
  cursor?: Cursor,
  opts?: QueryOptions,
  signal?: AbortSignal,
): Promise<PagedResults<ApiSeriesEntry>> {
  const qs = queryParamsFor(cursor, opts);
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/lists/${encodeURIComponent(listId)}?${qs}`, signal);
}

/** GET /bridges/{id}/search → one page of search results for a free-text query. */
export function searchBridge(
  bridgeId: string,
  query: string,
  cursor?: Cursor,
  opts?: QueryOptions,
  signal?: AbortSignal,
): Promise<PagedResults<ApiSeriesEntry>> {
  const qs = queryParamsFor(cursor, opts);
  qs.set('q', query);
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/search?${qs}`, signal);
}

/** GET /bridges/{id}/filters → the filter controls this bridge advertises (capability "filters"). */
export function getFilters(bridgeId: string, signal?: AbortSignal): Promise<ApiFilter[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/filters`, signal);
}

/** GET /bridges/{id}/sort → the sort keys this bridge advertises (capability "sort"). */
export function getSortOptions(bridgeId: string, signal?: AbortSignal): Promise<ApiSortOption[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/sort`, signal);
}

/** GET /bridges/{id}/tags?q= → tags matching a query, for a tag-multiselect filter's live search. */
export function getTags(bridgeId: string, query: string, signal?: AbortSignal): Promise<ApiTag[]> {
  const qs = new URLSearchParams({ q: query });
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/tags?${qs}`, signal);
}

// ─── Favorites (capability "favorites") ──────────────────────────────────────

/** GET /bridges/{id}/favorites → one page of the user's favorited series. */
export function getFavorites(bridgeId: string, cursor?: Cursor, signal?: AbortSignal): Promise<PagedResults<ApiSeriesEntry>> {
  const qs = queryParamsFor(cursor);
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/favorites?${qs}`, signal);
}

/** GET /bridges/{id}/favorites/{seriesId} → whether a series is currently favorited. */
export async function isFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetchJson<{ favorited: boolean }>(
    `/bridges/${encodeURIComponent(bridgeId)}/favorites/${encodeURIComponent(seriesId)}`,
    signal,
  );
  return res.favorited;
}

async function fetchOk(path: string, method: 'PUT' | 'POST' | 'DELETE', signal?: AbortSignal): Promise<void> {
  const res = await transport(path, { method, signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
}

/** PUT /bridges/{id}/favorites/{seriesId} → add a series to favorites. */
export function addFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/bridges/${encodeURIComponent(bridgeId)}/favorites/${encodeURIComponent(seriesId)}`, 'PUT', signal);
}

/** DELETE /bridges/{id}/favorites/{seriesId} → remove a series from favorites. */
export function removeFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/bridges/${encodeURIComponent(bridgeId)}/favorites/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** GET /bridges/{id}/series/{seriesId} → full series detail. */
export function getSeriesDetail(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiSeriesInfo> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/related → related-series rails for bridges that
 * advertise capability "related-series" and so omit `relatedSeriesGroups` from the main detail
 * response, providing it via this separate endpoint instead. Always safe to call: the server returns
 * `[]` immediately for bridges that don't implement it, with no upstream fetch. */
export function getRelatedSeries(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiRelatedGroup[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/related`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/chapters → the series' chapter list. */
export function getChapters(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiChapter[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/chapters`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/chapters/{chapterId}/pages → readable pages for one chapter. */
export function getChapterPages(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<ApiPage[]> {
  return fetchJson(
    `/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
    signal,
  );
}

/** GET /bridges/{id}/series/{seriesId}/pages → readable pages for a direct (chapterless) series. */
export function getSeriesPages(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiPage[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/pages`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/page-thumb/{pageIndex} → lazy per-page thumbnail, for a
 * page a list/pages response didn't already carry `thumbnail` inline for. 404s ("not supported")
 * throw like any other error — callers should treat that as "no thumbnail available". */
export function getPageThumb(
  bridgeId: string,
  seriesId: string,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<ApiPageThumbnail> {
  return fetchJson(
    `/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/page-thumb/${pageIndex}`,
    signal,
  );
}

// ─── Downloads (offline manifest) ───────────────────────────────────────────────
//
// These drive the optional `/downloads*` endpoints the reused router mounts when a Downloads service
// is present (on-device via host-rn's embedded runtime; on a remote server if it enables the module).
// The bytes are owned by whichever HOST runs the download engine: embedded mode writes them to this
// device's filesystem (`downloads/blob-store.ts`, served to `<Image>` as `file://` URIs), remote mode
// stores them server-side (served back via `/downloads/.../pages/:i/file`). Types are erased at build.

import type { DownloadedChapter, DownloadedPage, DownloadedSeries, DownloadPrefs, StorageUsage } from '@comical/downloads';

/** The body posted to enqueue a chapter: the series snapshot + chapter meta. `pages` is optional —
 *  an engine-backed host (embedded or a current server) resolves the page list via its own bridge;
 *  supplying it explicitly is the manifest-only back-compat path. */
export interface DlEnqueueChapterBody {
  title: string;
  thumbnailUrl?: string;
  author?: string;
  chapterName?: string;
  number?: number;
  languageCode?: string;
  pages?: { index: number; sourceUrl: string; headers?: Record<string, string> }[];
}

const dlBase = (bridgeId: string, seriesId: string) =>
  `/downloads/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`;

/** GET /downloads → the storage-usage tree (total bytes + series → chapters). */
export function dlStorageUsage(signal?: AbortSignal): Promise<StorageUsage> {
  return fetchJson('/downloads', signal);
}

/** GET /downloads/pending → chapters still needing bytes (the engine's work queue). */
export function dlPendingChapters(signal?: AbortSignal): Promise<DownloadedChapter[]> {
  return fetchJson('/downloads/pending', signal);
}

/** GET /downloads/prefs → download preferences (wifiOnly / background). */
export function dlGetPrefs(signal?: AbortSignal): Promise<DownloadPrefs> {
  return fetchJson('/downloads/prefs', signal);
}

/** PUT /downloads/prefs → update preferences (partial merge server-side). */
export function dlSetPrefs(prefs: Partial<DownloadPrefs>): Promise<DownloadPrefs> {
  return fetchPut('/downloads/prefs', prefs);
}

/** GET one series' manifest (snapshot + chapters), or null when nothing is downloaded for it. */
export function dlGetSeries(
  bridgeId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<{ series: DownloadedSeries; chapters: DownloadedChapter[] } | null> {
  return fetchJsonOptional(dlBase(bridgeId, seriesId), signal);
}

/** POST enqueue a chapter for download. */
export function dlEnqueueChapter(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  body: DlEnqueueChapterBody,
): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}`, body);
}

/** POST bulk-enqueue many chapters of one series in a single request. The host records the whole
 *  queue as instant manifest writes (page lists resolve lazily at download time), so a 300-chapter
 *  "download all" lands atomically — closing the app mid-request can no longer strand the tail. */
export function dlEnqueueChapters(
  bridgeId: string,
  seriesId: string,
  body: {
    title: string;
    thumbnailUrl?: string;
    author?: string;
    chapters: { chapterId: string; chapterName?: string; number?: number; languageCode?: string }[];
  },
): Promise<{ chapters: DownloadedChapter[] }> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters`, body);
}

/** POST record one downloaded page's on-disk file + byte size. */
export function dlRecordPage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  index: number,
  file: string,
  bytes: number,
): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages/${index}`, { file, bytes });
}

/** POST mark one page failed (the client gave up fetching it) — surfaces the chapter as failed. */
export function dlFailPage(bridgeId: string, seriesId: string, chapterId: string, index: number): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages/${index}/fail`, {});
}

/** GET the ordered manifest page list for a chapter (the offline page-LIST fallback). */
export function dlManifestPages(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<DownloadedPage[]> {
  return fetchJson(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages`, signal);
}

/** POST re-queue the missing pages of a partial/failed chapter (resumable retry). */
export function dlRequeue(bridgeId: string, seriesId: string, chapterId: string): Promise<DownloadedPage[]> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/requeue`, {});
}

/** POST pause (cancel) a chapter — stops draining, keeps downloaded pages. */
export function dlPauseChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pause`, {});
}

/** POST resume a paused chapter — back to queued. */
export function dlResumeChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/resume`, {});
}

/** POST pause (cancel) every not-yet-complete chapter of a series. */
export function dlPauseSeries(bridgeId: string, seriesId: string): Promise<{ ok: true }> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/pause`, {});
}

/** POST resume every paused chapter of a series. */
export function dlResumeSeries(bridgeId: string, seriesId: string): Promise<{ ok: true }> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/resume`, {});
}

/** DELETE one chapter → the blob `files` to remove. */
export function dlDeleteChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<{ files: string[] }> {
  return fetchDelete(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}`);
}

/** DELETE one series → the blob `files` to remove. */
export function dlDeleteSeries(bridgeId: string, seriesId: string): Promise<{ files: string[] }> {
  return fetchDelete(dlBase(bridgeId, seriesId));
}

/** DELETE everything → all blob `files` to remove. */
export function dlDeleteAll(): Promise<{ files: string[] }> {
  return fetchDelete('/downloads');
}

// ─── Settings + registries ────────────────────────────────────────────────────
//
// `SettingDescriptor`/`SettingOption`/`SettingValue` come from `@comical/contract` (see header).
// `RegistryBridgeEntry`/`RegistryTrackerEntry`/`SavedRegistry` come from `@comical/registry`, via
// a *second* type-only tsconfig mapping pointed at that package's `schema.ts` specifically (not
// its `index.ts`) — `index.ts` re-exports `manager.ts`/`manifest.ts`, which do real Node file I/O
// (`node:fs/promises`, `node:path`) to download/cache bridge bundles. There's no `@types/node`
// anywhere reachable from this app's TS program (confirmed empirically: pointing the mapping at
// `index.ts` breaks `tsc --noEmit` with "Cannot find name 'node:fs/promises'"), so `schema.ts`
// (pure zod-inferred data shapes, only depends on `zod`) is the only safe target. `AvailableBridge`/
// `AvailableTracker`/`InstallResult` — the three shapes `RegistryManager`'s browse/install/update
// methods return — live in `manager.ts` itself, not `schema.ts`, so they're hand-defined below
// instead of imported; they're tiny (3-4 fields) and just wrap the imported entry types.

import type { BridgeInfo as ApiBridgeInfo, ContentRating, SettingDescriptor, SettingOption, SettingValue } from '@comical/contract';
import type { RegistryBridgeEntry, RegistryTrackerEntry, SavedRegistry } from '@comical/registry';
// The local-library model — the user's own collection + reading progress, spanning every bridge.
// Type-only re-exports of `@comical/library` (mapped in tsconfig.json to the sibling package's
// source, erased at build time like the `@comical/contract`/`@comical/registry` types above). These
// are the exact shapes the `/library*` REST routes serialize, so no per-field adapter is needed.
import type {
  ActivityItemView as ApiActivityItem,
  ChapterProgress as ApiChapterProgress,
  HistoryItem as ApiHistoryItem,
  LibraryEntryView as ApiLibraryEntry,
  Collection as ApiCollection,
  CollectionItem as ApiCollectionItem,
  CollectionPageItem as ApiCollectionPageItem,
} from '@comical/library';

export type {
  ApiBridgeInfo,
  ContentRating,
  SettingDescriptor,
  SettingOption,
  SettingValue,
  RegistryBridgeEntry,
  RegistryTrackerEntry,
  SavedRegistry,
  ApiActivityItem,
  ApiChapterProgress,
  ApiHistoryItem,
  ApiLibraryEntry,
  ApiCollection,
  ApiCollectionItem,
  ApiCollectionPageItem,
};

/** GET /bridges/{id} response — settings form data for one bridge. `info` is the bridge's full
 *  self-description (capabilities, version, contract version, languages, rate limit — everything
 *  `GET /bridges` trims down to the browse-card fields in `Bridge`), not the app's local `Bridge`
 *  UI type. */
export interface BridgeSettingsInfo {
  info: ApiBridgeInfo;
  settings: SettingDescriptor[];
  values: Record<string, SettingValue>;
  /** Keys of secret fields that already have a stored value (never the value itself). */
  secretsSet: string[];
  missingRequired: string[];
  configured: boolean;
  /** Reserved, host-managed tag exclusions (capability "exclude-tags") — ids the bridge's lists/
   *  search hide series carrying. Separate from `settings`/`values` since it bypasses the
   *  descriptor-driven form (see `PUT /bridges/{id}/excluded-tags`). */
  excludedTags: string[];
  /** Id → display label for `excludedTags`, folded in by the host from its tag-name cache. */
  excludedTagLabels: Record<string, string>;
  /** Reserved, host-managed content-rating ceiling (capability "content-rating"); `null` = no
   *  limit. Entries above it are redacted the same way as tag exclusions — see `MAX_CONTENT_RATING_KEY`. */
  maxContentRating: ContentRating | null;
}

/** GET/PUT /library/bridges/{id}/prefs response. */
export interface BridgePrefs {
  bridgeId: string;
  trackersDisabled: boolean;
  historyDisabled: boolean;
}

/** The bare per-tracker identity, nested under `info` in both list and detail responses. */
export interface TrackerInfo {
  id: string;
  name: string;
  capabilities: string[];
}

/** GET /trackers → one entry per mounted tracker (mirrors `BridgeSummary`'s shape). */
export interface TrackerSummary {
  info: TrackerInfo;
  configured: boolean;
  missingRequired: string[];
  /** `registry`-installed trackers can be uninstalled (swipe-to-delete on the Trackers list); a
   *  `local` (server-built) one can't. Mirrors `BridgeSummary.source`. */
  source: 'local' | 'registry';
}

/** GET /trackers/{id}/settings response. */
export interface TrackerSettingsInfo {
  info: TrackerInfo;
  settings: SettingDescriptor[];
  values: Record<string, SettingValue>;
  secretsSet: string[];
}

/** A series-to-tracker link (mirrors `@comical/library`'s `TrackerLink` — the server never stores
 *  the catalog title, only the id + progress the tracker itself reports back). */
export interface ApiTrackerLink {
  trackerId: string;
  externalId: string | number;
  status?: string;
  chaptersRead?: number;
  lastSyncAt?: number;
}

/** One `GET /trackers/{id}/search` result — a catalog entry the "+ Link tracker" form can link to. */
export interface ApiTrackerSearchResult {
  externalId: string | number;
  title: string;
  thumbnailUrl?: string;
}

/** Mirrors `RegistryManager.checkUpdates()`/`checkTrackerUpdates()`'s element shape. */
export interface RegistryUpdateInfo {
  id: string;
  installedVersion: string;
  availableVersion: string;
}

/** Mirrors `RegistryManager.browse()`'s element shape (`AvailableBridge`, defined in `manager.ts`,
 *  which this app can't type-import — see header). */
export interface AvailableBridge {
  entry: RegistryBridgeEntry;
  registryUrl: string;
  installedVersion: string | null;
  updateAvailable: boolean;
  /**
   * Whether this build can actually load the entry's `contractVersion` — the registry refuses to
   * install it otherwise, and withholds `updateAvailable`. Optional because a host-server older than
   * that guard doesn't send it, and a missing value must not read as "incompatible" and disable
   * every install; treat only an explicit `false` as a refusal.
   */
  compatible?: boolean;
}

/** Mirrors `RegistryManager.browseTrackers()`'s element shape (`AvailableTracker`). */
export interface AvailableTracker {
  entry: RegistryTrackerEntry;
  registryUrl: string;
  installedVersion: string | null;
  updateAvailable: boolean;
  /** See `AvailableBridge.compatible`. */
  compatible?: boolean;
}

/** Mirrors `RegistryManager.install()`/`update()`/`installTracker()`/`updateTracker()`'s
 *  return shape (`InstallResult`). */
export interface InstallResult {
  id: string;
  version: string;
  bundlePath: string;
}

async function fetchPut<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** DELETE returning a JSON body (the downloads delete routes hand back the blob `files` to remove). */
async function fetchDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, { method: 'DELETE', signal });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** GET /bridges/{id} → settings form data for one bridge. */
export function getBridgeSettings(bridgeId: string, signal?: AbortSignal): Promise<BridgeSettingsInfo> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}`, signal);
}

/** PUT /bridges/{id}/settings → persist a settings patch. Omit a secret key to keep its
 *  existing stored value (the server merges the patch onto current settings). */
export function putBridgeSettings(
  bridgeId: string,
  values: Record<string, SettingValue>,
  signal?: AbortSignal,
): Promise<{ settings: Record<string, SettingValue> }> {
  return fetchPut(`/bridges/${encodeURIComponent(bridgeId)}/settings`, values, signal);
}

/** PUT /bridges/{id}/excluded-tags → replace the bridge's persistent tag exclusions (capability
 *  "exclude-tags"). `labels` seeds the host's id→label cache with names the client already knows
 *  so a later reload folds them back in without a `getTags` round-trip. */
export function putExcludedTags(
  bridgeId: string,
  tags: string[],
  labels: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ excludedTags: string[]; excludedTagLabels: Record<string, string> }> {
  return fetchPut(`/bridges/${encodeURIComponent(bridgeId)}/excluded-tags`, { tags, labels }, signal);
}

/** PUT /bridges/{id}/max-content-rating → set (or clear via `null`) the bridge's persistent
 *  content-rating ceiling (capability "content-rating"). */
export function putMaxContentRating(
  bridgeId: string,
  rating: ContentRating | null,
  signal?: AbortSignal,
): Promise<{ maxContentRating: ContentRating | null }> {
  return fetchPut(`/bridges/${encodeURIComponent(bridgeId)}/max-content-rating`, { rating }, signal);
}

/** GET /library/bridges/{id}/prefs → per-bridge library prefs (tracker sync / history opt-out),
 *  or `null` when this server has no library store mounted. */
export function getBridgePrefs(bridgeId: string, signal?: AbortSignal): Promise<BridgePrefs | null> {
  return fetchJsonOptional(`/library/bridges/${encodeURIComponent(bridgeId)}/prefs`, signal);
}

/** PUT /library/bridges/{id}/prefs → update per-bridge library prefs. */
export function putBridgePrefs(
  bridgeId: string,
  update: { trackersDisabled?: boolean; historyDisabled?: boolean },
  signal?: AbortSignal,
): Promise<void> {
  return fetchPut(`/library/bridges/${encodeURIComponent(bridgeId)}/prefs`, update, signal);
}

// ─── Local library / history / activity (optional — a `null`/404 means no library store) ────────
//
// Unlike bridge `favorites` (a per-bridge backend feature), this is the host's own cross-bridge
// library: entries keyed by `(bridgeId, seriesId)`, reading progress, a resume-able history, and an
// "activity" feed of newly-detected chapters. Mounted only when the server (or the on-device
// embedded runtime) has a library store — `getLibrary` returns `null` in that absence so screens can
// show a "needs a library" state instead of an error, mirroring `getBridgePrefs`/`getTrackers`.

/** How to sort the library grid — maps 1:1 to the `/library?sort=` query param. */
export type LibrarySort = 'added' | 'title' | 'lastRead' | 'unread';

/** GET /library → the user's library entries (with derived `unreadCount`), or `null` when no library
 *  store is mounted. `q` scopes to a title search; `sort` orders the grid; `collectionId`/
 *  `uncollected` filter by collection membership (mutually exclusive — `uncollected` wins if both
 *  are set). The host resolves membership by joining series items, so the grid never needs to
 *  read memberships client-side. */
export function getLibrary(
  opts: { q?: string; sort?: LibrarySort; collectionId?: string; uncollected?: boolean } = {},
  signal?: AbortSignal,
): Promise<ApiLibraryEntry[] | null> {
  const qs = new URLSearchParams();
  if (opts.q) qs.set('q', opts.q);
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.uncollected) qs.set('uncollected', 'true');
  else if (opts.collectionId) qs.set('collection', opts.collectionId);
  const query = qs.toString();
  return fetchJsonOptional(`/library${query ? `?${query}` : ''}`, signal);
}

// ─── Collections ─────────────────────────────────────────────────────────────
// User-defined groupings (e.g. "Reading"). These replaced the library's custom lists: a collection
// groups ITEMS (series/chapter/page), so membership no longer lives on the library entry — a series
// belongs to a collection by way of a SERIES ITEM pointing at it (see below). An item exists ONLY
// as a member: empty memberships removes it. All require a mounted library store; with none the
// routes 404 (getCollections maps that to `[]`).

/** GET /library/collections → the user's collections (ascending `order`), or `[]` with no library store. */
export async function getCollections(signal?: AbortSignal): Promise<ApiCollection[]> {
  return (await fetchJsonOptional<ApiCollection[]>('/library/collections', signal)) ?? [];
}

/** POST /library/collections → create one, returning it with its assigned id/order. */
export function createCollection(name: string, signal?: AbortSignal): Promise<ApiCollection> {
  return fetchPost('/library/collections', { name }, signal);
}

/** POST /library/collections/reorder → set the collections' order to `orderedIds`.
 *  Send the WHOLE list: a partial reorder leaves omitted entries on their old `order`, which can
 *  tie with a repositioned one (known, and matching the lists behaviour it replaced). */
export function reorderCollections(orderedIds: string[], signal?: AbortSignal): Promise<unknown> {
  return fetchPost('/library/collections/reorder', { orderedIds }, signal);
}

/** PATCH /library/collections/{id} → rename. */
export function renameCollection(id: string, name: string, signal?: AbortSignal): Promise<unknown> {
  return fetchPatch(`/library/collections/${encodeURIComponent(id)}`, { name }, signal);
}

/** DELETE /library/collections/{id} → delete a collection. The host strips the id from survivors
 *  and REMOVES any item — every type, pages included — whose last membership it was. Callers
 *  needn't strip members, but should expect collected pages to disappear with it unless they were
 *  also filed elsewhere. */
export function deleteCollection(id: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/collections/${encodeURIComponent(id)}`, 'DELETE', signal);
}

/** PUT /library/collected/series/{b}/{s} → the series item itself. Idempotent, and required before
 *  memberships can be set: filing a series is item-then-memberships, replacing the old
 *  `PUT /library/entries/{b}/{s}/lists`. */
export function putSeriesItem(
  bridgeId: string,
  seriesId: string,
  snapshot: { seriesTitle: string; thumbnailUrl?: string; author?: string },
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPut(
    `/library/collected/series/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`,
    snapshot,
    signal,
  );
}

/** DELETE /library/collected/series/{b}/{s} → remove the series item outright.
 *  Equivalent to `setSeriesCollections(…, [])`: with pure collections an item exists only as a
 *  member, so emptying its memberships removes it server-side (that route reports
 *  `{ removed: true }`). Either call is fine; this one doesn't need the item to exist first. */
export function deleteSeriesItem(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(
    `/library/collected/series/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`,
    'DELETE',
    signal,
  );
}

/** PUT /library/collected/series/{b}/{s}/collections → replace a series' memberships. */
export function setSeriesCollections(
  bridgeId: string,
  seriesId: string,
  collectionIds: string[],
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPut(
    `/library/collected/series/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/collections`,
    { collectionIds },
    signal,
  );
}

/** GET /library/entries/{b}/{s} → whether a series is in the library (404 = not in library). */
export async function isInLibrary(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await transport(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`,
    { signal },
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return true;
}

// ─── Collected page items ────────────────────────────────────────────────────
// Page-level items: one record per (bridgeId, seriesId, chapterId, pageIndex). Addressed by
// COORDINATES throughout — a record's id is derived from them, so a reconcile that relocates a page
// re-keys it and a held id would 404. That's why no route here takes one.

/** How a collected-items listing is scoped. `type` is NOT optional in practice for a page grid:
 *  omitting it returns the mixed union (series/chapter items too). */
export type CollectedItemsQuery = {
  type?: 'series' | 'chapter' | 'page';
  sort?: 'added' | 'series' | 'chapter';
  dir?: 'asc' | 'desc';
  collection?: string;
  series?: string;
  q?: string;
};

/** One page of a freshly-fetched chapter, as handed to `reconcileChapterPages`. Position in the
 *  array IS the page index. Both fields are optional and `contentHash` is EXPECTED to be sparse —
 *  send hashes only for pages whose bytes you already hold, never fetch one to hash it. */
export type ChapterPageRef = { url?: string; contentHash?: string };

/** GET /library/collected → the user's collected items, or `null` when no library store is mounted. */
export function getCollectedItems(
  query: CollectedItemsQuery = {},
  signal?: AbortSignal,
): Promise<ApiCollectionItem[] | null> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
  const s = qs.toString();
  return fetchJsonOptional(`/library/collected${s ? `?${s}` : ''}`, signal);
}

/** GET /library/collected/page/{b}/{s}/{c}/indices → the collected page indices for ONE chapter.
 *  The reader loads this once per chapter open and drives its heart off the result for every page
 *  turn — deliberately not a per-page status check, which would fire a request per turn. Stale
 *  items are excluded, so an index here is always safe to navigate to. */
export async function getChapterPageIndices(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<number[]> {
  return (await fetchJsonOptional<number[]>(collectedPagePath(bridgeId, seriesId, chapterId) + '/indices', signal)) ?? [];
}

/** POST /library/collected/page/{b}/{s}/{c}/reconcile → re-anchor this chapter's collected pages
 *  against the page list the reader just fetched, returning the indices to trust. Repairs items the
 *  source shifted and flags ones it can't place (`stale`), with no extra network fetch. Preferred
 *  over `getChapterPageIndices` whenever the page list is already in hand. */
export function reconcileChapterPages(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pages: ChapterPageRef[],
  signal?: AbortSignal,
): Promise<{ indices: number[]; repaired: number; stale: number }> {
  return fetchPost(collectedPagePath(bridgeId, seriesId, chapterId) + '/reconcile', { pages }, signal);
}

/** PUT /library/collected/page/{b}/{s}/{c}/{i} → collect one page. IDEMPOTENT and MERGING: a
 *  supplied snapshot field wins as the fresher value, an omitted one is PRESERVED, and
 *  `collectedAt`/`collectionIds` carry over. That is what makes the two-PUT hash flow safe — collect
 *  on tap, then PUT `{ seriesTitle, contentHash }` once the hash resolves without losing
 *  `pageCount`, which is reconcile's fallback re-anchor signal. */
export function collectPage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
  snapshot: PageItemSnapshotBody,
  signal?: AbortSignal,
): Promise<ApiCollectionItem> {
  return fetchPut(`${collectedPagePath(bridgeId, seriesId, chapterId)}/${pageIndex}`, snapshot, signal);
}

/** The body `collectPage` takes. `seriesTitle` is required (it is what renders a tile once a bridge
 *  is uninstalled); everything else is best-effort. */
export type PageItemSnapshotBody = {
  seriesTitle: string;
  chapterName?: string;
  pageCount?: number;
  sourceUrl?: string;
  contentHash?: string;
};

/** DELETE /library/collected/page/{b}/{s}/{c}/{i} → remove a collected page outright. */
export function uncollectPage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<void> {
  return fetchOk(`${collectedPagePath(bridgeId, seriesId, chapterId)}/${pageIndex}`, 'DELETE', signal);
}

/** PUT /library/collected/page/{b}/{s}/{c}/{i}/collections → replace a page's memberships.
 *  An EMPTY array removes the item and the route reports `{ removed: true }` instead of it — an
 *  item exists only as a member of something. */
export function setPageCollections(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
  collectionIds: string[],
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPut(
    `${collectedPagePath(bridgeId, seriesId, chapterId)}/${pageIndex}/collections`,
    { collectionIds },
    signal,
  );
}

function collectedPagePath(bridgeId: string, seriesId: string, chapterId: string): string {
  return `/library/collected/page/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterId)}`;
}

/** GET /library/collected?type=series&series={b}:{s} → a series' collection memberships, or `[]`
 *  when it isn't filed anywhere. Replaces reading the old `entry.listIds`, which no longer exists:
 *  memberships live on the series ITEM, not on the library entry — so this is independent
 *  of whether the series is in the library at all. Seeds the collection picker's checkboxes. */
export async function getSeriesCollections(
  bridgeId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const items = await fetchJsonOptional<{ collectionIds?: string[] }[]>(
    `/library/collected?type=series&series=${encodeURIComponent(`${bridgeId}:${seriesId}`)}`,
    signal,
  );
  return items?.[0]?.collectionIds ?? [];
}

/** Display snapshot persisted with a new library entry so it renders offline / after bridge removal. */
export type LibrarySnapshot = { title?: string; thumbnailUrl?: string; author?: string };

/** POST /library/entries → add a series to the library (runtime fills missing snapshot from the bridge). */
export function addLibraryEntry(
  bridgeId: string,
  seriesId: string,
  snap: LibrarySnapshot = {},
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPost('/library/entries', { bridgeId, seriesId, ...snap }, signal);
}

/** DELETE /library/entries/{b}/{s} → remove a series from the library. */
export function removeLibraryEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** GET /library/entries/{b}/{s}/progress → persisted read state for one series' chapters. Safe to
 *  call for any series: a series that isn't in the library just has no progress rows (`[]`), unlike
 *  the write routes below, which 404 without an entry. */
export function getChapterProgress(
  bridgeId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<ApiChapterProgress[]> {
  return fetchJson(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/progress`,
    signal,
  );
}

/** PUT /library/entries/{b}/{s}/progress/{chapterId} → record read progress for a library series
 *  (also updates its last-read resume cache). No-op-safe: the caller fires-and-forgets.
 *
 *  The route branches on `lastPage`: supplying it records a reading POSITION (which auto-marks the
 *  chapter read on the last page), while omitting it sets the read FLAG outright — that's the
 *  "mark as read" path. Send `number` whenever it's known: the host derives the `chaptersRead`
 *  high-water mark it pushes to linked trackers from the recorded chapter numbers, so a mark-read
 *  without one syncs a weaker value. */
export function putChapterProgress(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  update: { read?: boolean; lastPage?: number; pageCount?: number; chapterName?: string; number?: number },
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPut(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/progress/${encodeURIComponent(chapterId)}`,
    update,
    signal,
  );
}

/** POST /library/entries/{b}/{s}/read-up-to → mark every chapter up to and including `chapterId`
 *  read, in reading order. The host does the ordering/language scoping from the `chapters` list it's
 *  given (it keeps no chapter store of its own), so pass the series' full chapter list. */
export function postReadUpTo(
  bridgeId: string,
  seriesId: string,
  chapters: { id: string; name: string; number?: number; languageCode?: string; group?: string }[],
  chapterId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPost(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/read-up-to`,
    { chapters, chapterId },
    signal,
  );
}

/** GET /library/history → recently-read series, newest first (empty when no store). */
export function getHistory(limit?: number, signal?: AbortSignal): Promise<ApiHistoryItem[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return fetchJson(`/library/history${qs}`, signal);
}

/** DELETE /library/history/{b}/{s} → drop a series from reading history. */
export function deleteHistoryEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/history/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** POST /reading-history → record a non-library read into the reading log (with resume page). */
export function recordReadingHistory(
  entry: {
    bridgeId: string;
    seriesId: string;
    title: string;
    thumbnailUrl?: string;
    chapterId?: string;
    chapterName?: string;
    lastPage?: number;
    pageCount?: number;
  },
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPost('/reading-history', { ...entry, lastReadAt: Date.now() }, signal);
}

/** GET /library/activity → the new-chapters feed (each item carries a derived `read`). */
export function getActivity(signal?: AbortSignal): Promise<ApiActivityItem[]> {
  return fetchJson('/library/activity', signal);
}

/** GET /library/activity/count → unread new-chapter count for the tab/app badge. Counts the whole
 *  feed — an item only leaves the count when its chapter is read (or its entry is cleared). */
export function getActivityCount(signal?: AbortSignal): Promise<{ unread: number }> {
  return fetchJson('/library/activity/count', signal);
}

/** POST /library/activity/{b}/{s}/read → mark one series' feed chapters read (the row's swipe
 *  "Mark read"). Union mark-read server-side: it never un-reads, and it leaves the resume
 *  pointer/history alone — dismissing a feed row is not reading. */
export function markActivityRead(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/activity/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/read`, 'POST', signal);
}

/** DELETE /library/activity → empty the new-chapters feed (user "clear" action). */
export function clearActivity(signal?: AbortSignal): Promise<void> {
  return fetchOk('/library/activity', 'DELETE', signal);
}

/** DELETE /library/activity/{b}/{s} → drop one series' entries from the feed (the row's swipe-away,
 *  which coalesces a series' new chapters into a single row and clears them together). */
export function deleteActivityEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/activity/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** GET /library/usage → the bytes the library occupies on the active host (store docs + captured
 *  cover blobs). Null when the host has no library module. */
export function libraryUsage(signal?: AbortSignal): Promise<{ diskBytes: number } | null> {
  return fetchJsonOptional('/library/usage', signal);
}

// ─── Importing a bridge's favorites into the library ─────────────────────────

/** One of a bridge's favorites, classified against the library by the host. */
export interface FavoritesImportCandidate {
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  /** `in-library`: already added FROM THIS BRIDGE, nothing to do. `duplicate`: the same title is
   *  already in the library from ANOTHER bridge, so importing adds a second source. `new`: neither. */
  status: 'new' | 'in-library' | 'duplicate';
  /** Present for `duplicate` — every library entry the title matched (it can match more than one). */
  matches?: { key: string; bridgeId: string; seriesId: string; title: string }[];
}

export interface FavoritesImportPreview {
  items: FavoritesImportCandidate[];
  /** True when the host's page cap stopped the walk, so this isn't the whole favorites list. */
  truncated: boolean;
}

/** One series to import. `linkTo` is the entry key (`bridgeId:seriesId`) of an existing library
 *  entry this is another source for — set it to record the cross-bridge link. */
export interface FavoritesImportItem {
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  linkTo?: string;
}

export interface FavoritesImportResult {
  imported: number;
  skipped: number;
  linked: number;
}

/** GET /library/import/bridges/{id}/favorites/preview → every favorite classified against the
 *  library, for a confirmation dialog. Read-only: nothing is written until the POST below. */
export function getFavoritesImportPreview(
  bridgeId: string,
  signal?: AbortSignal,
): Promise<FavoritesImportPreview> {
  return fetchJson(`/library/import/bridges/${encodeURIComponent(bridgeId)}/favorites/preview`, signal);
}

/** POST /library/import/bridges/{id}/favorites → import the confirmed selection. Passing `items`
 *  imports exactly those (favorites are not re-fetched); omitting it imports everything. */
export function importBridgeFavorites(
  bridgeId: string,
  items?: FavoritesImportItem[],
  signal?: AbortSignal,
): Promise<FavoritesImportResult> {
  return fetchPost(
    `/library/import/bridges/${encodeURIComponent(bridgeId)}/favorites`,
    items ? { items } : {},
    signal,
  );
}

/** Result of a library scan — the counters the UI/notifications care about. */
export interface ApiSyncResult {
  updated: number;
  newChapters: number;
  readSynced: number;
  /** True when the time budget expired before every stale entry was synced. */
  partial: boolean;
}

/** Result of the per-row two-way tracker sync. */
export interface TrackerLinkSyncResult {
  /** False only when neither side had anything to move (nothing local read, nothing on the list). */
  updated: boolean;
  /** Chapters newly marked read locally from the tracker's count (0 on a push). */
  readSynced: number;
  /** True when local was ahead and its count was written to the tracker instead. */
  pushed: boolean;
  /** The winning read count — what both sides are at now. */
  chaptersRead: number;
}

/** POST /library/sync → scan the library for new chapters. Bodyless/optionless calls let the
 *  host's staleness window skip recently-synced entries; `force` re-checks everything (the
 *  user-facing "Check for updates"); `budgetMs`/`trackers: false` keep background runs short. */
export function runBackgroundSync(
  opts: { force?: boolean; budgetMs?: number; trackers?: boolean } = {},
  signal?: AbortSignal,
): Promise<ApiSyncResult> {
  return fetchPost('/library/sync', opts, signal) as Promise<ApiSyncResult>;
}

/** POST /bridges/{id}/update → update a registry-installed bridge to its latest version. */
export function updateBridge(bridgeId: string, signal?: AbortSignal): Promise<InstallResult> {
  return fetchPost(`/bridges/${encodeURIComponent(bridgeId)}/update`, {}, signal);
}

/** DELETE /bridges/{id} → uninstall a registry-installed bridge. */
export function uninstallBridge(bridgeId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/bridges/${encodeURIComponent(bridgeId)}`, 'DELETE', signal);
}

// ─── Trackers (optional server capability — a 404 means no TrackerManager is mounted) ────────

/** GET /trackers → the mounted trackers, or `null` when no `TrackerManager` is mounted on this server. */
export function getTrackers(signal?: AbortSignal): Promise<TrackerSummary[] | null> {
  return fetchJsonOptional('/trackers', signal);
}

/** GET /trackers/{id}/settings → settings form data for one tracker. */
export function getTrackerSettings(trackerId: string, signal?: AbortSignal): Promise<TrackerSettingsInfo> {
  return fetchJson(`/trackers/${encodeURIComponent(trackerId)}/settings`, signal);
}

/** PUT /trackers/{id}/settings → persist a settings patch (same omit-to-keep-secret semantics
 *  as `putBridgeSettings`). */
export function putTrackerSettings(
  trackerId: string,
  values: Record<string, SettingValue>,
  signal?: AbortSignal,
): Promise<{ settings: Record<string, SettingValue> }> {
  return fetchPut(`/trackers/${encodeURIComponent(trackerId)}/settings`, values, signal);
}

/** POST /trackers/{id}/update → update a registry-installed tracker to its latest version. */
export function updateTracker(trackerId: string, signal?: AbortSignal): Promise<InstallResult> {
  return fetchPost(`/trackers/${encodeURIComponent(trackerId)}/update`, {}, signal);
}

/** DELETE /trackers/{id} → uninstall a registry-installed tracker. */
export function uninstallTracker(trackerId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/trackers/${encodeURIComponent(trackerId)}`, 'DELETE', signal);
}

/** GET /trackers/{id}/search?q=&cursor= → catalog search on a tracker (capability "search"), for the
 *  "+ Link tracker" form. */
export function searchTrackerCatalog(
  trackerId: string,
  query: string,
  cursor?: Cursor,
  signal?: AbortSignal,
): Promise<PagedResults<ApiTrackerSearchResult>> {
  const qs = new URLSearchParams({ q: query });
  if (cursor) qs.set('cursor', cursor);
  return fetchJson(`/trackers/${encodeURIComponent(trackerId)}/search?${qs}`, signal);
}

/** POST /trackers/{id}/oauth-start → begin an OAuth round trip for an `oauth-callback` setting
 *  field: the server stashes PKCE/state server-side and returns the provider's `authUrl` to open
 *  in a browser. The server's own `/oauth/callback` completes the exchange and persists the
 *  token blob — this call has no matching "finish" endpoint on the client. */
export function startTrackerOAuth(
  trackerId: string,
  key: string,
  settings?: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ authUrl: string }> {
  return fetchPost(`/trackers/${encodeURIComponent(trackerId)}/oauth-start`, { key, settings }, signal);
}

/** GET /oauth/callback → complete an in-flight `oauth-callback` round trip through the *active*
 *  transport. Only the embedded (on-device) Connect flow calls this directly: there's no real
 *  server to redirect to on-device, so the app intercepts the provider's redirect itself
 *  (`openAuthSessionAsync`'s native redirect detection) and finishes the exchange by hitting this
 *  same route through the in-process router instead. Remote mode never calls this — the OS browser
 *  navigates to the server's own `/oauth/callback` directly. The route renders an HTML page (meant
 *  for a real browser tab), not JSON, so this only checks the response status. */
export async function completeOAuthCallback(code: string, state: string, signal?: AbortSignal): Promise<void> {
  const qs = new URLSearchParams({ code, state }).toString();
  const res = await transport(`/oauth/callback?${qs}`, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
}

// ─── Tracker links (per-series associations to external tracker services — same optional-server-
// capability shape as the trackers themselves) ─────────────────────────────────────────────────

/** GET /library/entries/{b}/{s}/tracker-links → this series' tracker links. */
export function getTrackerLinks(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiTrackerLink[]> {
  return fetchJson(`/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/tracker-links`, signal);
}

/** POST /library/entries/{b}/{s}/tracker-links → link this series to a tracker's catalog entry. */
export function linkTracker(
  bridgeId: string,
  seriesId: string,
  trackerId: string,
  externalId: string | number,
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPost(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/tracker-links`,
    { trackerId, externalId },
    signal,
  );
}

/** DELETE /library/entries/{b}/{s}/tracker-links/{trackerId} → unlink one tracker from this series. */
export function unlinkTracker(bridgeId: string, seriesId: string, trackerId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/tracker-links/${encodeURIComponent(trackerId)}`,
    'DELETE',
    signal,
  );
}

/** POST /library/entries/{b}/{s}/tracker-links/{trackerId}/sync → TWO-WAY sync of one link with its
 *  tracker (the scoped, per-row counterpart to `updateTracker`'s whole-library resync). Whichever
 *  side has read further wins: `pushed` says the local count went up to the tracker, otherwise the
 *  tracker's state was applied locally and `readSynced` chapters were newly marked read. */
export function syncTrackerLink(
  bridgeId: string,
  seriesId: string,
  trackerId: string,
  signal?: AbortSignal,
): Promise<TrackerLinkSyncResult> {
  return fetchPost(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/tracker-links/${encodeURIComponent(trackerId)}/sync`,
    {},
    signal,
  );
}

// ─── Registries (optional server capability — mounted only when M4 registry support is on) ───

/** GET /registries → registries the user has added, or `null` when registry support isn't mounted. */
export function getRegistries(signal?: AbortSignal): Promise<SavedRegistry[] | null> {
  return fetchJsonOptional('/registries', signal);
}

/** POST /registries → add a registry by URL. */
export function addRegistry(
  url: string,
  requireSignature?: boolean,
  signal?: AbortSignal,
): Promise<SavedRegistry> {
  const body: { url: string; requireSignature?: boolean } = { url };
  if (requireSignature !== undefined) body.requireSignature = requireSignature;
  return fetchPost('/registries', body, signal);
}

/** DELETE /registries/{encodedUrl} → remove a registry (orphans its installed bridges/trackers). */
export function removeRegistry(url: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/registries/${encodeURIComponent(url)}`, 'DELETE', signal);
}

// ── Registry moves ──
// A registry that changed host advertises it: `movedTo` on the old index, `movedFrom` on the new
// one. The server/runtime follows a claim on its own only when the target is signed by the key it
// already pinned; otherwise it parks it on the saved registry as `pendingMove`/`pendingAdoption`,
// because following one hands update authority over every bridge installed from it to a new URL.
// These three endpoints carry the user's answer.

/** POST /registries/{encodedUrl}/confirm-move → follow a held `movedTo`; returns the new URL. */
export async function confirmRegistryMove(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchPost<{ url: string }>(`/registries/${encodeURIComponent(url)}/confirm-move`, {}, signal);
  return res.url;
}

/** POST /registries/{encodedUrl}/dismiss-move → drop a held `movedTo` without following it. */
export async function dismissRegistryMove(url: string, signal?: AbortSignal): Promise<void> {
  await fetchPost(`/registries/${encodeURIComponent(url)}/dismiss-move`, {}, signal);
}

/** POST /registries/{encodedUrl}/adopt → accept one of this registry's `movedFrom` claims. */
export async function adoptRegistry(newUrl: string, oldUrl: string, signal?: AbortSignal): Promise<void> {
  await fetchPost(`/registries/${encodeURIComponent(newUrl)}/adopt`, { url: oldUrl }, signal);
}

/** GET /registries/{encodedUrl}/bridges → bridges available in one registry. */
export function browseRegistryBridges(url: string, signal?: AbortSignal): Promise<AvailableBridge[]> {
  return fetchJson(`/registries/${encodeURIComponent(url)}/bridges`, signal);
}

/** GET /registries/{encodedUrl}/trackers → trackers available in one registry. */
export function browseRegistryTrackers(url: string, signal?: AbortSignal): Promise<AvailableTracker[]> {
  return fetchJson(`/registries/${encodeURIComponent(url)}/trackers`, signal);
}

/** POST /registries/{encodedUrl}/bridges/{id}/install → install a bridge from a registry. */
export function installRegistryBridge(
  registryUrl: string,
  bridgeId: string,
  signal?: AbortSignal,
): Promise<InstallResult> {
  return fetchPost(`/registries/${encodeURIComponent(registryUrl)}/bridges/${encodeURIComponent(bridgeId)}/install`, {}, signal);
}

/** POST /registries/{encodedUrl}/trackers/{id}/install → install a tracker from a registry. */
export function installRegistryTracker(
  registryUrl: string,
  trackerId: string,
  signal?: AbortSignal,
): Promise<InstallResult> {
  return fetchPost(`/registries/${encodeURIComponent(registryUrl)}/trackers/${encodeURIComponent(trackerId)}/install`, {}, signal);
}

/** GET /registry/updates → update info for all installed registry bridges (manual policy — never
 *  auto-installed), or `null` when registry support isn't mounted (same 404 contract as
 *  `getRegistries`). */
export function checkRegistryUpdates(signal?: AbortSignal): Promise<RegistryUpdateInfo[] | null> {
  return fetchJsonOptional('/registry/updates', signal);
}

/** GET /registry/tracker-updates → update info for all installed registry trackers, or `null`
 *  when registry support isn't mounted. */
export function checkRegistryTrackerUpdates(signal?: AbortSignal): Promise<RegistryUpdateInfo[] | null> {
  return fetchJsonOptional('/registry/tracker-updates', signal);
}
