import type { ReaderSequenceEntry } from '@/hooks/use-reader-sequence';

/** What the reader pane is pointed at: a chapter (chaptered series) or the series itself (direct).
 *  `start: 'last'` = land on the final page (arriving from the NEXT chapter's "previous").
 *  `picked`: chosen from the details card (a page thumbnail, a chapter row), which is a read in
 *  itself — see ReaderPane's `picked`. */
export type ReadTarget = { chapterId?: string; chapterName?: string; start: number | 'last'; picked?: boolean };

/**
 * A cross-series READER SEQUENCE — what the pager runs over when the reader was opened from a
 * collection rather than a chapter (see use-reader-sequence.ts). ONE instance serves the whole
 * album, and the pager never remounts: the sequence is its page list VERBATIM, so a series cross
 * is literally a page turn — the exact discipline that makes a stitched chapter crossing
 * seamless, applied one level up. What a cross changes is only what a stitched crossing's relabel
 * changes: the chrome and the details layer RE-POINT to the visible entry's series (query keys
 * and the details host's key — see `detailBridgeId`/`detailSeriesId` in the instance), while
 * everything mounted keeps its state. No chapter target, no stitching, no adjacency, no progress
 * recording — the sequence is the run.
 */
export type ReaderSequenceRun = {
  /** Resolved page URIs, one per entry ('' = still resolving → the page's own skeleton). */
  uris: string[];
  entries: ReaderSequenceEntry[];
  /** The entry the album OPENED on — seeds the pager once; position then lives in the pager. */
  index: number;
};

/** One chapter's worth of pages inside the native pager's stitched flat list — what makes a
 *  boundary swipe an ordinary page turn instead of a bounce-and-remount. */
export type Segment = { id: string; name?: string; pages: string[] };

/** "No window (yet)", as ONE array rather than a fresh `[]` per render: the run merge feeds an
 *  adjust-state-on-render `setRun`, which compares by identity — a new empty array every render is
 *  an infinite one. */
export const NO_SEGMENTS: Segment[] = [];

/** Same params a series card forwards to `/series` (see series-card.tsx buildHref) — including
 *  the percent-encoded bridge name / cover, decoded the same way series.tsx does. */
export type SeriesReaderParams = {
  id?: string;
  title?: string;
  bridge?: string;
  bridgeId?: string;
  cover?: string;
  /** '1' for a direct (chapterless) series — its pages ARE the series. */
  direct?: string;
  /** '1' opens straight into the READER rather than the details — how History and Activity enter,
   *  since a row there is a "carry on reading" action. A swipe up brings the details in, exactly
   *  as it does after expanding from a browse open. */
  reader?: string;
  /** Reader-first entries seed the read position directly instead of resolving it from history:
   *  the row already knows where it left off, and this is what lets the pages request go out on
   *  the first commit (see the fetch ordering below). */
  chapterId?: string;
  chapterName?: string;
  start?: string;
  /** '1' when the seeded spot was PICKED (a page in a card's preview rail, a tap in a sequence's
   *  details, a new chapter in Activity) rather than resumed — see ReadTarget's `picked`. */
  picked?: string;
  /** 'details' on a split reader the details page pushed (SeriesSplit): its Details button goes
   *  back to them. */
  from?: string;
};
