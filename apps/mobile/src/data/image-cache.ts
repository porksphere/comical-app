/**
 * Image (and general reclaimable) cache management. The app disk-caches every cover, thumbnail, and
 * READ page image via expo-image (`cachePolicy="memory-disk"`), with no size cap — so heavy
 * browsing/reading grows it into the GBs. This exposes its size, a clear action, and a user max that's
 * enforced by clearing when exceeded (expo-image / SDWebImage has no JS API for a true LRU size cap,
 * so the honest cap is "clear when over"). Distinct from downloads, which are durable under Documents.
 *
 * The size probe measures `Paths.cache` (the app's Caches dir, where expo-image stores its disk cache)
 * — native only; on web it reports 0.
 */
import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** Max reclaimable-cache size in bytes; 0 = unlimited. */
export interface CachePrefs {
  maxBytes: number;
}
const DEFAULT: CachePrefs = { maxBytes: 0 };

export const cachePrefs$ = persisted$<CachePrefs>('comical:image-cache:prefs', DEFAULT);

/** Reactive read — returns a FRESH object so the React Compiler recomputes (see [[use-dollar-must-be-wrapped]]). */
export function useCachePrefs(): CachePrefs {
  return { ...(use$(cachePrefs$) ?? DEFAULT) };
}
export function getCacheMaxSync(): number {
  return cachePrefs$.peek().maxBytes;
}

/** Bytes the app's reclaimable cache currently occupies on disk (expo-image cache dominates). */
export function cacheDiskUsage(): number {
  try {
    const dir = new Directory(Paths.cache);
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Clear the image cache (disk + in-memory). */
export async function clearImageCache(): Promise<void> {
  try {
    await Image.clearDiskCache();
  } catch {
    /* best-effort */
  }
  try {
    await Image.clearMemoryCache();
  } catch {
    /* best-effort */
  }
}

/** If a max is set and the cache is over it, clear the image cache. Called at startup. */
export async function enforceCacheLimit(): Promise<void> {
  const max = getCacheMaxSync();
  if (max > 0 && cacheDiskUsage() > max) await clearImageCache();
}
