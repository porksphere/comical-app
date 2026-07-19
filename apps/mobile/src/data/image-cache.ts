/**
 * Image (and general reclaimable) cache management. The app disk-caches every cover, thumbnail, and
 * READ page image via expo-image (`cachePolicy="memory-disk"`), which defaults to NO size cap — so
 * heavy browsing/reading grows it into the GBs. `Image.configureCache({ maxDiskSize })` hands the
 * user's cap straight to the native layer (SDWebImage on iOS, Glide on Android), which then evicts
 * least-recently-used images automatically to stay under it — a real LRU cap, not a clear-when-over
 * hack. Distinct from downloads, which are durable under Documents.
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

/** One top-level entry of the Caches dir, with its recursive byte size. */
export interface CacheEntry {
  name: string;
  bytes: number;
  isDir: boolean;
}

/**
 * Per-entry breakdown of the Caches dir the size probe walks — so the storage number can be split
 * into "expo-image images" (SDWebImage's subfolder) vs. everything else the OS parks alongside it
 * (our bridge-bundle cache, NSURLCache, framework caches). Largest first. Native only; [] on web.
 */
export function cacheBreakdown(): CacheEntry[] {
  try {
    const dir = new Directory(Paths.cache);
    if (!dir.exists) return [];
    return dir
      .list()
      .map((e) => ({ name: e.name, bytes: e.size ?? 0, isDir: e instanceof Directory }))
      .sort((a, b) => b.bytes - a.bytes);
  } catch {
    return [];
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

/**
 * Push the user's max onto expo-image's native cache (`maxDiskSize` in bytes; 0 = unlimited). The
 * native layer LRU-evicts to stay under it. Call at startup and whenever the setting changes.
 */
export function applyImageCacheConfig(): void {
  try {
    Image.configureCache({ maxDiskSize: getCacheMaxSync() });
  } catch {
    // web / older native — no-op (the size cap simply isn't enforced there)
  }
}
