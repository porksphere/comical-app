import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { historyQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type Chapter, type HistoryEntry } from '@/data/types';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
import { usePreferredGroup } from '@/lib/preferred-group';

/**
 * "Where does Read take you?" — the resume point for one series, and the push that opens it.
 *
 * If the series has a reading-history entry, Read continues from there (that chapter, that page);
 * otherwise it starts at the first chapter in reading order — preferring the scanlation group the
 * user last read this series from, not an arbitrary copy — or page 0 for a direct (chapterless)
 * series. The history lookup is local and cheap: one shared `historyQuery` the whole app already
 * subscribes to, scanned for this bridge + series.
 *
 * Shared by the series screen's primary button (and its tappable cover) and the card long-press
 * menu's Read row, so the two can't drift into resuming at different places.
 */
export type StartReading = {
  /** Undecorated label: "Resume Ch. 12", the bridge's own read label, or plain "Read". */
  label: string;
  /** The history entry, when this series has been read before. */
  resume?: HistoryEntry;
  /** A chaptered series can't be opened until its chapter list lands. */
  disabled: boolean;
  /**
   * True when the caller must FETCH the chapter list before Read can work: a chaptered series with
   * no resume point, whose first chapter is the only thing that says where to start. Direct series
   * read from page 0 and a resume entry carries its own chapter, so neither needs the list — pass
   * this as the list query's `enabled` and those cases cost nothing. Stays false until the history
   * lookup has settled, so a series that turns out to have a resume point never fetches at all.
   */
  needsChapterList: boolean;
  /** Open the reader at the resume point (or the first chapter / page 0). */
  start: () => void;
};

/**
 * This series' reading-history entry, if it has one. Split out from `useStartReading` because a
 * caller may need to know whether a resume point exists BEFORE it decides to fetch the chapter list
 * that `useStartReading` wants — and a hook can't depend on a query whose `enabled` depends on the
 * hook. Both read the same cached `historyQuery`, so asking twice costs one lookup, not one fetch.
 */
export function useResumeEntry(bridgeId: string | undefined, seriesId: string) {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data: history, isPending } = useQuery(historyQuery(ds, mock));
  return {
    resume: history?.find((h) => h.bridgeId === bridgeId && h.seriesId === seriesId),
    /** The lookup hasn't settled yet — don't conclude "no resume point" from it. */
    pending: isPending,
  };
}

export function useStartReading(opts: {
  bridgeId?: string;
  seriesId: string;
  title: string;
  /** A direct (chapterless) series — its pages ARE the series. */
  direct: boolean;
  /** The chapter list, once loaded (chaptered series only). */
  chapters?: Chapter[];
  /** True while that list is in flight. */
  chaptersLoading?: boolean;
  /** The bridge's own label for the first chapter ("Read Ch. 1"), when it supplies one. */
  readLabel?: string;
}): StartReading {
  const { bridgeId, seriesId, title, direct, chapters, chaptersLoading, readLabel } = opts;
  const router = useRouter();
  const preferredGroup = usePreferredGroup();
  const { resume, pending: historyPending } = useResumeEntry(bridgeId, seriesId);

  // The bridge's readLabel only ever names the FIRST chapter — it has no notion of this device's
  // local reading history, so a resumed series names its own chapter instead.
  const label = resume ? (resume.chapterName ? `Resume ${resume.chapterName}` : 'Resume') : (readLabel ?? 'Read');
  const disabled = !direct && !resume && !!chaptersLoading;
  const needsChapterList = !direct && !resume && !historyPending;

  const start = () => {
    if (disabled) return;
    const params: Record<string, string> = { seed: seriesId, title, start: '0' };
    if (bridgeId) params.bridgeId = bridgeId;

    if (resume) {
      // A direct series records the DIRECT_CHAPTER_ID sentinel rather than a real chapter id.
      const resumeDirect = resume.chapterId === DIRECT_CHAPTER_ID || !resume.chapterId;
      params.start = String(resume.lastPage ?? 0);
      if (!resumeDirect) {
        params.chapterId = resume.chapterId!;
        params.chapterName = resume.chapterName ?? '';
      } else if (direct) {
        params.direct = '1';
      }
      router.push({ pathname: '/reader', params });
      return;
    }

    if (direct) {
      params.direct = '1';
    } else if (chapters?.length) {
      // First in READING order (by number, preferring the user's group) — not the array's last item.
      const first = firstChapterInReadingOrder(chapters, preferredGroup);
      if (first) {
        params.chapterId = first.id;
        params.chapterName = first.name;
      }
    }
    router.push({ pathname: '/reader', params });
  };

  return { label, resume, disabled, needsChapterList, start };
}
