import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { seriesGoneReason } from '@/data/api';
import {
  chapterPagesQuery,
  directPagesQuery,
  historyQuery,
  inLibraryQuery,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useMissingBridge } from '@/hooks/use-bridges';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import type { ReadTarget, SeriesReaderParams } from '@/components/series/reader-types';

/** The route params of a series page, decoded the same way series.tsx does. */
export function decodeSeriesParams(params: SeriesReaderParams) {
  const { id, bridgeId } = params;
  return {
    seriesKey: bridgeId && id ? `${bridgeId}:${id}` : null,
    bridge: params.bridge ? decodeURIComponent(params.bridge) : undefined,
    cover: params.cover ? decodeURIComponent(params.cover) : undefined,
    isDirect: params.direct === '1',
  };
}

/**
 * What the details page and the reader page both load for one series: where reading starts, that
 * spot's pages, the chapter list, library membership and the series detail.
 *
 * `pinned` overrides the resume-or-first target: the reader's own chapter navigation, or the spot
 * a reader-first open was seeded with. `off` loads nothing about the series, for a reader running
 * a sequence: its chrome describes the visible entry, and an album that wanders through five
 * series must not fetch five series' details on the way.
 */
export function useSeriesRead(
  params: SeriesReaderParams,
  { pinned, off }: { pinned: ReadTarget | null; off: boolean },
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const { id, title, bridgeId } = params;
  const isDirect = params.direct === '1';
  const { bridge, cover } = decodeSeriesParams(params);

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Chapter list (chaptered series only) — drives resume-or-first resolution and prev/next
  // adjacency for the reader pane. (The details card's own list rendering — read state, downloads,
  // versions — is SeriesBody's business, not duplicated here.)
  const { data: listData } = useQuery(seriesListQuery(ds, mock, bridgeId ?? '', id ?? '', false, !isDirect && !off));
  const chapters = listData?.chapters;

  // Library membership — tells the reader pane whether a read also has to keep the reading log's row
  // up to date (see its `record`). The query lives in the page, not in the pane:
  // the pane re-renders on every page sweep, and useQuery's per-render subscription work (query
  // key hashing) is measurable at that cadence.
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, bridgeId ?? '', id ?? ''),
    retry: false,
    enabled: !!bridgeId && !!id && !off,
  });

  // ── Where does reading start? ────────────────────────────────────────────
  // Resume from the reading history (same lookup as useStartReading — resolved here, not at the
  // card tap, so cards in recycled lists never subscribe to history), else the first chapter in
  // reading order, else — for a direct series — the pages themselves. The derived value settles
  // once the history (and, chaptered, the chapter list) is in; after that, chapter navigation
  // OVERRIDES it. The mounted pane seeds its position once at mount, so later history refetches
  // (our own progress writes invalidate it) never yank the pager.
  const { data: history, isLoading: historyLoading } = useQuery(historyQuery(ds, mock));
  const resume = useMemo(
    () => history?.find((h) => h.bridgeId === bridgeId && h.seriesId === id),
    [history, bridgeId, id],
  );
  const derivedTarget: ReadTarget | null = useMemo(() => {
    if (historyLoading) return null;
    if (isDirect) {
      const resumeDirect = resume && (resume.chapterId === DIRECT_CHAPTER_ID || !resume.chapterId);
      return { start: resumeDirect ? (resume?.lastPage ?? 0) : 0 };
    }
    if (resume?.chapterId && resume.chapterId !== DIRECT_CHAPTER_ID) {
      return { chapterId: resume.chapterId, chapterName: resume.chapterName, start: resume.lastPage ?? 0 };
    }
    if (chapters?.length) {
      const first = firstChapterInReadingOrder(chapters, getPreferredGroup());
      if (first) return { chapterId: first.id, chapterName: first.name, start: 0 };
    }
    return null; // chapter list still loading (or empty)
  }, [historyLoading, isDirect, resume, chapters]);
  const target = pinned ?? derivedTarget;
  const targetChapterId = target?.chapterId;

  // Keep next/prev chapter following the same scanlation group.
  useEffect(() => {
    if (!targetChapterId) return;
    const group = chapters?.find((c) => c.id === targetChapterId)?.group;
    if (group !== undefined) setPreferredGroup(group);
  }, [targetChapterId, chapters]);

  // The target chapter's pages (or the direct page list). Cached per chapter, so revisiting one
  // (or skipping back) repaints from the query cache.
  const {
    data: pages = null,
    error: queryError,
    refetch,
  } = useQuery({
    ...(targetChapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', targetChapterId)
      : directPagesQuery(ds, mock, bridgeId ?? '', id ?? '')),
    // A DIRECT series' page list is just "this series' pages" — `directPagesQuery` takes nothing
    // from the read target, so waiting for one held it behind the history query for no reason
    // (history only decides which PAGE to land on, which the pane needs, not which request to
    // make). Chaptered still waits, and genuinely must: until the target resolves there is no
    // chapter id, and firing without one would ask `directPagesQuery` for a series that has none.
    enabled: !!id && (isDirect || !!target) && !off,
  });
  // Series detail for the bars' titles and the reader's settings (placeholder-seeded from the
  // forwarded title+cover). The details card's SeriesDetailsHost subscribes to this same query
  // key, so this costs one fetch total.
  const { data: series = null } = useQuery({
    ...seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
    // `!!id` preserves the option's own guard, which this override replaces.
    enabled: !!id && !off,
  });
  // ORDERING, and why this query sits HERE rather than first. React Query dispatches on mount
  // effects, which run in hook order, so declaration order IS request order for anything enabled
  // on the first commit. That gives both directions for free:
  //   · a BROWSE open — the pages query above is gated on a resolved read target, which needs
  //     history (and, chaptered, the chapter list) to come back first. Detail is dispatched at
  //     mount and wins by a mile; it needs no gate of its own.
  //   · a READER-FIRST open — the row seeds `pinned` from its own params, so the pages query is
  //     live on the first commit and, being declared above, is dispatched first. Which is the
  //     ordering History and Activity want: the page they tapped to keep reading, then the rest.
  // Both matter on device, where the on-device runtime serves everything through one in-process
  // transport and order of arrival is order of service.
  //
  // What this replaced was `/series`'s `detailStarted` rule — an `enabled` gate on the pages query,
  // true once detail was in flight. Hook order already guarantees that, and can express the
  // reverse as well, which a gate cannot: a gate only ever holds one query back, it can never swap
  // which goes first. Nothing here delays a request that is ready to go.

  const error = !off && queryError ? (queryError as Error).message || 'Failed to load pages' : null;
  // The bridge's own error for a bridge that isn't there is a server path and a Retry that can't work.
  const missingBridge = useMissingBridge(off ? undefined : bridgeId);
  const pagesGone = !off && seriesGoneReason(queryError) !== undefined;

  return {
    chapters,
    inLibrary,
    resume,
    target,
    targetChapterId,
    pages,
    refetch,
    series,
    error,
    missingBridge,
    pagesGone,
  };
}
