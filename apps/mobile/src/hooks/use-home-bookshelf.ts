import { observable } from '@legendapp/state';
import { use$, useSelector } from '@legendapp/state/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { coalesceActivity, type SeriesActivity } from '@/data/activity/feed-rows';
import { activityQuery, historyQuery, libraryQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { HistoryEntry, SeriesDetail } from '@/data/types';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';
import type { CoverForm, ReadingDirection } from '@/lib/book-cover';
import { arrangeShelf, pickShelf } from '@/lib/bookshelf';
import { persisted$ } from '@/lib/observable';
import { PROFILING_ENABLED } from '@/lib/profiling';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const bookshelf$ = persisted$<{ on: boolean; stats?: boolean }>('comical:homeBookshelf', { on: true });

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

/** Whether the shelf says how its frames are going (Settings → Developer): a line over the stage,
 *  and one in the Diagnostics log for each time it has moved. Nothing else measures them on a
 *  device. Only in a build that has that screen: the choice is kept on the device, and a release
 *  installed over a PR build would show the line with no switch to turn it off. */
export function useHomeBookshelfStats(): boolean {
  return useSelector(() => PROFILING_ENABLED && (bookshelf$.stats.get() ?? false));
}

export const homeBookshelfStats = () => PROFILING_ENABLED && (bookshelf$.stats.peek() ?? false);

export function setHomeBookshelfStats(on: boolean): void {
  bookshelf$.stats.set(on);
}

/** False once the shelf's renderer has failed to start on this device. */
export function useHomeBookshelfAvailable(): boolean {
  return !use$(unavailable$);
}

export function markHomeBookshelfUnavailable(): void {
  unavailable$.set(true);
}

/** As many books as the shelf holds; the tabs hold the rest. Only those near the front are drawn,
 *  so the number costs a cover's picture each and little else. */
const SHELF_BOOKS = 30;

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
  /** What the series says it is as an object, and how it reads: its card's own hints. */
  coverForm?: CoverForm;
  readingDirection?: ReadingDirection;
};

/**
 * The shelf's books: half what was read last (the History tab's rows) and half what has new
 * chapters waiting (the Activity tab's unread rows), each making up the number where the other runs
 * short (`pickShelf`), stood with what matters most in the middle (`arrangeShelf`). The same
 * queries those tabs read, so the shelf cannot say something they don't.
 *
 * A History row says what its series is as an object (`coverForm`), written with the read that
 * made it. Without that a CG set from a bridge of doujinshi stood on the shelf as a doujinshi: the
 * details that knew are not kept past the session. A row older than the hints, and an Activity
 * row, are asked of the library, then of the details where they have been read.
 */
export function useBookshelfEntries(enabled: boolean): BookshelfEntry[] {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data: history } = useQuery({ ...historyQuery(ds, mock), enabled });
  const { data: activity } = useQuery({ ...activityQuery(ds, mock), enabled });
  const { data: collected } = useQuery({ ...libraryQuery(ds, mock, '', 'lastRead'), enabled });
  const read = useVisibleByBridge(history);
  const news = useVisibleByBridge(activity);
  const cache = useQueryClient();
  return useMemo(() => {
    const keyOf = (s: { bridgeId: string; seriesId: string }) => `${s.bridgeId}:${s.seriesId}`;
    const left = new Map<string, HistoryEntry>(read.map((h) => [keyOf(h), h]));
    const waiting = new Map<string, SeriesActivity>(
      coalesceActivity(news)
        .filter((g) => g.newCount > 0)
        .map((g) => [keyOf(g), g]),
    );
    const kept = new Map((collected ?? []).map((e) => [keyOf(e), e]));
    const shown = read.filter((h) => !h.hidden).map(keyOf);
    return arrangeShelf(pickShelf(shown, [...waiting.keys()], SHELF_BOOKS)).map((key) => {
      const h = left.get(key);
      const g = waiting.get(key);
      const { bridgeId, seriesId, title, thumbnailUrl } = (h ?? g)!;
      // Its history row says since rows kept it; a row older than that is asked of the library,
      // then of the details where they have been read this session.
      const says =
        (h?.coverForm !== undefined || h?.readingDirection !== undefined ? h : undefined) ??
        kept.get(key) ??
        [true, false].map((direct) => cache.getQueryData<SeriesDetail>(queryKeys.seriesDetail(mock, bridgeId, seriesId, direct))).find(Boolean);
      return {
        key,
        bridgeId,
        seriesId,
        title,
        thumbnailUrl,
        history: h,
        news: g,
        unread: g?.newCount ?? 0,
        chapters: kept.get(key)?.known || undefined,
        coverForm: says?.coverForm,
        readingDirection: says?.readingDirection,
      };
    });
  }, [read, news, collected, cache, mock]);
}
