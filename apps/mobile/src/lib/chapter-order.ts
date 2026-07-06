import type { Chapter } from '@/data/types';

// Chapter ordering, shared by the series screen's chapter list, the reader's
// auto-advance, and the "Read"/resume entry points. A bridge's array order and
// `date` (publish timestamp) are NOT reliable proxies for reading order —
// same-day batch drops, backfills/re-scans, and bonus chapters uploaded out of
// order all produce an order that disagrees with the actual chapter sequence.
// So reading order is derived from the parsed chapter *number* first, falling
// back to `date` only when a number can't be parsed (a oneshot/extra) or both
// sides parse to the same number. Everything that needs "what comes next" must
// go through here rather than indexing the raw array, so it can't silently
// assume a newest-first (or oldest-first) layout the bridge never promised.

/** Pulls the chapter number out of a display name like "Chapter 176 — The Spirit
 *  Zone" (preferring a number right after "chapter"/"ch.", so a stray number
 *  elsewhere in a title doesn't win) — `null` for names with no parseable number
 *  (a oneshot/extra), which falls back to sorting by `date` instead. */
export function chapterNumber(name: string): number | null {
  const afterKeyword = name.match(/\bch(?:apter)?\.?\s*#?(\d+(?:\.\d+)?)/i);
  if (afterKeyword) return parseFloat(afterKeyword[1]);
  const anyNumber = name.match(/\d+(?:\.\d+)?/);
  return anyNumber ? parseFloat(anyNumber[0]) : null;
}

/** Compare two chapters; `asc` true = ascending reading order (Chapter 1 first). */
export function compareChapters(a: Chapter, b: Chapter, asc: boolean): number {
  const numA = chapterNumber(a.name);
  const numB = chapterNumber(b.name);
  if (numA != null && numB != null && numA !== numB) return asc ? numA - numB : numB - numA;
  return asc ? a.date - b.date : b.date - a.date;
}

/** Chapters sorted into forward reading order (Chapter 1 first), regardless of
 *  the order the bridge returned them in. */
export function chaptersInReadingOrder(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => compareChapters(a, b, true));
}

/** The chapter after `currentId` in reading order, or `null` if `currentId` is
 *  the last chapter (or isn't in the list). Order-independent — does NOT assume
 *  the array is newest- or oldest-first. */
export function nextChapterInReadingOrder(chapters: Chapter[], currentId: string): Chapter | null {
  const ordered = chaptersInReadingOrder(chapters);
  const i = ordered.findIndex((c) => c.id === currentId);
  if (i < 0 || i >= ordered.length - 1) return null;
  return ordered[i + 1];
}

/** The first chapter to read (start of reading order), or `null` if there are none. */
export function firstChapterInReadingOrder(chapters: Chapter[]): Chapter | null {
  return chaptersInReadingOrder(chapters)[0] ?? null;
}
