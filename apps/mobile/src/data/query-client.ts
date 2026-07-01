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
import { QueryClient } from '@tanstack/react-query';

import { API_BASE } from './api';

// Content (series detail, chapters, lists, pages) is effectively immutable for
// a browsing session, so keep it fresh for a few minutes (no refetch on
// revisit) and retained for a day so it repaints instantly across navigations.
const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — mirrors web's "reuse within session"
const GC_TIME_MS = 24 * 60 * 60 * 1000; // 24 h — kept for the persisted cache's maxAge

export const queryClient = new QueryClient({
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
});

/** How long a persisted entry is trusted after being written (the disk-cache TTL). */
export const PERSIST_MAX_AGE_MS = GC_TIME_MS;

/**
 * Bumping this drops the whole persisted cache. Keyed off the backend URL so
 * switching servers (or the demo build's absent backend) can't restore another
 * origin's stale data.
 */
export const PERSIST_BUSTER = `v1:${API_BASE}`;
