import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageItemSnapshotBody } from '@/data/api';
import { chapterPageIndicesQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { hapticSelection } from '@/lib/haptics';
import { hashPageFromCache } from '@/lib/page-hash';

/** The name of the collection the reader's one-tap heart files into, created on first use.
 *
 *  There is no separate "favorites" concept any more — an item exists only as a member of a
 *  collection — so the heart is app policy: membership in an ORDINARY collection that happens to be
 *  created for you. The user can rename it, reorder it, or delete it like any other, and deleting
 *  it deletes the pages whose only membership it was. That's the consistent behaviour, but it does
 *  mean a delete confirmation needs to say so. */
export const HEART_COLLECTION_NAME = 'Favorites';

/**
 * Whether the currently visible page is collected, plus a one-tap toggle, for the reader's heart.
 *
 * Reads **one** query per chapter — the chapter's collected page indices — and derives the button
 * from it, so flipping pages costs zero requests and the heart is correct instantly while scrubbing.
 * A per-page status check would fire a request per page turn, which is precisely why the indices
 * route exists. Stale items are already excluded server-side, so an index here is always safe to
 * navigate to.
 *
 * The toggle is optimistic against that index array with rollback, mirroring `useFavorite`.
 *
 * **Collecting is two steps, and both matter.** `collectPage` writes the item, then it is filed into
 * the heart collection. An item with no memberships is only *transiently* legal — the server treats
 * empty memberships as "remove me" — so the file-in must follow promptly, not wait on anything slow
 * (the `contentHash` follow-up PUT deliberately runs after, and separately, for that reason).
 */
export function usePageCollected(
  bridgeId: string | undefined,
  seriesId: string,
  chapterId: string | undefined,
  pageIndex: number,
  snapshot: () => PageItemSnapshotBody,
  /** The exact URI string handed to the reader's `<Image>` — expo-image's disk-cache key, used to
   *  hash the bytes already on disk. Omit it and the page is simply collected without a hash. */
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
    // A library-less server 404s every collected route; that should read as "nothing collected",
    // not spin a retry behind a peripheral control.
    retry: false,
  });
  // `null` while the first load is in flight → the heart renders disabled rather than wrong.
  const indices = data ?? (isError ? [] : null);
  const collected = indices === null ? null : indices.includes(pageIndex);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (!next) {
        await ds.uncollectPage(bridgeId!, seriesId, chapterId!, pageIndex);
        return;
      }
      await ds.collectPage(bridgeId!, seriesId, chapterId!, pageIndex, snapshot());
      // File it immediately — an item with no memberships is removed, so leaving it bare would
      // undo the tap. This must not wait on anything slow, which is why the hash comes after.
      const collectionId = await ensureHeartCollection();
      await ds.setPageCollections(bridgeId!, seriesId, chapterId!, pageIndex, [collectionId]);

      // Second PUT, carrying the content hash. Deliberately after the tap has already landed:
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
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<number[]>(key);
      if (prev) {
        queryClient.setQueryData(
          key,
          next ? [...prev, pageIndex].sort((a, b) => a - b) : prev.filter((i) => i !== pageIndex),
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

  /** Find the heart collection by name, creating it the first time. Named rather than id-pinned so
   *  the user renaming it doesn't orphan the heart — but that also means renaming it and then
   *  hearting again mints a fresh one, which is the trade for not storing a hidden id. */
  async function ensureHeartCollection(): Promise<string> {
    const existing = await ds.getCollections();
    const found = existing.find((c) => c.name === HEART_COLLECTION_NAME);
    if (found) return found.id;
    return (await ds.createCollection(HEART_COLLECTION_NAME)).id;
  }

  return {
    collected,
    toggle: () => {
      if (!enabled || collected === null) return;
      hapticSelection();
      mutation.mutate(!collected);
    },
  };
}
