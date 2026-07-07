import type { Chapter } from '@/data/types';

// Logical chapters (scanlator grouping) — ported from comical-web's mature
// implementation (`comical-web/client/app.ts`), and mirrored server-side by
// `@comical/library`'s logical-chapter keying so read-state stays consistent.
//
// Sites with multiple scanlation groups return one Chapter per group, so a chapter
// number can appear several times. We collapse copies that share the same
// (number, language) into one "logical chapter" and derive reading order from the
// numeric `number` — NOT the array order or `date` (publish time), neither of which
// a bridge promises tracks reading order: same-day batch drops, backfills/re-scans,
// and bonus chapters uploaded out of order all disagree with the real sequence.
// Everything that needs "what comes next" / "where do I start" must go through here
// rather than indexing the raw array, so it can't silently assume a layout the
// bridge never guaranteed. We rely on the bridge/server to supply numeric `number`;
// we deliberately do not parse it out of the display name.

/** One logical chapter: every scanlator/language copy of the same chapter number,
 *  ordered freshest-first within `versions`. */
export interface ChapterGroup {
  key: string;
  number?: number;
  languageCode?: string;
  /** Representative display name (from the default/freshest version). */
  name: string;
  versions: Chapter[];
}

/** Same logical-chapter key as the library: copies sharing (number, language)
 *  collapse; numberless chapters (oneshots/extras) stand alone, keyed by id so they
 *  never wrongly merge. */
export function chapterLogicalKey(c: Chapter): string {
  return c.number !== undefined ? `n:${c.number}:${c.languageCode ?? ''}` : `i:${c.id}`;
}

/** Collapse a chapter list into logical-chapter groups, ordered for reading
 *  (ascending number, numberless last). */
export function groupChapters(chapters: Chapter[]): ChapterGroup[] {
  const byKey = new Map<string, ChapterGroup>();
  for (const ch of chapters) {
    const key = chapterLogicalKey(ch);
    let g = byKey.get(key);
    if (!g) {
      g = { key, number: ch.number, languageCode: ch.languageCode, name: ch.name, versions: [] };
      byKey.set(key, g);
    }
    g.versions.push(ch);
  }
  // Within a group, newest first (date desc) then by group name, so the default copy is the freshest.
  for (const g of byKey.values()) {
    g.versions.sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || (a.group ?? '').localeCompare(b.group ?? ''));
    g.name = g.versions[0]!.name;
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.number !== undefined && b.number !== undefined) return a.number - b.number;
    if (a.number !== undefined) return -1; // numbered before numberless
    if (b.number !== undefined) return 1;
    return 0; // both numberless: stable (insertion order)
  });
}

/** Pick the copy of a group matching a preferred scanlation group, falling back to
 *  the first (freshest). */
export function pickVersion(group: ChapterGroup, prefGroupName?: string): Chapter {
  return group.versions.find((v) => v.group === prefGroupName) ?? group.versions[0]!;
}

/** The next (`delta` +1) or previous (`delta` -1) logical chapter to read, relative
 *  to `current`. Stays in the current chapter's language lane and, within the target,
 *  prefers the same scanlation group (falling back to the freshest copy) so a
 *  multi-scanlator series reads like one continuous run instead of cycling through
 *  every group. Returns null past either end. Order-independent — does NOT assume the
 *  array is newest- or oldest-first. */
export function getAdjacentChapter(
  chapters: Chapter[],
  current: Chapter,
  delta: 1 | -1,
  prefGroupName?: string,
): Chapter | null {
  const groups = groupChapters(chapters);
  const lane = groups.filter((g) => g.languageCode === current.languageCode);
  const idx = lane.findIndex((g) => g.key === chapterLogicalKey(current));
  if (idx !== -1) {
    const target = lane[idx + delta];
    return target ? pickVersion(target, current.group ?? prefGroupName) : null;
  }
  // Fallback for a chapter that isn't in the grouped list (e.g. a synthetic/direct read): step flat.
  const ordered = groups.flatMap((g) => g.versions);
  const flat = ordered.findIndex((c) => c.id === current.id);
  return flat === -1 ? null : (ordered[flat + delta] ?? null);
}

/** The first chapter to read (start of reading order), preferring the given
 *  scanlation group's copy, or null if there are none. */
export function firstChapterInReadingOrder(chapters: Chapter[], prefGroupName?: string): Chapter | null {
  const first = groupChapters(chapters)[0];
  return first ? pickVersion(first, prefGroupName) : null;
}
