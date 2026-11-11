/**
 * The home-screen widgets' feed: the History and Activity tabs' newest rows, as the widget
 * extension (`targets/widgets`) decodes them. The widget draws what it is handed and opens the
 * link it is handed, so everything a row says, and where it goes, is decided here from the same
 * helpers the tabs' own rows use.
 *
 * The file's format is a contract with native code on each platform: `docs/WIDGETS.md`.
 *
 * Free of react-native imports so it can be tested; `./publish.ts` does the fetching and writing.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { historyProgress, historySub } from '@/lib/history-sub';
import { activityReadParams, historyResumeParams, seriesLink } from '@/lib/series-links';
import { activityLabel, coalesceActivity } from '../activity/feed-rows';
import { withoutNsfw } from '../known-bridges';
import type { ActivityEntry, Bridge, HistoryEntry } from '../types';

/** A row as `Feed.swift` decodes it. */
export type WidgetItem = {
  id: string;
  title: string;
  detail: string;
  /** When the row last moved (epoch ms). The widget words the age itself, as time passes. */
  at: number;
  /** A file in the shared folder's `covers`, once the cover has been stored there. */
  cover?: string;
  progress?: number;
  /** How many chapters of the row are unread: the count pill the Activity tab's row wears. */
  badge?: string;
  url: string;
};

/** A row before its cover is stored: the cover is still the URL the app would load. */
export type WidgetRow = Omit<WidgetItem, 'cover'> & { thumbnailUrl?: string };

/** The most rows any widget size shows. */
export const WIDGET_ROWS = 5;

const facts = (known: Map<string, Bridge>, bridgeId: string) => {
  const bridge = known.get(bridgeId);
  return { name: bridge?.name ?? bridgeId, direct: bridge?.capabilities.includes('direct') ?? false };
};

/** The History tab's newest rows. A tap carries on reading, as the tab's row does. */
export function historyRows(entries: HistoryEntry[], known: Map<string, Bridge>, hideNsfw: boolean): WidgetRow[] {
  const visible = (hideNsfw ? withoutNsfw(entries, known) : entries).filter((h) => !h.hidden);
  return visible.slice(0, WIDGET_ROWS).map((h) => {
    const progress = historyProgress(h);
    return {
      id: `${h.bridgeId}:${h.seriesId}`,
      title: h.title,
      detail: historySub(h, { withTime: false, long: false }),
      at: h.lastReadAt,
      ...(progress !== undefined && { progress }),
      ...(h.thumbnailUrl && { thumbnailUrl: h.thumbnailUrl }),
      url: seriesLink(historyResumeParams(h, facts(known, h.bridgeId).name)),
    };
  });
}

/** The Activity tab's rows with chapters still to read. A tap reads the row's chapter. */
export function activityRows(entries: ActivityEntry[], known: Map<string, Bridge>, hideNsfw: boolean): WidgetRow[] {
  const rows = coalesceActivity(hideNsfw ? withoutNsfw(entries, known) : entries).filter((g) => g.hasUnread);
  return rows.slice(0, WIDGET_ROWS).map((g) => {
    const bridge = facts(known, g.bridgeId);
    return {
      id: `${g.bridgeId}:${g.seriesId}`,
      title: g.title,
      detail: activityLabel(g, bridge.name),
      at: g.latestAt,
      badge: String(g.newCount),
      ...(g.thumbnailUrl && { thumbnailUrl: g.thumbnailUrl }),
      url: seriesLink(activityReadParams(g, bridge)),
    };
  });
}

/** The file a cover is stored under: named for its URL, so a cover already stored is found again
 *  and never rendered twice. */
export function coverFileName(thumbnailUrl: string): string {
  return `${bytesToHex(sha256(utf8ToBytes(thumbnailUrl))).slice(0, 24)}.jpg`;
}

/** A row as written: its cover's file where `stored` has one, no cover otherwise. */
export function toWidgetItem({ thumbnailUrl, ...row }: WidgetRow, stored: ReadonlyMap<string, string>): WidgetItem {
  const cover = thumbnailUrl ? stored.get(thumbnailUrl) : undefined;
  return cover ? { ...row, cover } : row;
}
