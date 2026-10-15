import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChapterItemSnapshotBody, LibrarySnapshot, PageItemSnapshotBody } from '@/data/api';
import { autoDownloadChapter, autoDownloadPage, autoDownloadSeries } from '@/data/downloads/auto';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/** What the picker (and the reader's save button) is filing. A discriminated union rather than an
 *  optional-fields bag, so a page target can't be built without its chapter and index. */
export type ItemTarget =
  | {
      kind: 'series';
      bridgeId: string | undefined;
      seriesId: string;
      /** Whether it's a chapterless series, when known — auto-download needs it to fetch the pages. */
      direct?: boolean;
      snapshot: () => LibrarySnapshot;
    }
  | {
      kind: 'chapter';
      bridgeId: string | undefined;
      seriesId: string;
      chapterId: string;
      snapshot: () => ChapterItemSnapshotBody;
    }
  | {
      kind: 'page';
      bridgeId: string | undefined;
      seriesId: string;
      chapterId: string;
      pageIndex: number;
      snapshot: () => PageItemSnapshotBody;
    };

/**
 * One item's saved state + collection memberships, with optimistic writes, for the picker and the
 * save buttons.
 *
 * Saved and filed are separate: an item with no memberships is saved, unfiled. The query holds
 * `null` for "not saved", so `setCollections([])` saves (or un-files) and only `remove()` deletes.
 */
export function useItemCollections(target: ItemTarget) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const { bridgeId, seriesId, kind } = target;
  const enabled = !!bridgeId && !!seriesId;

  const key =
    kind === 'series'
      ? queryKeys.seriesCollections(mock, bridgeId ?? '', seriesId)
      : kind === 'chapter'
        ? queryKeys.chapterCollections(mock, bridgeId ?? '', seriesId, target.chapterId)
        : queryKeys.pageCollections(mock, bridgeId ?? '', seriesId, target.chapterId, target.pageIndex);

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<string[] | null> => {
      if (kind === 'series') return ds.getSeriesCollections(bridgeId!, seriesId, signal);
      // There is no per-coordinate item GET, so read this series' items of that type and pick ours
      // out. Scoped to one series, so it stays off the whole-library path.
      const items = await ds.getCollectedItems({ type: kind, series: `${bridgeId}:${seriesId}` }, signal);
      const mine = items?.find((i) =>
        kind === 'chapter'
          ? i.type === 'chapter' && i.chapterId === target.chapterId
          : i.type === 'page' && i.chapterId === target.chapterId && i.pageIndex === target.pageIndex,
      );
      return mine ? mine.collectionIds : null;
    },
    enabled,
  });

  const mutation = useMutation({
    /** `null` removes the item; an array saves it with exactly those memberships. */
    mutationFn: async (next: string[] | null) => {
      if (kind === 'series') {
        if (next === null) return ds.uncollectSeries(bridgeId!, seriesId);
        const snap = target.snapshot();
        await ds.setSeriesCollections(bridgeId!, seriesId, next, {
          ...snap,
          seriesTitle: snap.seriesTitle ?? seriesId,
        });
      } else if (kind === 'chapter') {
        if (next === null) return ds.uncollectChapter(bridgeId!, seriesId, target.chapterId);
        await ds.collectChapter(bridgeId!, seriesId, target.chapterId, target.snapshot());
        await ds.setChapterCollections(bridgeId!, seriesId, target.chapterId, next);
      } else {
        if (next === null) return ds.uncollectPage(bridgeId!, seriesId, target.chapterId, target.pageIndex);
        await ds.collectPage(bridgeId!, seriesId, target.chapterId, target.pageIndex, target.snapshot());
        await ds.setPageCollections(bridgeId!, seriesId, target.chapterId, target.pageIndex, next);
      }
    },
    onMutate: async (next: string[] | null) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<string[] | null>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onSuccess: (_r, next, ctx) => {
      // Only a fresh save auto-downloads: re-filing a saved item must not bring back a download the
      // user deleted.
      if (next === null || ctx?.prev !== null || !bridgeId) return;
      if (target.kind === 'series') {
        const snap = target.snapshot();
        autoDownloadSeries(ds, mock, {
          bridgeId,
          seriesId,
          title: snap.seriesTitle ?? seriesId,
          ...(snap.thumbnailUrl !== undefined && { thumbnailUrl: snap.thumbnailUrl }),
          ...(snap.author !== undefined && { author: snap.author }),
          ...(target.direct !== undefined && { direct: target.direct }),
        });
      } else if (target.kind === 'chapter') {
        const snap = target.snapshot();
        autoDownloadChapter(mock, {
          bridgeId,
          seriesId,
          chapterId: target.chapterId,
          title: snap.seriesTitle,
          ...(snap.chapterName !== undefined && { chapterName: snap.chapterName }),
          ...(snap.number !== undefined && { number: snap.number }),
          ...(snap.languageCode !== undefined && { languageCode: snap.languageCode }),
        });
      } else {
        const snap = target.snapshot();
        autoDownloadPage(mock, {
          bridgeId,
          seriesId,
          chapterId: target.chapterId,
          pageIndex: target.pageIndex,
          title: snap.seriesTitle,
          ...(snap.chapterName !== undefined && { chapterName: snap.chapterName }),
        });
      }
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(key, ctx.prev ?? null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.collectionItemsAll(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections(mock) });
      if (kind === 'series') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.inLibrary(mock, bridgeId ?? '', seriesId) });
      } else if (kind === 'page') {
        // The reader's save button reads the chapter's index set, not this key.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.chapterPageIndices(mock, bridgeId ?? '', seriesId, target.chapterId),
        });
      }
    },
  });

  return {
    /** `null` while loading. */
    saved: isLoading || data === undefined ? null : data !== null,
    collectionIds: data ?? [],
    loading: isLoading,
    setCollections: (next: string[]) => {
      if (!bridgeId) return;
      mutation.mutate(next);
    },
    remove: () => {
      if (!bridgeId) return;
      mutation.mutate(null);
    },
  };
}
