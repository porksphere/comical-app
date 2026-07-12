import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { historyQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';

/**
 * "Where does Read take you?" — the resume point for one series, and the push that opens it.
 *
 * Deliberately CHEAP: it costs one lookup in the reading-history list the app already has cached, and
 * never fetches anything. If the series has a history entry, Read continues from there (that chapter,
 * that page) — and the entry carries the chapter's own name, so the label is free too. If it doesn't,
 * Read simply opens the reader with no chapter, and the READER resolves the first chapter in reading
 * order once it's there. That's the whole point: the reader already loads the chapter list (it needs
 * it for next/prev anyway), so nothing has to fetch a chapter list just to render a "Read" row on a
 * card you long-pressed.
 *
 * Shared by the series screen's primary button (and its tappable cover) and the card long-press
 * menu's Read row, so the two can't drift into resuming at different places.
 */
export type StartReading = {
  /** Undecorated label: "Resume Ch. 12", the bridge's own read label, or plain "Read". */
  label: string;
  /** The history entry, when this series has been read before. */
  resume?: HistoryEntry;
  /** Open the reader at the resume point (or the first chapter / page 0). */
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
}): StartReading {
  const { bridgeId, seriesId, title, direct, readLabel } = opts;
  const router = useRouter();
  const ds = useDataSource();
  const mock = useMockActive();

  const { data: history } = useQuery(historyQuery(ds, mock));
  const resume = history?.find((h) => h.bridgeId === bridgeId && h.seriesId === seriesId);

  // The bridge's readLabel only ever names the FIRST chapter — it has no notion of this device's
  // local reading history, so a resumed series names its own chapter instead (free: it's in `resume`).
  const label = resume ? (resume.chapterName ? `Resume ${resume.chapterName}` : 'Resume') : (readLabel ?? 'Read');

  const start = () => {
    const params: Record<string, string> = { seed: seriesId, title, start: '0' };
    if (bridgeId) params.bridgeId = bridgeId;

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
    // Neither branch taken (a chaptered series, never read): no chapterId and no `direct` — the
    // reader reads that as "start at the first chapter" and resolves it from the list it loads anyway.
    router.push({ pathname: '/reader', params });
  };

  return { label, resume, start };
}
