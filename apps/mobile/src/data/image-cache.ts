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
import * as Device from 'expo-device';
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

/** The two probes above as one measurement. */
export interface CacheUsage {
  bytes: number;
  breakdown: CacheEntry[];
}

/**
 * The Storage screen's measurement, shaped for TanStack Query: the walk is synchronous and can be
 * chunky on a multi-GB cache, so it yields to the event loop first (the screen paints, then the
 * walk runs) and the result is cached under `queryKeys.cacheUsage()` — persisted, so a re-open
 * within the stale window shows the last number instantly instead of walking the disk again.
 * Clearing the cache invalidates it.
 */
export async function measureCacheUsage(): Promise<CacheUsage> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { bytes: cacheDiskUsage(), breakdown: cacheBreakdown() };
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
 * The in-memory (decoded-bitmap) cache cap, in bytes — distinct from `cachePrefs$`'s disk cap above,
 * which is a user preference. This one isn't: SDWebImage's (iOS) `maxMemoryCost` defaults to 0 —
 * unlimited — and the reader's FlatList windowing only unmounts far-off page VIEWS, not the decoded
 * bitmaps expo-image keeps cached behind them (`cachePolicy="memory-disk"` on every page). A long
 * reading session decodes one full-resolution page after another with nothing ever evicted, which is
 * exactly what produced Sentry COMICAL-APP-1H (WatchdogTermination — iOS killed the app for RAM
 * overuse after ~30 pages read across two stitched chapters in one sitting, on a device with
 * `memory_size: 3840311296` per the crash report).
 *
 * Scaled off `Device.totalMemory` rather than fixed, so a budget device (2-3GB) gets a cap that
 * actually protects it and a high-RAM device (8GB+ iPad) isn't left throttled to the same number for
 * no reason. Clamped between a floor (still enough for a healthy prefetch window on the smallest
 * supported devices) and a ceiling (an unbounded native image cache is never the right call, however
 * much RAM is around — LRU eviction is what keeps memory reclaimable at all).
 */
const MEMORY_CACHE_FRACTION = 0.08; // ~8% of total device RAM
const MEMORY_CACHE_FLOOR_BYTES = 96 * 1024 * 1024; // 96MB
const MEMORY_CACHE_CEILING_BYTES = 512 * 1024 * 1024; // 512MB
/** Used when `Device.totalMemory` is unavailable (web, or an older/unsupported native build) — a
 *  conservative mid-point rather than the (also unavailable) scaled value. */
const MEMORY_CACHE_FALLBACK_BYTES = 160 * 1024 * 1024;

function computeMaxMemoryCostBytes(): number {
  const total = Device.totalMemory;
  if (!total || total <= 0) return MEMORY_CACHE_FALLBACK_BYTES;
  return Math.round(
    Math.max(MEMORY_CACHE_FLOOR_BYTES, Math.min(MEMORY_CACHE_CEILING_BYTES, total * MEMORY_CACHE_FRACTION)),
  );
}

/**
 * Push the user's max onto expo-image's native cache (`maxDiskSize` in bytes; 0 = unlimited), plus the
 * device-scaled in-memory cap above. The native layer LRU-evicts to stay under both. Call at startup
 * and whenever the disk setting changes.
 */
export function applyImageCacheConfig(): void {
  try {
    Image.configureCache({ maxDiskSize: getCacheMaxSync(), maxMemoryCost: computeMaxMemoryCostBytes() });
  } catch {
    // web / older native — no-op (the size cap simply isn't enforced there)
  }
}
