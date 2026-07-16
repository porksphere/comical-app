/**
 * Pure helpers deriving a series' rolled-up download state/progress from its chapters, plus the
 * queue-then-recency ordering the Downloads screen uses. Shared by the screen and the series Download
 * button so both agree on "is this in progress, and how far."
 *
 * These read the manifest directly. The engine patches the manifest query caches page-by-page (see
 * engine.ts `patchProgressCaches`), so a chapter's `state` / `completedPages` / `bytes` advance as it
 * downloads and these derivations re-render through the reliable TanStack Query subscription — no
 * separate live-progress overlay needed.
 */
import type { DownloadedChapter, DownloadState, StorageUsageSeries } from '@comical/downloads';

/** The state to DISPLAY for a chapter — straight from the (per-page-patched) manifest. */
export function displayChapterState(c: DownloadedChapter): DownloadState {
  return c.state;
}

/**
 * A series' single rolled-up state, from its chapters' states. `paused` only when EVERY not-yet-
 * complete chapter is paused (so the row offers Resume); otherwise the most action-worthy active
 * state wins.
 */
export function deriveSeriesState(chapters: DownloadedChapter[]): DownloadState {
  const nonComplete = chapters.map((c) => c.state).filter((s) => s !== 'complete');
  if (nonComplete.length === 0) return 'complete';
  if (nonComplete.every((s) => s === 'paused')) return 'paused';
  if (nonComplete.some((s) => s === 'downloading')) return 'downloading';
  if (nonComplete.some((s) => s === 'failed')) return 'failed';
  return 'queued';
}

/** Series progress [0,1] across all its pages. */
export function seriesFraction(chapters: DownloadedChapter[]): number {
  let done = 0;
  let total = 0;
  for (const c of chapters) {
    total += c.pageCount;
    done += c.completedPages;
  }
  return total > 0 ? done / total : 0;
}

export function isInProgress(state: DownloadState): boolean {
  return state !== 'complete';
}

/**
 * Chapter sort value: [group, tiebreak] compared ascending. Finished chapters come FIRST (group 0),
 * in sequential **chapter-number** order — so a downloaded series reads top-to-bottom like its chapter
 * list (not scrambled by download-completion time or by name text). The still-downloading/queued/
 * failed chapters follow (group 1), in queue order (earliest enqueued first). Chapters without a
 * decimal number fall to the end of their group.
 */
export function chapterSortValue(c: DownloadedChapter): [number, number] {
  if (c.state === 'complete') return [0, c.number ?? Number.MAX_SAFE_INTEGER];
  return [1, c.addedAt];
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

/**
 * Cumulative progress across EVERY downloaded series — the numerator/denominator for the big radial
 * on the Downloads page and the small one on the Settings row. `inProgress` is true while anything
 * isn't complete (the radials show only then).
 */
export function overallProgress(bySeries: StorageUsageSeries[]): { fraction: number; inProgress: boolean } {
  let done = 0;
  let total = 0;
  let inProgress = false;
  for (const s of bySeries) {
    for (const c of s.chapters) {
      total += c.pageCount;
      done += c.completedPages;
      if (c.state !== 'complete') inProgress = true;
    }
  }
  return { fraction: total > 0 ? done / total : 0, inProgress };
}
