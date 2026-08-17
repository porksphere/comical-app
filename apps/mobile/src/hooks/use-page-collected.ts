import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageItemSnapshotBody } from '@/data/api';
import { resolveLastCollection, setLastCollectionId } from '@/data/last-collection';
import { chapterPageIndicesQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { hapticSelection } from '@/lib/haptics';
import { hashPageFromCache } from '@/lib/page-hash';

/**
 * Whether the currently visible page is saved to any collection, plus the reader's one-tap save.
 *
 * **The Google Maps "Save" model.** A tap files the page into whichever collection pages were last
 * filed into; a long press opens the picker to choose. Nothing is auto-created and there is no
 * implicit "Favorites" — an item exists only as a member of a collection the user made. When there
 * is no last-used collection yet (first save ever, or it has since been deleted), a tap has nowhere
 * to go, so it defers to the caller via `needsPick` and the picker opens instead.
 *
 * Reads **one** query per chapter — the chapter's collected page indices — and derives the button
 * from it, so flipping pages costs zero requests and the state is correct instantly while scrubbing.
 * A per-page status check would fire a request per page turn, which is precisely why the indices
 * route exists. Stale items are already excluded server-side, so an index here is always safe to
 * navigate to.
 *
 * **Saving is two writes, and both matter.** `collectPage` writes the item, then it is filed. An
 * item with no memberships is only *transiently* legal — the server treats empty memberships as
 * "remove me" — so the file-in must follow promptly, not wait on anything slow (the `contentHash`
 * follow-up PUT deliberately runs after, and separately, for that reason).
 */
export function usePageCollected(
  bridgeId: string | undefined,
  seriesId: string,
  chapterId: string | undefined,
  pageIndex: number,
  snapshot: () => PageItemSnapshotBody,
  /** The exact URI string handed to the reader's `<Image>` — expo-image's disk-cache key, used to
   *  hash the bytes already on disk. Omit it and the page is simply saved without a hash. */
  imageCacheKey?: string | null,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const enabled = !!bridgeId && !!seriesId && !!chapterId;
  const key = queryKeys.chapterPageIndices(mock, bridgeId ?? '', seriesId, chapterId ?? '');

  const { data, isError } = useQuery({
    ...chapterPageIndicesQuery(ds, mock, bridgeId ?? '', seriesId, chapterId ?? ''),
    enabled,
    // A library-less server 404s every collected route; that should read as "nothing saved",
    // not spin a retry behind a peripheral control.
    retry: false,
  });
  // `null` while the first load is in flight → the button renders disabled rather than wrong.
  const indices = data ?? (isError ? [] : null);
  const collected = indices === null ? null : indices.includes(pageIndex);

  const mutation = useMutation({
    mutationFn: async (collectionId: string | null) => {
      if (collectionId === null) {
        await ds.uncollectPage(bridgeId!, seriesId, chapterId!, pageIndex);
        return;
      }
      await ds.collectPage(bridgeId!, seriesId, chapterId!, pageIndex, snapshot());
      // File it immediately — an item with no memberships is removed, so leaving it bare would
      // undo the tap. This must not wait on anything slow, which is why the hash comes after.
      await ds.setPageCollections(bridgeId!, seriesId, chapterId!, pageIndex, [collectionId]);
      setLastCollectionId('page', collectionId);

      // Second PUT, carrying the content hash. Deliberately after the save has already landed:
      // SHA-256 over a ~1MB page through Hermes' JS crypto shim is slow enough to feel. Safe to
      // send partially — the route MERGES, so `chapterName`/`pageCount`/`sourceUrl` survive
      // untouched (and `pageCount` matters: it's reconcile's fallback re-anchor signal).
      const contentHash = await hashPageFromCache(imageCacheKey);
      if (contentHash) {
        await ds.collectPage(bridgeId!, seriesId, chapterId!, pageIndex, {
          seriesTitle: snapshot().seriesTitle,
          contentHash,
        });
      }
    },
    onMutate: async (collectionId: string | null) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<number[]>(key);
      if (prev) {
        queryClient.setQueryData(
          key,
          collectionId === null
            ? prev.filter((i) => i !== pageIndex)
            : [...prev, pageIndex].sort((a, b) => a - b),
        );
      }
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      // Prefix key: refreshes every collected grid whatever its type/sort/dir/collection.
      void queryClient.invalidateQueries({ queryKey: queryKeys.collectionItemsAll(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections(mock) });
    },
  });

  return {
    /** `null` while unknown — the button stays disabled rather than showing a wrong state. */
    collected,
    /**
     * One-tap save/unsave. Resolves the destination from the last collection pages were filed into;
     * returns **`'needs-pick'`** when there isn't a usable one, which the caller answers by opening
     * the picker. Never invents a collection.
     */
    toggle: async (): Promise<'saved' | 'removed' | 'needs-pick' | 'noop'> => {
      if (!enabled || collected === null) return 'noop';
      if (collected) {
        hapticSelection();
        mutation.mutate(null);
        return 'removed';
      }
      // Validated against the live list, so a deleted collection falls through to the picker
      // instead of resurrecting itself.
      const destination = resolveLastCollection('page', await ds.getCollections());
      if (!destination) return 'needs-pick';
      hapticSelection();
      mutation.mutate(destination);
      return 'saved';
    },
  };
}
