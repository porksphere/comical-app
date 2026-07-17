/**
 * A synchronous in-memory index of fully-downloaded chapters → their ordered page URIs.
 *
 * This is the hot-path lookup for offline serving. `source.ts`'s `getChapterPages`/`getDirectPages`
 * consult it *synchronously* on every chapter open: a hit returns the page list directly (no bridge
 * call), a miss falls through to the live bridge. The manifest remains the source of truth; this
 * cache is hydrated from it at startup and kept in sync by download events (`events.ts`).
 *
 * What a "local page" is depends on the mode:
 *  - **embedded** — a `file://` URI reconstructed from the on-device manifest's relative paths
 *    (instant, works with the network fully off).
 *  - **remote** — the server's identity-keyed `/downloads/.../pages/:i/file` URL, deterministic from
 *    `pageCount` alone (no per-chapter manifest fetch). The server serves its stored bytes, so a
 *    downloaded chapter reads without touching the source — the remote-mode meaning of "offline".
 *
 * Only **complete** chapters are cached — a half-downloaded chapter must still hit the bridge.
 */
import { dlStorageUsage, getApiBase } from '../api';
import { getResolvedModeSync } from '../embedded/preference';
import { downloadsStore as store } from './async-store';
import { uriFor } from './blob-store';

/** `bridgeId:seriesId:chapterId`. */
function key(bridgeId: string, seriesId: string, chapterId: string): string {
  return `${bridgeId}:${seriesId}:${chapterId}`;
}

/** chapterKey → ordered page URIs (complete chapters only). */
const cache = new Map<string, string[]>();

/** The server's downloaded-page URL for one page (remote mode). */
function remotePageUrl(bridgeId: string, seriesId: string, chapterId: string, index: number): string {
  return `${getApiBase()}/downloads/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages/${index}/file`;
}

function remotePageUrls(bridgeId: string, seriesId: string, chapterId: string, pageCount: number): string[] {
  return Array.from({ length: pageCount }, (_, i) => remotePageUrl(bridgeId, seriesId, chapterId, i));
}

/**
 * Load every complete chapter's page URIs. Call at startup AND after a mode toggle / server change
 * (both change what a "local page" is). Embedded reads the on-device manifest; remote reads the
 * server's storage tree.
 */
export async function hydrateDownloadIndex(): Promise<void> {
  cache.clear();
  try {
    if (getResolvedModeSync() === 'embedded') {
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
      return;
    }
    const usage = await dlStorageUsage();
    for (const series of usage.bySeries) {
      for (const chapter of series.chapters) {
        if (chapter.state !== 'complete' || chapter.pageCount === 0) continue;
        cache.set(
          key(series.bridgeId, series.seriesId, chapter.chapterId),
          remotePageUrls(series.bridgeId, series.seriesId, chapter.chapterId, chapter.pageCount),
        );
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

/** Refresh one chapter's entry after it completes (called by `events.ts`; mode-aware). */
export async function refreshChapterIndex(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageCount: number,
): Promise<void> {
  try {
    if (getResolvedModeSync() !== 'embedded') {
      if (pageCount > 0) cache.set(key(bridgeId, seriesId, chapterId), remotePageUrls(bridgeId, seriesId, chapterId, pageCount));
      return;
    }
    const pages = await store.listPages(`${bridgeId}:${seriesId}`, chapterId);
    if (pages.length > 0 && pages.every((p) => p.state === 'complete' && p.file)) {
      cache.set(
        key(bridgeId, seriesId, chapterId),
        [...pages].sort((a, b) => a.index - b.index).map((p) => uriFor(p.file)),
      );
    }
  } catch {
    // Best-effort — the chapter still reads through the bridge until the next hydration.
  }
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
