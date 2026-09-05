import { useQuery } from '@tanstack/react-query';

import { historyQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';
import { shortChapterName } from '@/lib/chapter-label';
import { useRouter } from '@/lib/nav';
import { drillSeriesFromOverlay, encodeSeriesParam } from '@/lib/series-nav';

/**
 * "Where does Read take you?" — the resume point for one series, and the push that opens it.
 *
 * Deliberately CHEAP: it costs one lookup in the reading-history list the app already has cached, and
 * never fetches anything. If the series has a history entry, Read continues from there (that chapter,
 * that page) — and the entry carries the chapter's own name, so the label is free too. If it doesn't,
 * Read opens the series page with no read target, and THAT screen resolves the first chapter in
 * reading order once its chapter list lands. That's the whole point: the series page already loads
 * the chapter list (it needs it for next/prev anyway), so nothing has to fetch a chapter list just to
 * render a "Read" row on a card you long-pressed.
 *
 * Read opens `/series` READER-FIRST — the combined page, showing the reader with the details a swipe
 * away below it, exactly how a History row enters. There is no separate reader route to push: the
 * details and the pages are one screen now, and arriving on the reader side of it is the difference
 * between "carry on reading" and "show me this series".
 *
 * Used by the card long-press menu's Read row. The series page's own primary button doesn't push
 * anything (it's already there — it expands its in-place reader), but it reads the `label` and
 * `resume` from here so the two can't name, or resume at, different places.
 */
export type StartReading = {
  /** Undecorated label: "Resume Ch. 12", the bridge's own read label, or plain "Read". */
  label: string;
  /** The history entry, when this series has been read before. */
  resume?: HistoryEntry;
  /** Open the series page on its reader, at the resume point (or the first chapter / page 0). */
  start: () => void;
};

export function useStartReading(opts: {
  bridgeId?: string;
  seriesId: string;
  title: string;
  /** A direct (chapterless) series — its pages ARE the series. */
  direct: boolean;
  /** The bridge's own label for the first chapter ("Read Ch. 1"), when it supplies one. */
  readLabel?: string;
  /** The bridge's display name and the cover the caller already has, forwarded so the series page
   *  paints its header and hero from frame one instead of shimmering until the detail resolves —
   *  the same two params a tapped card carries. */
  bridge?: string;
  cover?: string;
}): StartReading {
  const { bridgeId, seriesId, title, direct, readLabel, bridge, cover } = opts;
  const router = useRouter();
  const ds = useDataSource();
  const mock = useMockActive();

  const { data: history } = useQuery(historyQuery(ds, mock));
  const resume = history?.find((h) => h.bridgeId === bridgeId && h.seriesId === seriesId);

  // The bridge's readLabel only ever names the FIRST chapter — it has no notion of this device's
  // local reading history, so a resumed series names its own chapter instead (free: it's in `resume`).
  const label = resume ? (resume.chapterName ? `Resume ${shortChapterName(resume.chapterName)}` : 'Resume') : (readLabel ?? 'Read');

  const start = () => {
    const params: Record<string, string> = { id: seriesId, title, reader: '1', start: '0' };
    if (bridgeId) params.bridgeId = bridgeId;
    if (bridge) params.bridge = encodeSeriesParam(bridge);
    if (cover) params.cover = encodeSeriesParam(cover);

    if (resume) {
      // A direct series records the DIRECT_CHAPTER_ID sentinel rather than a real chapter id.
      const resumeDirect = resume.chapterId === DIRECT_CHAPTER_ID || !resume.chapterId;
      params.start = String(resume.lastPage ?? 0);
      if (resumeDirect) params.direct = '1';
      else {
        params.chapterId = resume.chapterId!;
        params.chapterName = resume.chapterName ?? '';
      }
    } else if (direct) {
      params.direct = '1';
    }
    // Neither branch taken (a chaptered series, never read): no chapterId and no `direct`, so the
    // series page has no seeded read target and resolves the first chapter from the list it loads
    // anyway. That's the ONE case Read waits on a request, and it's the case that has to.
    openSeriesReader(router, params);
  };

  return { label, resume, start };
}

/**
 * Push the series page — or, when one is already mounted, hand the series to ITS layer stack. The
 * long-press menu is a root overlay, so it can be opened over a related rail INSIDE a series page,
 * where a push would stack a second contained transparent modal (which iOS drops the middle screen
 * of — see lib/series-nav). Everywhere else there's no series page mounted and this is a plain push.
 */
function openSeriesReader(router: ReturnType<typeof useRouter>, params: Record<string, string>): void {
  if (drillSeriesFromOverlay(params)) return;
  router.push({ pathname: '/series', params });
}
