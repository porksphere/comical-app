import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';
import { relTime } from '@/lib/rel-time';

/**
 * A History row's secondary line: `chapter · X / N · when`, omitting absent parts. `long` spells the
 * page out (`Page X of N`) for a row with the width for it.
 */
export function historySub(h: HistoryEntry, { withTime, long }: { withTime: boolean; long: boolean }): string {
  const isDirect = h.chapterId === DIRECT_CHAPTER_ID;
  const chapter = !isDirect && h.chapterName ? h.chapterName : '';
  const page =
    h.lastPage === undefined
      ? ''
      : long
        ? h.pageCount
          ? `Page ${h.lastPage + 1} of ${h.pageCount}`
          : `Page ${h.lastPage + 1}`
        : h.pageCount
          ? `${h.lastPage + 1} / ${h.pageCount}`
          : `${h.lastPage + 1}`;
  return [chapter, page, withTime ? relTime(h.lastReadAt) : ''].filter(Boolean).join('  ·  ');
}

/** Pages seen of the chapter being read, 0–1. Undefined while the page count isn't known (or for
 *  a direct read, which has no chapter). */
export function historyProgress(h: HistoryEntry): number | undefined {
  return h.lastPage !== undefined && h.pageCount ? (h.lastPage + 1) / h.pageCount : undefined;
}
