/**
 * Live download progress, mode-aware. One `apply()` handles the engine's typed events; what differs
 * per mode is only the pipe they arrive through:
 *
 *  - **embedded** — subscribe to the in-process engine directly (`getEmbeddedDownloadEngine()`).
 *    NEVER stream `/downloads/events` through the embedded transport: it buffers whole responses,
 *    so an endless SSE body would hang forever.
 *  - **remote** — a fetch-stream SSE client on `${apiBase}/downloads/events` (via `expo/fetch`,
 *    whose response body streams on native where RN's built-in fetch can't), with reconnect
 *    backoff. If the body can't stream on this platform, fall back to polling the storage tree
 *    while anything is pending.
 *
 * Progress renders through the TanStack Query caches: per-page events patch the cached storage tree
 * in place (`patchProgressCaches` — no refetch, and the useQuery subscription re-renders
 * dependably; a Legend State overlay was tried and removed), chapter/deletion events invalidate to
 * refetch host truth and keep the offline index (`index-cache.ts`) in sync.
 *
 * `installDownloadProgress()` is idempotent per (mode, apiBase) signature — call it at startup and
 * again after a mode toggle or server change; it re-pipes accordingly.
 */
import { fetch as expoFetch } from 'expo/fetch';
import type { DownloadedChapter, DownloadedSeries, DownloadEngineEvent, StorageUsage } from '@comical/downloads';
import { getEmbeddedDownloadEngine } from '@comical/host-rn';
import { dlStorageUsage, getApiBase } from '../api';
import { getResolvedModeSync } from '../embedded/preference';
import { queryClient } from '../query-client';
import { queryKeys } from '../queries';
import { clearDownloadIndex, forgetChapter, forgetSeries, refreshChapterIndex } from './index-cache';

// ── Cache patching (moved from the old device engine) ───────────────────────────

/**
 * Patch the cached storage-usage tree in place as a chapter downloads, WITHOUT a refetch. The
 * chapter's completed pages / bytes / state advance, and the series + total rollups follow. Cheap: a
 * shallow immutable patch, no store round-trip.
 */
function patchProgressCaches(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  completedPages: number,
  bytes: number,
  state: 'downloading' | 'complete',
  /** The chapter's page total, when the event knows it. A lazily-enqueued chapter enters the cache
   *  with `pageCount: 0` (its list resolves at pickup) — patching the resolved count here gives the
   *  progress radial its denominator without waiting for a refetch. Never patched DOWN to 0. */
  pageCount?: number,
): void {
  const patch = (c: DownloadedChapter) => ({
    ...c,
    completedPages,
    bytes,
    state,
    ...(pageCount ? { pageCount } : {}),
  });
  // The Downloads screen's storage-usage tree.
  queryClient.setQueryData<StorageUsage>(queryKeys.downloadsUsage(), (old) => {
    if (!old) return old;
    let hit = false;
    const bySeries = old.bySeries.map((se) => {
      if (se.bridgeId !== bridgeId || se.seriesId !== seriesId) return se;
      const chapters = se.chapters.map((c) => {
        if (c.chapterId !== chapterId) return c;
        hit = true;
        return patch(c);
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
        return patch(c);
      });
      return hit ? { ...old, chapters } : old;
    },
  );
}

// Invalidations are COALESCED on a trailing timer: a 300-chapter bulk enqueue emits one 'chapter'
// event per landing chapter, and refetching the whole storage tree for each of them turned into a
// continuous walk that starved everything else (the enqueue trickle stalling, the foldout lagging).
// Progress still feels live — page events patch the caches directly — while the refetch-from-truth
// happens at most ~3×/second.
const INVALIDATE_COALESCE_MS = 350;
const pendingSeries = new Map<string, [string, string]>();
let pendingUsage = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (pendingUsage) {
      pendingUsage = false;
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadsUsage() });
    }
    for (const [bridgeId, seriesId] of pendingSeries.values()) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.seriesDownloads(bridgeId, seriesId) });
    }
    pendingSeries.clear();
  }, INVALIDATE_COALESCE_MS);
}

function invalidate(bridgeId: string, seriesId: string): void {
  pendingUsage = true;
  pendingSeries.set(`${bridgeId} ${seriesId}`, [bridgeId, seriesId]);
  scheduleFlush();
}

function invalidateUsage(): void {
  pendingUsage = true;
  scheduleFlush();
}

// ── Event application (shared across embedded subscription / SSE / nothing) ─────

function apply(e: DownloadEngineEvent): void {
  switch (e.type) {
    case 'page':
      patchProgressCaches(
        e.bridgeId,
        e.seriesId,
        e.chapterId,
        e.completedPages,
        e.bytes,
        e.state === 'complete' ? 'complete' : 'downloading',
        e.pageCount,
      );
      break;
    case 'chapter': {
      const c = e.chapter;
      if (c.state === 'downloading') {
        // Picked up by the engine — mark it downloading before the first byte so a series indicator
        // never dips back to 'queued' at the hand-off between chapters.
        patchProgressCaches(c.bridgeId, c.seriesId, c.chapterId, c.completedPages, c.bytes, 'downloading', c.pageCount);
        break;
      }
      if (c.state === 'complete') void refreshChapterIndex(c.bridgeId, c.seriesId, c.chapterId, c.pageCount);
      invalidate(c.bridgeId, c.seriesId); // settle on host truth (complete/failed/paused/queued)
      break;
    }
    case 'changed':
      invalidate(e.bridgeId, e.seriesId);
      break;
    case 'deleted':
      if (e.bridgeId && e.seriesId && e.chapterId) forgetChapter(e.bridgeId, e.seriesId, e.chapterId);
      else if (e.bridgeId && e.seriesId) forgetSeries(e.bridgeId, e.seriesId);
      else clearDownloadIndex();
      if (e.bridgeId && e.seriesId) invalidate(e.bridgeId, e.seriesId);
      else invalidateUsage();
      break;
    case 'idle':
      break;
  }
}

// ── SSE frame parsing ───────────────────────────────────────────────────────────

/** Parse one `event:`/`data:` SSE frame into an engine event (null for pings/garbage). Exported for tests. */
export function parseSseFrame(frame: string): DownloadEngineEvent | null {
  let event = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event || event === 'ping' || !data) return null;
  try {
    return JSON.parse(data) as DownloadEngineEvent;
  } catch {
    return null;
  }
}

// ── Installation ────────────────────────────────────────────────────────────────

let installedFor: string | null = null;
let teardown: (() => void) | null = null;

/**
 * (Re)pipe live progress for the current mode + server. Idempotent per signature; safe to call at
 * every startup and after a mode toggle / server change.
 */
export function installDownloadProgress(): void {
  const sig = getResolvedModeSync() === 'embedded' ? 'embedded' : `remote:${getApiBase()}`;
  if (installedFor === sig) return;
  teardown?.();
  teardown = null;
  installedFor = sig;

  if (sig === 'embedded') {
    teardown = getEmbeddedDownloadEngine()?.subscribe(apply) ?? null;
    return;
  }
  teardown = installRemoteProgress(sig);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Stream `/downloads/events`, reconnecting with backoff; falls back to polling if it can't stream. */
function installRemoteProgress(sig: string): () => void {
  let stopped = false;
  const active = () => !stopped && installedFor === sig;

  void (async () => {
    let delay = 1000;
    while (active()) {
      try {
        const res = await expoFetch(`${getApiBase()}/downloads/events`, {
          headers: { Accept: 'text/event-stream' },
        });
        if (res.status === 404) {
          // Server without the downloads module (or an old build) — SSE will never appear; poll.
          await pollWhilePending(active);
          continue;
        }
        if (!res.ok || !res.body) throw new Error(`sse unavailable: ${res.status}`);
        delay = 1000;
        // (Re)connected: refetch state — the stream carries only deltas from now on.
        invalidateUsage();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          if (!active()) {
            await reader.cancel().catch(() => {});
            return;
          }
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';
          for (const frame of frames) {
            const e = parseSseFrame(frame);
            if (e) apply(e);
          }
        }
      } catch {
        // Connection failed / dropped / streaming unsupported — retry with backoff below.
      }
      if (!active()) return;
      await sleep(delay);
      delay = Math.min(delay * 2, 30_000);
    }
  })();

  return () => {
    stopped = true;
  };
}

/**
 * Streaming-less fallback: poll the storage tree every couple of seconds while anything is still
 * pending, then settle to a slow heartbeat (a fresh enqueue invalidates + re-kicks it via the
 * mutation path, so the fast lane resumes when work appears).
 */
async function pollWhilePending(active: () => boolean): Promise<void> {
  while (active()) {
    let pending = false;
    try {
      const usage = await dlStorageUsage();
      queryClient.setQueryData(queryKeys.downloadsUsage(), usage);
      pending = usage.bySeries.some((s) => s.chapters.some((c) => c.state === 'queued' || c.state === 'downloading'));
    } catch {
      // Server unreachable — keep the slow heartbeat.
    }
    await sleep(pending ? 2_000 : 30_000);
  }
}
