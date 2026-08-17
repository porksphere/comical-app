import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChapterItemSnapshotBody, LibrarySnapshot, PageItemSnapshotBody } from '@/data/api';
import { setLastCollectionId } from '@/data/last-collection';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/** What the picker (and the reader's save button) is filing. A discriminated union rather than an
 *  optional-fields bag, so a page target can't be built without its chapter and index. */
export type ItemTarget =
  | { kind: 'series'; bridgeId: string | undefined; seriesId: string; snapshot: () => LibrarySnapshot }
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
 * One item's collection memberships + an optimistic setter, for the picker and for one-tap saves.
 *
 * Handles series and page targets through one interface because the rules are the same for both:
 * an item exists ONLY as a member of a collection, so writing memberships creates it and clearing
 * them removes it. What differs is only which routes carry the write.
 *
 * `[]` means "not filed anywhere", which for a page also means "not saved" — there is no separate
 * saved-but-uncollected state.
 *
 * Filing also records the collection as that TYPE's last-used, which is what makes a subsequent
 * one-tap save land somewhere sensible without asking (see `data/last-collection.ts`).
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
    queryFn: async ({ signal }) => {
      if (kind === 'series') return ds.getSeriesCollections(bridgeId!, seriesId, signal);
      // There is no per-coordinate item GET, so read this series' items of that type and pick ours
      // out. Scoped to one series, so it stays off the whole-library path.
      const items = await ds.getCollectedItems({ type: kind, series: `${bridgeId}:${seriesId}` }, signal);
      const mine = items?.find((i) =>
        kind === 'chapter'
          ? i.type === 'chapter' && i.chapterId === target.chapterId
          : i.type === 'page' && i.chapterId === target.chapterId && i.pageIndex === target.pageIndex,
      );
      return mine?.collectionIds ?? [];
    },
    enabled,
  });
  const collectionIds = data ?? [];

  const mutation = useMutation({
    mutationFn: async (next: string[]) => {
      if (kind === 'series') {
        const snap = target.snapshot();
        // Idempotent, and only on the way IN — un-filing shouldn't drag a series into the library.
        if (next.length > 0) await ds.addToLibrary(bridgeId!, seriesId, snap);
        await ds.setSeriesCollections(bridgeId!, seriesId, next, {
          seriesTitle: snap.title ?? seriesId,
          ...(snap.thumbnailUrl !== undefined && { thumbnailUrl: snap.thumbnailUrl }),
          ...(snap.author !== undefined && { author: snap.author }),
        });
      } else if (kind === 'chapter') {
        if (next.length === 0) {
          await ds.uncollectChapter(bridgeId!, seriesId, target.chapterId);
        } else {
          await ds.collectChapter(bridgeId!, seriesId, target.chapterId, target.snapshot());
          await ds.setChapterCollections(bridgeId!, seriesId, target.chapterId, next);
        }
      } else if (next.length === 0) {
        await ds.uncollectPage(bridgeId!, seriesId, target.chapterId, target.pageIndex);
      } else {
        // Write the item, then its memberships. An item with no memberships is only transiently
        // legal — the server reads empty as "remove me" — so these two must not be separated by
        // anything slow.
        await ds.collectPage(bridgeId!, seriesId, target.chapterId, target.pageIndex, target.snapshot());
        await ds.setPageCollections(bridgeId!, seriesId, target.chapterId, target.pageIndex, next);
      }
      // Remember where this TYPE was last filed, so the next one-tap save has a destination.
      // Only on a real filing — clearing memberships shouldn't repoint the default.
      const added = next.find((id) => !collectionIds.includes(id)) ?? next[next.length - 1];
      if (added) setLastCollectionId(kind, added);
    },
    onMutate: async (next: string[]) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(key, ctx.prev ?? []);
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
    collectionIds,
    loading: isLoading,
    setCollections: (next: string[]) => {
      if (!bridgeId) return;
      mutation.mutate(next);
    },
  };
}
