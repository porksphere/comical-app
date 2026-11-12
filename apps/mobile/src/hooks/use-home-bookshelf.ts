import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { coalesceActivity, type SeriesActivity } from '@/data/activity/feed-rows';
import { activityQuery, historyQuery, libraryQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { HistoryEntry } from '@/data/types';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';
import { pickShelf } from '@/lib/bookshelf';
import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const bookshelf$ = persisted$('comical:homeBookshelf', { on: true });

/** Whether Comical Home opens on the bookshelf (Settings → General; on unless turned off). A
 *  `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useHomeBookshelf(): boolean {
  return use$(bookshelf$.on) ?? true;
}

export function setHomeBookshelf(on: boolean): void {
  bookshelf$.on.set(on);
}

// For the session, not persisted: a renderer that could not start once is not asked again until
// the app is next opened, by which time it may be a build or a driver that can.
const unavailable$ = observable(false);

/** False once the shelf's renderer has failed to start on this device. */
export function useHomeBookshelfAvailable(): boolean {
  return !use$(unavailable$);
}

export function markHomeBookshelfUnavailable(): void {
  unavailable$.set(true);
}

/** As many books as read as a shelf rather than a library; the tabs hold the rest. */
const SHELF_BOOKS = 12;

export type BookshelfEntry = {
  /** `bridgeId:seriesId`. */
  key: string;
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  /** Where the series was left: its History row, hidden or not. None for one never opened. */
  history?: HistoryEntry;
  /** Its Activity row, while it has chapters waiting. */
  news?: SeriesActivity;
  /** New chapters not yet read, as the Activity tab counts them. */
  unread: number;
  /** Chapters known, for a collected series: how thick its book is. */
  chapters: number | undefined;
};

/**
 * The shelf's books: half what was read last (the History tab's rows) and half what has new
 * chapters waiting (the Activity tab's unread rows), each making up the number where the other runs
 * short (`pickShelf`). The same queries those tabs read, so the shelf cannot say something they
 * don't.
 */
export function useBookshelfEntries(enabled: boolean): BookshelfEntry[] {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data: history } = useQuery({ ...historyQuery(ds, mock), enabled });
  const { data: activity } = useQuery({ ...activityQuery(ds, mock), enabled });
  const { data: collected } = useQuery({ ...libraryQuery(ds, mock, '', 'lastRead'), enabled });
  const read = useVisibleByBridge(history);
  const news = useVisibleByBridge(activity);
  return useMemo(() => {
    const keyOf = (s: { bridgeId: string; seriesId: string }) => `${s.bridgeId}:${s.seriesId}`;
    const left = new Map<string, HistoryEntry>(read.map((h) => [keyOf(h), h]));
    const waiting = new Map<string, SeriesActivity>(
      coalesceActivity(news)
        .filter((g) => g.newCount > 0)
        .map((g) => [keyOf(g), g]),
    );
    const known = new Map<string, number>((collected ?? []).map((e) => [keyOf(e), e.known]));
    const shown = read.filter((h) => !h.hidden).map(keyOf);
    return pickShelf(shown, [...waiting.keys()], SHELF_BOOKS).map((key) => {
      const h = left.get(key);
      const g = waiting.get(key);
      const { bridgeId, seriesId, title, thumbnailUrl } = (h ?? g)!;
      return { key, bridgeId, seriesId, title, thumbnailUrl, history: h, news: g, unread: g?.newCount ?? 0, chapters: known.get(key) || undefined };
    });
  }, [read, news, collected]);
}
