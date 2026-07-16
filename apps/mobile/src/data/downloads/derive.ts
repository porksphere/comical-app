/**
 * Pure helpers deriving a series' rolled-up download state/progress from its chapters, plus the
 * queue-then-recency ordering the Downloads screen uses. Shared by the screen and the series Download
 * button so both agree on "is this in progress, and how far."
 */
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

import { chapterProgressKey, type ChapterDownloadStatus } from './state';

/**
 * A series' single rolled-up state. `paused` only when EVERY not-yet-complete chapter is paused (so
 * the row offers Resume); otherwise the most action-worthy active state wins.
 */
export function deriveSeriesState(chapters: DownloadedChapter[]): DownloadState {
  const nonComplete = chapters.filter((c) => c.state !== 'complete');
  if (nonComplete.length === 0) return 'complete';
  if (nonComplete.every((c) => c.state === 'paused')) return 'paused';
  if (nonComplete.some((c) => c.state === 'downloading')) return 'downloading';
  if (nonComplete.some((c) => c.state === 'failed')) return 'failed';
  return 'queued';
}

/** Series progress [0,1] across all pages, overlaying live in-flight counts where the engine is active. */
export function seriesFraction(chapters: DownloadedChapter[], live: Record<string, ChapterDownloadStatus>): number {
  let done = 0;
  let total = 0;
  for (const c of chapters) {
    total += c.pageCount;
    const l = live[chapterProgressKey(c.bridgeId, c.seriesId, c.chapterId)];
    done += l && l.total > 0 ? l.done : c.completedPages;
  }
  return total > 0 ? done / total : 0;
}

export function isInProgress(state: DownloadState): boolean {
  return state !== 'complete';
}

/**
 * Sort value for a download unit: [group, tiebreak] compared ascending. Not-yet-complete units come
 * first (group 0), in queue order (earliest enqueued first); completed units follow (group 1), most
 * recently downloaded first. Applied to both series (via their earliest-pending / latest-completed
 * chapter) and individual chapters.
 */
export function chapterSortValue(c: DownloadedChapter): [number, number] {
  if (c.state !== 'complete') return [0, c.addedAt];
  return [1, -(c.completedAt ?? c.addedAt)];
}

export function seriesSortValue(chapters: DownloadedChapter[]): [number, number] {
  const pending = chapters.filter((c) => c.state !== 'complete');
  if (pending.length > 0) return [0, Math.min(...pending.map((c) => c.addedAt))];
  const last = Math.max(0, ...chapters.map((c) => c.completedAt ?? c.addedAt));
  return [1, -last];
}

/** Ascending comparator over a `[group, tiebreak]` sort value. */
export function bySortValue(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}
