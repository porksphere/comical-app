/**
 * The params a History or Activity row opens its series with, and the same open as a link.
 *
 * Here, apart from the screens, because the rows are also drawn outside the app: a home-screen
 * widget's row has to open exactly what the row in the tab opens, and it can only hold a link.
 * Free of react-native and expo-router imports so the widget feed built from it can be tested.
 */
import type { SeriesActivity } from '@/data/activity/feed-rows';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';

/**
 * Percent-encode one series route param — a bridge display name or a cover URL.
 *
 * Parens included, explicitly: `encodeURIComponent` leaves '(' and ')' alone (they're unreserved),
 * and expo-router's href resolution breaks on literal parens in a param value. Real bridge names
 * carry them all the time ("Illustration Gallery (Demo)"), as do plenty of cover URLs. The series
 * page decodes with a single `decodeURIComponent`, which handles %28/%29 like any other escape.
 */
export function encodeSeriesParam(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

type SeriesRef = { bridgeId: string; seriesId: string; title: string; thumbnailUrl?: string };
/** What a row needs of its bridge: the name the series page shows, and its `direct` capability. */
export type BridgeFacts = { name: string; direct: boolean };

function seriesParams(s: SeriesRef, bridgeName: string): Record<string, string> {
  return {
    id: s.seriesId,
    title: s.title,
    bridge: encodeSeriesParam(bridgeName),
    bridgeId: s.bridgeId,
    ...(s.thumbnailUrl ? { cover: encodeSeriesParam(s.thumbnailUrl) } : {}),
  };
}

/** The series on its details page. */
export function seriesDetailParams(s: SeriesRef, bridge: BridgeFacts): Record<string, string> {
  return { ...seriesParams(s, bridge.name), ...(bridge.direct ? { direct: '1' } : {}) };
}

/** A History row: the reader, where the series was left. The read position goes along (the row
 *  already knows it), which is what lets the page be asked for ahead of the series detail. */
export function historyResumeParams(h: HistoryEntry, bridgeName: string): Record<string, string> {
  const isDirect = h.chapterId === DIRECT_CHAPTER_ID || !h.chapterId;
  return {
    ...seriesParams(h, bridgeName),
    reader: '1',
    start: String(h.lastPage ?? 0),
    ...(isDirect ? { direct: '1' } : { chapterId: h.chapterId!, chapterName: h.chapterName ?? '' }),
  };
}

/** An Activity row: the reader on the row's chapter, or the details when the row has none. */
export function activityReadParams(g: SeriesActivity, bridge: BridgeFacts): Record<string, string> {
  if (g.chapterId === undefined) return seriesDetailParams(g, bridge);
  return {
    ...seriesParams(g, bridge.name),
    reader: '1',
    chapterId: g.chapterId,
    chapterName: g.chapterName ?? '',
    start: '0',
    picked: '1',
    ...(bridge.direct ? { direct: '1' } : {}),
  };
}

/** `/series` with these params as a link into the app. Each value is escaped once more than the
 *  params hold it: parsing the link undoes one, leaving the page what a push would have handed it. */
export function seriesLink(params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeSeriesParam(value)}`)
    .join('&');
  return `comical://series?${query}`;
}
