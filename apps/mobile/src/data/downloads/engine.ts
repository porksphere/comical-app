/**
 * The downloads facade: a thin, mode-agnostic client of the `/downloads*` routes. The engine itself
 * (queue drain, byte fetching, blob writes, cancellation) lives in `@comical/downloads` and runs
 * BEHIND the router on whichever host owns the bytes:
 *
 *  - **embedded** — `@comical/host-rn` composes it in-process over the device seams this app
 *    injects (`blob-store.ts`, `fetch-page.ts`, `mayDownloadNow`); reachable via
 *    `getEmbeddedDownloadEngine()` for the device-lifecycle hooks below.
 *  - **remote** — the host-server runs its own engine over its filesystem; this app only enqueues,
 *    pauses/resumes, deletes, and observes (`events.ts` streams progress via SSE).
 *
 * Either way, enqueue no longer ships a page list: the host resolves pages via its own bridge
 * (`DIRECT_DOWNLOAD_CHAPTER_ID` mapping to `getSeriesPages`), and mutations kick the host's drain —
 * so every function here is a small REST call plus a query invalidation.
 */
import * as Network from 'expo-network';
import { getEmbeddedDownloadEngine } from '@comical/host-rn';
import {
  dlEnqueueChapter,
  dlPauseChapter,
  dlPauseSeries,
  dlRequeue,
  dlResumeChapter,
  dlResumeSeries,
  type DlEnqueueChapterBody,
} from '../api';
import { queryClient } from '../query-client';
import { queryKeys } from '../queries';
import { logDiagnostic } from '@/lib/diagnostics';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './constants';
import { getDownloadPrefsSync } from './prefs';

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
 * Record the intent to download a chapter. The host resolves the page list itself and starts
 * draining; safe to call for an already-downloaded chapter — the core keeps completed pages.
 */
export async function enqueueChapter(input: EnqueueChapterInput): Promise<void> {
  const chapterId = input.direct ? DIRECT_DOWNLOAD_CHAPTER_ID : input.chapterId;
  const body: DlEnqueueChapterBody = {
    title: input.title,
    ...(input.thumbnailUrl !== undefined && { thumbnailUrl: input.thumbnailUrl }),
    ...(input.author !== undefined && { author: input.author }),
    ...(input.chapterName !== undefined && { chapterName: input.chapterName }),
    ...(input.number !== undefined && { number: input.number }),
    ...(input.languageCode !== undefined && { languageCode: input.languageCode }),
  };
  try {
    await dlEnqueueChapter(input.bridgeId, input.seriesId, chapterId, body);
  } catch (e) {
    // Best-effort like every other mutation here: a failed enqueue (page resolution error, a
    // pause/delete racing a bulk collection) must never become an unhandled rejection — callers
    // fire-and-forget one call per chapter. Surface it in diagnostics instead.
    logDiagnostic('download-enqueue', (e as Error)?.message || String(e), {
      context: `bridge=${input.bridgeId} series=${input.seriesId} chapter=${chapterId}`,
    });
  }
  invalidateDownloads(input.bridgeId, input.seriesId);
}

/** Enqueue many chapters of one series — the download sheet / chapter picker fan-out. */
export function enqueueChapters(
  series: { bridgeId: string; seriesId: string; title: string; thumbnailUrl?: string; author?: string },
  chapters: { id: string; name: string; number?: number; languageCode?: string }[],
): void {
  for (const c of chapters) {
    void enqueueChapter({
      ...series,
      chapterId: c.id,
      chapterName: c.name,
      ...(c.number !== undefined && { number: c.number }),
      ...(c.languageCode !== undefined && { languageCode: c.languageCode }),
    });
  }
}

/** Pause one in-flight/queued chapter (resumable) — the host's engine aborts its workers promptly. */
export async function pauseChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  try {
    await dlPauseChapter(bridgeId, seriesId, chapterId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

/** Pause a whole series (resumable). */
export async function pauseSeries(bridgeId: string, seriesId: string): Promise<void> {
  try {
    await dlPauseSeries(bridgeId, seriesId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

/** Resume one paused chapter — the host's engine kicks its drain. */
export async function resumeChapterDownload(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  try {
    await dlResumeChapter(bridgeId, seriesId, chapterId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

/** Resume every paused chapter of a series. */
export async function resumeSeriesDownload(bridgeId: string, seriesId: string): Promise<void> {
  try {
    await dlResumeSeries(bridgeId, seriesId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

/** Retry a failed chapter — re-queue its non-complete (incl. failed) pages; the host drains them. */
export async function retryChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  try {
    await dlRequeue(bridgeId, seriesId, chapterId);
  } catch {
    /* best-effort */
  }
  invalidateDownloads(bridgeId, seriesId);
}

// ── Device-lifecycle hooks (embedded engine only; no-ops in remote mode) ────────
// In remote mode the server's engine paces itself — the device has nothing to kick or stop.

/**
 * Nudge the embedded queue to (re)start draining — e.g. after the user turns off "Wi-Fi only" while
 * on cellular, so held-back downloads resume immediately instead of waiting for the next trigger.
 */
export function kickDownloads(): void {
  getEmbeddedDownloadEngine()?.kick();
}

/** Drain the embedded queue to completion (the background task awaits this). */
export async function drain(): Promise<void> {
  await getEmbeddedDownloadEngine()?.drain();
}

/** Ask the embedded drain loop to stop after the current page (app backgrounding without bg task). */
export function stopDraining(): void {
  getEmbeddedDownloadEngine()?.stop();
}

/** Resume any downloads left pending from a previous session/interruption. Called at native startup. */
export function resumePendingDownloads(): void {
  kickDownloads();
}

/** True when connected on Wi-Fi (or when Wi-Fi-only is off) — the embedded engine's policy gate. */
export async function mayDownloadNow(): Promise<boolean> {
  if (!getDownloadPrefsSync().wifiOnly) return true;
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI && state.isConnected !== false;
  } catch {
    return true; // if we can't tell, don't wedge the queue
  }
}

let networkSub: ReturnType<typeof Network.addNetworkStateListener> | null = null;

/**
 * Auto-resume on connectivity changes: kick the embedded queue whenever the device (re)connects — so
 * downloads held back while offline or on cellular (Wi-Fi-only) resume by themselves the moment
 * Wi-Fi/connectivity returns. The engine re-checks `mayDownloadNow`, so a change that still isn't
 * allowed is a cheap no-op. Called once at native startup.
 */
export function installNetworkAutoResume(): void {
  if (networkSub) return;
  try {
    networkSub = Network.addNetworkStateListener((state) => {
      if (state.isConnected !== false) kickDownloads();
    });
  } catch {
    // expo-network unavailable (e.g. web) — downloads still resume on app launch + explicit triggers.
  }
}
