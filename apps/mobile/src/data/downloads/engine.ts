/**
 * The download engine: the platform-bound half of downloads. The `@comical/downloads` core owns the
 * manifest and all state math (reached here through the `/downloads*` routes via `api.ts`); this
 * module does the IO the core can't — fetching page bytes and writing them to the filesystem.
 *
 * Flow:
 *  - `enqueueChapter` fetches a chapter's page list (the rich `ApiPage[]`, which carries per-page
 *    fetch `headers` the `string[]` source projection drops) and POSTs it to `/downloads` as a queued
 *    chapter, then kicks the drain.
 *  - `drain` is a single-flight worker: it pulls pending chapters from the manifest, and for each,
 *    downloads its not-yet-complete pages (concurrency-capped) by resolving each through the same
 *    `resolveAssetSourceCached` the reader uses (so referer/proxy resolution is reused), writing the
 *    bytes via `blob-store`, and recording `(file, bytes)` back to the manifest. Wi-Fi-only is honored
 *    via `expo-network`; a completed chapter is pushed into the sync `index-cache` for offline serving.
 *
 * Persisted queue = the manifest itself (chapter `state`), so an interrupted run resumes on next
 * launch: `resumePendingDownloads()` simply calls `drain`.
 */
import * as Network from 'expo-network';
import {
  dlEnqueueChapter,
  dlManifestPages,
  dlPendingChapters,
  dlRecordPage,
  getChapterPages,
  getSeriesPages,
  resolveAssetSourceCached,
  type DlEnqueueChapterBody,
} from '../api';
import { queryClient } from '../query-client';
import { queryKeys } from '../queries';
import { storePage, uriFor } from './blob-store';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './constants';
import { getDownloadPrefsSync } from './prefs';
import { noteChapterDownloaded } from './index-cache';
import { chapterProgressKey, clearChapterProgress, setChapterProgress } from './state';

/** How many page bytes to fetch in parallel per chapter. */
const PAGE_CONCURRENCY = 3;

/** A chapter to enqueue — the UI supplies the display snapshot + chapter identity it already has. */
export interface EnqueueChapterInput {
  bridgeId: string;
  seriesId: string;
  /** The chapter id. Ignored (replaced by the reserved direct id) when `direct` is set. */
  chapterId: string;
  /** A direct (chapterless) series uses `getSeriesPages` and is filed under the reserved direct
   *  chapter id; the reader models this as a boolean, not a sentinel chapter id. */
  direct?: boolean;
  title: string;
  thumbnailUrl?: string;
  author?: string;
  chapterName?: string;
  number?: number;
  languageCode?: string;
}

/** Refresh the Downloads screen + a series' download state after a manifest change. */
function invalidateDownloads(bridgeId: string, seriesId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.seriesDownloads(bridgeId, seriesId) });
}

/**
 * Record the intent to download a chapter (fetches its page list and queues it), then start draining.
 * Safe to call for an already-downloaded chapter — the core keeps completed pages.
 */
export async function enqueueChapter(input: EnqueueChapterInput): Promise<void> {
  const chapterId = input.direct ? DIRECT_DOWNLOAD_CHAPTER_ID : input.chapterId;
  const pages = input.direct
    ? await getSeriesPages(input.bridgeId, input.seriesId)
    : await getChapterPages(input.bridgeId, input.seriesId, input.chapterId);

  const body: DlEnqueueChapterBody = {
    title: input.title,
    ...(input.thumbnailUrl !== undefined && { thumbnailUrl: input.thumbnailUrl }),
    ...(input.author !== undefined && { author: input.author }),
    ...(input.chapterName !== undefined && { chapterName: input.chapterName }),
    ...(input.number !== undefined && { number: input.number }),
    ...(input.languageCode !== undefined && { languageCode: input.languageCode }),
    pages: [...pages]
      .sort((a, b) => a.index - b.index)
      .map((p) => ({ index: p.index, sourceUrl: p.imageUrl, ...(p.headers && { headers: p.headers }) })),
  };
  const chapter = await dlEnqueueChapter(input.bridgeId, input.seriesId, chapterId, body);
  setChapterProgress(chapterProgressKey(input.bridgeId, input.seriesId, chapterId), {
    state: chapter.state,
    done: 0,
    total: chapter.pageCount,
  });
  invalidateDownloads(input.bridgeId, input.seriesId);
  void drain();
}

let draining = false;
let stopRequested = false;

/** Ask the running drain loop to stop after the current page (e.g. app backgrounding without bg task). */
export function stopDraining(): void {
  stopRequested = true;
}

/** True when connected on Wi-Fi (or when Wi-Fi-only is off). */
async function mayDownloadNow(): Promise<boolean> {
  if (!getDownloadPrefsSync().wifiOnly) return true;
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI && state.isConnected !== false;
  } catch {
    return true; // if we can't tell, don't wedge the queue
  }
}

/**
 * Single-flight queue worker. Drains every pending chapter; returns when the queue is empty, Wi-Fi-only
 * blocks it, or a stop was requested. Re-entrant calls are ignored (the running loop picks up newly
 * enqueued work because it re-reads the manifest each pass).
 */
export async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  stopRequested = false;
  try {
    for (;;) {
      if (stopRequested) break;
      if (!(await mayDownloadNow())) break;
      let pending;
      try {
        pending = await dlPendingChapters();
      } catch {
        // No downloads backend (a remote server without the module), or a transient error — stop
        // rather than spin; the next explicit enqueue/resume retries.
        break;
      }
      if (pending.length === 0) break;

      let progressed = false;
      for (const chapter of pending) {
        if (stopRequested || !(await mayDownloadNow())) break;
        const did = await downloadChapter(chapter.bridgeId, chapter.seriesId, chapter.chapterId);
        progressed = progressed || did;
      }
      // Nothing advanced this pass (every remaining page errors) — stop rather than spin.
      if (!progressed) break;
    }
  } finally {
    draining = false;
  }
}

/** Download one chapter's outstanding pages. Returns true if at least one page landed. */
async function downloadChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<boolean> {
  const key = chapterProgressKey(bridgeId, seriesId, chapterId);
  const manifest = await dlManifestPages(bridgeId, seriesId, chapterId);
  const total = manifest.length;
  const outstanding = manifest.filter((p) => p.state !== 'complete');
  let done = total - outstanding.length;

  if (outstanding.length === 0) {
    // Already complete — make sure the offline index knows about it, then clear progress.
    noteChapterDownloaded(bridgeId, seriesId, chapterId, [...manifest].sort((a, b) => a.index - b.index).map((p) => uriFor(p.file)));
    clearChapterProgress(key);
    return false;
  }

  setChapterProgress(key, { state: 'downloading', done, total });

  let landed = false;
  const queue = [...outstanding];
  async function worker(): Promise<void> {
    for (;;) {
      if (stopRequested) return;
      const page = queue.shift();
      if (!page) return;
      try {
        const resolved = await resolveAssetSourceCached(page.sourceUrl);
        const { relPath, bytes } = await storePage(bridgeId, seriesId, chapterId, page.index, resolved, page.headers);
        await dlRecordPage(bridgeId, seriesId, chapterId, page.index, relPath, bytes);
        landed = true;
        done += 1;
        setChapterProgress(key, { state: 'downloading', done, total });
      } catch {
        // Leave the page not-complete; the chapter will surface as failed and can be re-queued.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, queue.length) }, () => worker()));

  // Re-read to settle the chapter's rolled-up state.
  const after = await dlManifestPages(bridgeId, seriesId, chapterId);
  const complete = after.every((p) => p.state === 'complete');
  if (complete) {
    noteChapterDownloaded(bridgeId, seriesId, chapterId, [...after].sort((a, b) => a.index - b.index).map((p) => uriFor(p.file)));
    clearChapterProgress(key);
  } else {
    setChapterProgress(key, { state: landed ? 'downloading' : 'failed', done, total });
  }
  invalidateDownloads(bridgeId, seriesId);
  return landed;
}

/** Resume any downloads left pending from a previous session/interruption. Called at native startup. */
export function resumePendingDownloads(): void {
  void drain();
}
