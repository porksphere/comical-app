/**
 * Live, in-memory download progress — the app's local UI state for what the engine is doing *right
 * now*. Per Legend State convention (`AGENTS.md` → "State"), transient client state lives in an
 * observable, not TanStack Query: the durable "what's downloaded" truth is the manifest (read through
 * the `/downloads` query keys), while this store is the per-chapter in-flight progress a download
 * button animates against. It's deliberately **not** persisted — an interrupted download's state is
 * re-derived from the manifest on next launch (a partial chapter is simply `downloading`/`failed`
 * there), so persisting a stale in-flight snapshot would only mislead.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import type { DownloadState } from '@comical/downloads';

export interface ChapterDownloadStatus {
  state: DownloadState;
  /** Pages with bytes on disk so far. */
  done: number;
  /** Total pages in the chapter. */
  total: number;
}

/** Keyed by `chapterProgressKey(bridgeId, seriesId, chapterId)`. */
export const downloadProgress$ = observable<Record<string, ChapterDownloadStatus>>({});

export function chapterProgressKey(bridgeId: string, seriesId: string, chapterId: string): string {
  return `${bridgeId}:${seriesId}:${chapterId}`;
}

export function setChapterProgress(key: string, status: ChapterDownloadStatus): void {
  downloadProgress$[key].set(status);
}

export function clearChapterProgress(key: string): void {
  downloadProgress$[key].delete();
}

/**
 * Reactively read the whole live-progress map. `use$` must be wrapped in a `use[A-Z]` hook so the
 * React Compiler treats it as a hook — see [[use-dollar-must-be-wrapped]]. Callers read this once and
 * index it per chapter, rather than subscribing a `use$` per row.
 */
export function useLiveDownloadProgress(): Record<string, ChapterDownloadStatus> {
  return use$(downloadProgress$) ?? {};
}

/**
 * A chapter's download fraction [0,1]: the live in-flight value when the engine is actively working
 * it, else the manifest's completed/total (so a queued/paused chapter, or one after an app restart,
 * still shows its frozen progress).
 */
export function chapterFraction(
  live: ChapterDownloadStatus | undefined,
  manifestCompleted: number,
  manifestTotal: number,
): number {
  if (live && live.total > 0) return live.done / live.total;
  return manifestTotal > 0 ? manifestCompleted / manifestTotal : 0;
}
