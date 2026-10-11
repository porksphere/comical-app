import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageItemSnapshotBody } from '@/data/api';
import { chapterPageIndicesQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { hapticSelection } from '@/lib/haptics';
import { hashPageFromCache } from '@/lib/page-hash';

/**
 * Whether the currently visible page is saved, plus the reader's one-tap save.
 *
 * Same model as the series button: a tap on an unsaved page saves it, unfiled; a tap on a saved one
 * asks the caller to open the picker (`'pick'`), which is where filing and removal live.
 *
 * Reads **one** query per chapter — the chapter's collected page indices — and derives the button
 * from it, so flipping pages costs zero requests and the state is correct instantly while scrubbing.
 * Stale items are already excluded server-side, so an index here is always safe to navigate to.
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
    mutationFn: async () => {
      await ds.collectPage(bridgeId!, seriesId, chapterId!, pageIndex, snapshot());
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<number[]>(key);
      if (prev) queryClient.setQueryData(key, [...prev, pageIndex].sort((a, b) => a - b));
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pageCollections(mock, bridgeId ?? '', seriesId, chapterId ?? '', pageIndex),
      });
      // Prefix key: refreshes every collected grid whatever its type/sort/dir/collection.
      void queryClient.invalidateQueries({ queryKey: queryKeys.collectionItemsAll(mock) });
    },
  });

  return {
    /** `null` while unknown — the button stays disabled rather than showing a wrong state. */
    collected,
    /** Saves an unsaved page; for a saved one returns `'pick'` for the caller to open the picker. */
    toggle: (): 'saved' | 'pick' | 'noop' => {
      if (!enabled || collected === null) return 'noop';
      if (collected) return 'pick';
      hapticSelection();
      mutation.mutate();
      return 'saved';
    },
  };
}
