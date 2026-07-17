/**
 * Pure selection helpers for partial series downloads — the logic behind the download sheet's
 * options and the chapter picker (see docs/download-selection-plan.md). Everything operates on
 * LOGICAL chapters (scanlator/language versions grouped, like the chapter list renders), in
 * ascending reading order, annotated with the download manifest's coverage. Pure and fs/query-free
 * so it unit-tests directly.
 */
import type { DownloadedChapter, DownloadState } from '@comical/downloads';

import type { Chapter } from '@/data/types';
import { groupChapters, pickVersion, type ChapterGroup } from '@/lib/chapter-order';

/** Manifest states that mean a chapter needs no fresh enqueue: already kept, or already tracked by
 *  the queue (a paused one resumes via Resume, not a new enqueue). `failed` is deliberately NOT here
 *  — re-enqueueing a failed chapter re-queues only its missing pages, i.e. a retry. */
const SETTLED: ReadonlySet<DownloadState> = new Set(['complete', 'queued', 'downloading', 'paused']);

/** One logical chapter with its manifest coverage, in ascending reading order. */
export interface SelectableGroup {
  group: ChapterGroup;
  /** Some version is fully downloaded (readable offline). */
  complete: boolean;
  /** Nothing to enqueue — some version is complete or actively tracked by the queue. */
  settled: boolean;
  /** No version has been read. */
  unread: boolean;
}

/** Group the raw chapter list and annotate each logical chapter with manifest coverage. */
export function selectableGroups(
  chapters: Chapter[],
  manifest: DownloadedChapter[] | null | undefined,
): SelectableGroup[] {
  const byId = new Map((manifest ?? []).map((c) => [c.chapterId, c.state]));
  return groupChapters(chapters).map((group) => {
    const states = group.versions
      .map((v) => byId.get(v.id))
      .filter((s): s is DownloadState => s !== undefined);
    return {
      group,
      complete: states.includes('complete'),
      settled: states.some((s) => SETTLED.has(s)),
      unread: group.versions.every((v) => !v.read),
    };
  });
}

/** Everything not yet kept or queued — "Download all" / "Download remaining". */
export function remaining(groups: SelectableGroup[]): ChapterGroup[] {
  return groups.filter((g) => !g.settled).map((g) => g.group);
}

/** Unread chapters not yet kept or queued — "Download unread". */
export function unread(groups: SelectableGroup[]): ChapterGroup[] {
  return groups.filter((g) => !g.settled && g.unread).map((g) => g.group);
}

/** The next `n` unread-undownloaded chapters in reading order — "Download next 10". Ascending order
 *  means the first unread chapter IS the reading position; no separate position bookkeeping. */
export function nextN(groups: SelectableGroup[], n: number): ChapterGroup[] {
  return unread(groups).slice(0, n);
}

/** This chapter through the end of reading order, minus already-kept/queued — "Download from here". */
export function fromHere(groups: SelectableGroup[], chapterId: string): ChapterGroup[] {
  const start = groups.findIndex((g) => g.group.versions.some((v) => v.id === chapterId));
  if (start === -1) return [];
  return groups.slice(start).filter((g) => !g.settled).map((g) => g.group);
}

/** Resolve logical chapters to the concrete versions to enqueue — the same version the row would
 *  open (the preferred scanlation group's copy, else the freshest). */
export function toEnqueue(groups: ChapterGroup[], preferredGroup?: string): Chapter[] {
  return groups.map((g) => pickVersion(g, preferredGroup));
}
