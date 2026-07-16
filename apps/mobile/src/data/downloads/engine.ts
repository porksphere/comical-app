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
import type { DownloadedChapter, DownloadedSeries, StorageUsage } from '@comical/downloads';
import {
  dlEnqueueChapter,
  dlFailPage,
  dlManifestPages,
  dlPauseChapter,
  dlPauseSeries,
  dlPendingChapters,
  dlRecordPage,
  dlRequeue,
  dlResumeChapter,
  dlResumeSeries,
  getChapterPages,
  getSeriesPages,
  invalidateAssetSource,
  resolveAssetSourceCached,
  type DlEnqueueChapterBody,
} from '../api';
import { queryClient } from '../query-client';
import { queryKeys } from '../queries';
import { storePage, uriFor } from './blob-store';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './constants';
import { getDownloadPrefsSync } from './prefs';
import { noteChapterDownloaded } from './index-cache';
import { chapterProgressKey } from './state';

/**
 * Pages are downloaded ONE AT A TIME (sequentially). Fetching several at once hammered sources hard
 * enough to risk rate-limiting/blocking, and made progress lurch (three pages landing together), so we
 * trade a little speed for a steady page-by-page advance and gentler request pacing. (Chapters are
 * already processed one at a time by `drain`, so the whole pipeline is sequential.)
 */
const PAGE_CONCURRENCY = 1;

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
 * Patch the cached storage-usage tree in place as a chapter downloads, WITHOUT a refetch. The manifest
 * query is otherwise only invalidated when a whole chapter finishes, so mid-download the screen had no
 * reason to re-render — the per-page live-progress overlay is a Legend State store, and its re-render
 * wasn't reaching the list reliably on the resume/reboot path. Driving progress through the TanStack
 * Query cache (the app's server-state layer, whose useQuery subscription re-renders dependably) fixes
 * that AND keeps the numbers accurate: the chapter's completed pages / bytes / state advance, and the
 * series + total rollups follow. Cheap: a shallow immutable patch, no store round-trip.
 */
function patchProgressCaches(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  completedPages: number,
  bytes: number,
  state: 'downloading' | 'complete',
): void {
  // The Downloads screen's storage-usage tree.
  queryClient.setQueryData<StorageUsage>(queryKeys.downloadsUsage(), (old) => {
    if (!old) return old;
    let hit = false;
    const bySeries = old.bySeries.map((se) => {
      if (se.bridgeId !== bridgeId || se.seriesId !== seriesId) return se;
      const chapters = se.chapters.map((c) => {
        if (c.chapterId !== chapterId) return c;
        hit = true;
        return { ...c, completedPages, bytes, state };
      });
      return { ...se, chapters, bytes: chapters.reduce((n, c) => n + c.bytes, 0) };
    });
    if (!hit) return old; // chapter not in the cached tree (e.g. first page before the query populated)
    return { ...old, bySeries, totalBytes: bySeries.reduce((n, se) => n + se.bytes, 0) };
  });
  // The series screen's own download detail (drives the series Download button / context menu).
  queryClient.setQueryData<{ series: DownloadedSeries; chapters: DownloadedChapter[] } | null>(
    queryKeys.seriesDownloads(bridgeId, seriesId),
    (old) => {
      if (!old) return old;
      let hit = false;
      const chapters = old.chapters.map((c) => {
        if (c.chapterId !== chapterId) return c;
        hit = true;
        return { ...c, completedPages, bytes, state };
      });
      return hit ? { ...old, chapters } : old;
    },
  );
}

const seriesKeyOf = (bridgeId: string, seriesId: string) => `${bridgeId}:${seriesId}`;

// Cancellation markers — the manifest is the source of truth (a cancelled chapter is `paused`
// server-side and excluded from the pending queue), but a chapter the engine is downloading RIGHT NOW
// is mid-loop, so these let its in-flight page workers bail promptly. Cleared by any re-activation
// (enqueue/resume), so a stale flag can never block a later download.
const cancelledChapters = new Set<string>();
const cancelledSeries = new Set<string>();

function isCancelled(bridgeId: string, seriesId: string, chapterId: string): boolean {
  return (
    cancelledSeries.has(seriesKeyOf(bridgeId, seriesId)) ||
    cancelledChapters.has(chapterProgressKey(bridgeId, seriesId, chapterId))
  );
}

function clearCancel(bridgeId: string, seriesId: string, chapterId?: string): void {
  cancelledSeries.delete(seriesKeyOf(bridgeId, seriesId));
  if (chapterId) cancelledChapters.delete(chapterProgressKey(bridgeId, seriesId, chapterId));
  else {
    const prefix = `${bridgeId}:${seriesId}:`;
    for (const k of cancelledChapters) if (k.startsWith(prefix)) cancelledChapters.delete(k);
  }
}

/** Pause one in-flight/queued chapter (resumable): pause it server-side and abort in-flight workers. */
export async function pauseChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  cancelledChapters.add(chapterProgressKey(bridgeId, seriesId, chapterId));
  try {
    await dlPauseChapter(bridgeId, seriesId, chapterId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

/** Pause a whole series (resumable): pause every not-yet-complete chapter and abort the one in flight. */
export async function pauseSeries(bridgeId: string, seriesId: string): Promise<void> {
  cancelledSeries.add(seriesKeyOf(bridgeId, seriesId));
  try {
    await dlPauseSeries(bridgeId, seriesId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

/** Resume one paused chapter and kick the drain. */
export async function resumeChapterDownload(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  clearCancel(bridgeId, seriesId, chapterId);
  try {
    await dlResumeChapter(bridgeId, seriesId, chapterId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
  void drain();
}

/** Resume every paused chapter of a series and kick the drain. */
export async function resumeSeriesDownload(bridgeId: string, seriesId: string): Promise<void> {
  clearCancel(bridgeId, seriesId);
  try {
    await dlResumeSeries(bridgeId, seriesId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
  void drain();
}

/** Retry a failed chapter — re-queue its non-complete (incl. failed) pages, then drain. */
export async function retryChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  clearCancel(bridgeId, seriesId, chapterId);
  try {
    await dlRequeue(bridgeId, seriesId, chapterId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
  void drain();
}

/**
 * Nudge the queue to (re)start draining — e.g. after the user turns off "Wi-Fi only" while on
 * cellular, so held-back downloads resume immediately instead of waiting for the next trigger.
 */
export function kickDownloads(): void {
  void drain();
}

let networkSub: ReturnType<typeof Network.addNetworkStateListener> | null = null;

/**
 * Auto-resume on connectivity changes: subscribe to network-state changes and kick the queue whenever
 * the device (re)connects — so downloads held back while offline or on cellular (Wi-Fi-only) resume by
 * themselves the moment Wi-Fi/connectivity returns, without the user reopening the Downloads screen.
 * The drain re-checks `mayDownloadNow`, so a change that still isn't allowed is a cheap no-op. Called
 * once at native startup (alongside the boot-time `resumePendingDownloads`).
 */
export function installNetworkAutoResume(): void {
  if (networkSub) return;
  try {
    networkSub = Network.addNetworkStateListener((state) => {
      if (state.isConnected !== false) void drain();
    });
  } catch {
    // expo-network unavailable (e.g. web) — downloads still resume on app launch + explicit triggers.
  }
}

/**
 * Record the intent to download a chapter (fetches its page list and queues it), then start draining.
 * Safe to call for an already-downloaded chapter — the core keeps completed pages.
 */
export async function enqueueChapter(input: EnqueueChapterInput): Promise<void> {
  const chapterId = input.direct ? DIRECT_DOWNLOAD_CHAPTER_ID : input.chapterId;
  // Re-downloading clears any prior cancellation so a stale flag can't abort the fresh work.
  clearCancel(input.bridgeId, input.seriesId, chapterId);
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
  await dlEnqueueChapter(input.bridgeId, input.seriesId, chapterId, body);
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
        if (isCancelled(chapter.bridgeId, chapter.seriesId, chapter.chapterId)) continue;
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
  const manifest = await dlManifestPages(bridgeId, seriesId, chapterId);
  const total = manifest.length;
  const outstanding = manifest.filter((p) => p.state !== 'complete');
  let done = total - outstanding.length;
  // Bytes already on disk (from a prior/resumed run) — the size grows from here, page by page, so a
  // resumed chapter shows its true footprint immediately instead of counting up from 0.
  let bytes = manifest.reduce((sum, p) => sum + (p.state === 'complete' ? p.bytes : 0), 0);

  if (outstanding.length === 0) {
    // Already complete — make sure the offline index knows about it.
    noteChapterDownloaded(bridgeId, seriesId, chapterId, [...manifest].sort((a, b) => a.index - b.index).map((p) => uriFor(p.file)));
    return false;
  }

  // Flip it to 'downloading' the moment the engine picks it up (before the first byte). Without this
  // the chapter stays 'queued' until its first page lands a network fetch later — so at the hand-off
  // from one chapter to the next, the SERIES indicator would dip to 'queued' for that gap. Marking it
  // on pickup keeps the series continuously 'downloading' across chapters.
  patchProgressCaches(bridgeId, seriesId, chapterId, done, bytes, 'downloading');

  let landed = false;
  const queue = [...outstanding];
  async function worker(): Promise<void> {
    for (;;) {
      if (stopRequested || isCancelled(bridgeId, seriesId, chapterId)) return;
      const page = queue.shift();
      if (!page) return;
      // Try the page, retrying once (busting a stale resolve) before giving up on it. A page that
      // still fails is marked failed so the chapter surfaces as `failed` (retryable), rather than
      // silently stalling — the other pages keep going.
      let stored = false;
      for (let attempt = 0; attempt < 2 && !stored; attempt++) {
        if (isCancelled(bridgeId, seriesId, chapterId)) return;
        try {
          const resolved = await resolveAssetSourceCached(page.sourceUrl);
          const { relPath, bytes: pageBytes } = await storePage(bridgeId, seriesId, chapterId, page.index, resolved, page.headers);
          await dlRecordPage(bridgeId, seriesId, chapterId, page.index, relPath, pageBytes);
          stored = true;
          landed = true;
          done += 1;
          bytes += pageBytes;
          // Advance the manifest query caches so the UI re-renders this page (see the fn's note).
          patchProgressCaches(bridgeId, seriesId, chapterId, done, bytes, done === total ? 'complete' : 'downloading');
        } catch {
          if (attempt === 0) invalidateAssetSource(page.sourceUrl); // bust a stale resolution, retry
        }
      }
      if (!stored && !isCancelled(bridgeId, seriesId, chapterId)) {
        try {
          await dlFailPage(bridgeId, seriesId, chapterId, page.index);
        } catch {
          /* best-effort */
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, queue.length) }, () => worker()));

  // Paused/cancelled mid-download: the manifest is now 'paused' server-side — refetch so the paused
  // state shows (this overwrites the per-page 'downloading' patches in the cache).
  if (isCancelled(bridgeId, seriesId, chapterId)) {
    invalidateDownloads(bridgeId, seriesId);
    return landed;
  }

  // Re-read to settle the chapter's rolled-up state, and refetch so the caches hold server truth.
  const after = await dlManifestPages(bridgeId, seriesId, chapterId);
  if (after.every((p) => p.state === 'complete')) {
    noteChapterDownloaded(bridgeId, seriesId, chapterId, [...after].sort((a, b) => a.index - b.index).map((p) => uriFor(p.file)));
  }
  invalidateDownloads(bridgeId, seriesId);
  return landed;
}

/** Resume any downloads left pending from a previous session/interruption. Called at native startup. */
export function resumePendingDownloads(): void {
  void drain();
}
