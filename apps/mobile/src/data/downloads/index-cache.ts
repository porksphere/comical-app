/**
 * A synchronous in-memory index of fully-downloaded chapters → their ordered local `file://` URIs.
 *
 * This is the hot-path lookup for offline serving. `source.ts`'s `getChapterPages`/`getDirectPages`
 * consult it *synchronously* on every chapter open: a hit returns the local page list directly (so the
 * chapter opens offline, instantly, with no bridge call), a miss falls through to the live bridge. It
 * exists purely to avoid a `/downloads` manifest round-trip on every open — the manifest (via the
 * on-device `DownloadsStore`) remains the source of truth; this cache is hydrated from it at startup
 * and kept in sync by the engine (on chapter completion) and deletions.
 *
 * Only **complete** chapters are cached — a half-downloaded chapter must still hit the bridge.
 */
import { AsyncStorageDownloadsStore } from './async-store';
import { uriFor } from './blob-store';

const store = new AsyncStorageDownloadsStore();

/** `bridgeId:seriesId:chapterId`. */
function key(bridgeId: string, seriesId: string, chapterId: string): string {
  return `${bridgeId}:${seriesId}:${chapterId}`;
}

/** chapterKey → ordered `file://` URIs (complete chapters only). */
const cache = new Map<string, string[]>();

/** Load every complete chapter's local page URIs from the manifest. Call once at native startup. */
export async function hydrateDownloadIndex(): Promise<void> {
  try {
    for (const series of await store.listSeries()) {
      const entryKey = `${series.bridgeId}:${series.seriesId}`;
      for (const chapter of await store.listChapters(entryKey)) {
        if (chapter.state !== 'complete') continue;
        const pages = await store.listPages(entryKey, chapter.chapterId);
        if (pages.length > 0 && pages.every((p) => p.state === 'complete' && p.file)) {
          cache.set(
            key(series.bridgeId, series.seriesId, chapter.chapterId),
            [...pages].sort((a, b) => a.index - b.index).map((p) => uriFor(p.file)),
          );
        }
      }
    }
  } catch {
    // Best-effort — a hydration failure just means offline serving falls back to the bridge.
  }
}

/** The ordered local page URIs for a fully-downloaded chapter, or `undefined` if not downloaded. */
export function localChapterPages(bridgeId: string, seriesId: string, chapterId: string): string[] | undefined {
  return cache.get(key(bridgeId, seriesId, chapterId));
}

/** Record a chapter's completed local URIs (called by the engine when a chapter finishes). */
export function noteChapterDownloaded(bridgeId: string, seriesId: string, chapterId: string, uris: string[]): void {
  cache.set(key(bridgeId, seriesId, chapterId), uris);
}

/** Forget one chapter (on delete). */
export function forgetChapter(bridgeId: string, seriesId: string, chapterId: string): void {
  cache.delete(key(bridgeId, seriesId, chapterId));
}

/** Forget every chapter of a series (on series delete). */
export function forgetSeries(bridgeId: string, seriesId: string): void {
  const prefix = `${bridgeId}:${seriesId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

/** Forget everything (on "Delete all"). */
export function clearDownloadIndex(): void {
  cache.clear();
}
