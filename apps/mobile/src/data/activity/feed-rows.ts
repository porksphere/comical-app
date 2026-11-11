import type { ActivityEntry } from '../types';

/**
 * One coalesced feed row: a single library series with its newly-detected chapters folded together
 * (so three new chapters read as one "3 new chapters" row, not three), sorted by the most recent of
 * those detections.
 */
export type SeriesActivity = {
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  /** When the group last had news — the sort key and the row's "when". */
  latestAt: number;
  /** How many of the group's new chapters are still unread — the "N new chapters" count. */
  newCount: number;
  /** Any unread chapter in the group (drives the accent dot; all-read rows dim). */
  hasUnread: boolean;
  /** The chapter a tap reads: the newest unread one, else the newest overall. None when the row is
   *  only a removal, and a tap opens the series instead. */
  chapterId?: string;
  chapterName?: string;
  number?: number;
  /** The source confirmed the series is gone. News, but never unread. */
  removed: boolean;
};

/**
 * Coalesce the flat per-chapter feed into one row per series. `entries` is newest-first, so a
 * series' first appearance is its newest detection (the row's snapshot + sort position), and the
 * first unread entry seen is its newest unread (the tap's read target).
 */
export function coalesceActivity(entries: ActivityEntry[]): SeriesActivity[] {
  const groups = new Map<string, { head: ActivityEntry; entries: ActivityEntry[] }>();
  for (const a of entries) {
    const key = `${a.bridgeId}:${a.seriesId}`;
    const g = groups.get(key);
    if (g) g.entries.push(a);
    else groups.set(key, { head: a, entries: [a] });
  }
  const out: SeriesActivity[] = [];
  for (const { head, entries: group } of groups.values()) {
    const chapters = group.filter((e) => !e.removed);
    const unread = chapters.filter((e) => !e.read);
    const rep = unread[0] ?? chapters[0]; // newest unread, else newest
    out.push({
      bridgeId: head.bridgeId,
      seriesId: head.seriesId,
      title: head.title,
      thumbnailUrl: head.thumbnailUrl,
      latestAt: (group.find((e) => !e.quiet) ?? head).detectedAt,
      newCount: unread.length,
      hasUnread: unread.length > 0,
      chapterId: rep?.chapterId,
      chapterName: rep?.chapterName,
      number: rep?.number,
      removed: chapters.length < group.length,
    });
  }
  // Everything still unread first, newest update first within each half — so what's left to read
  // is one block at the top and the dimmed rows a trail beneath it, rather than the two mixed in
  // date order where an unread row could sit under a page of finished ones. (Insertion order is
  // already close to the date order, but ties/interleaving make the explicit sort the source of
  // truth.) A removal has no read state to drain, so it stays up in the live block until cleared.
  const live = (r: SeriesActivity) => Number(r.hasUnread || r.removed);
  out.sort((a, b) => live(b) - live(a) || b.latestAt - a.latestAt);
  return out;
}

/** What a row has to say: `N new chapters` when several coalesce, else the chapter; a removal says
 *  so instead. */
export function activityLabel(g: SeriesActivity, bridge: string): string {
  if (g.removed) return `Removed from ${bridge}`;
  if (g.newCount > 1) return `${g.newCount} new chapters`;
  return g.chapterName ?? (g.number !== undefined ? `Chapter ${g.number}` : 'New chapter');
}
