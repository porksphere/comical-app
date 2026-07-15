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
