import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PageItemSnapshotBody } from '@/data/api';
import { autoDownloadPage } from '@/data/downloads/auto';
import { chapterPageIndicesQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { hapticSelection } from '@/lib/haptics';
import { hashPageFromCache } from '@/lib/page-hash';

/**
 * Which of a chapter's pages are saved, plus the reader's one-tap save for any of them.
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
  snapshot: (pageIndex: number) => PageItemSnapshotBody,
  /** The exact URI string handed to the reader's `<Image>` — expo-image's disk-cache key, used to
   *  hash the bytes already on disk. Null and the page is simply saved without a hash. */
  imageCacheKey: (pageIndex: number) => string | null,
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

  const mutation = useMutation({
    mutationFn: async (pageIndex: number) => {
      const snap = snapshot(pageIndex);
      await ds.collectPage(bridgeId!, seriesId, chapterId!, pageIndex, snap);
      autoDownloadPage(mock, {
        bridgeId: bridgeId!,
        seriesId,
        chapterId: chapterId!,
        pageIndex,
        title: snap.seriesTitle,
        ...(snap.chapterName !== undefined && { chapterName: snap.chapterName }),
      });
      // Second PUT, carrying the content hash. Deliberately after the save has already landed:
      // SHA-256 over a ~1MB page through Hermes' JS crypto shim is slow enough to feel. Safe to
      // send partially — the route MERGES, so `chapterName`/`pageCount`/`sourceUrl` survive
      // untouched (and `pageCount` matters: it's reconcile's fallback re-anchor signal).
      const contentHash = await hashPageFromCache(imageCacheKey(pageIndex));
      if (contentHash) {
        await ds.collectPage(bridgeId!, seriesId, chapterId!, pageIndex, {
          seriesTitle: snap.seriesTitle,
          contentHash,
        });
      }
    },
    onMutate: async (pageIndex) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<number[]>(key);
      if (prev) queryClient.setQueryData(key, [...prev, pageIndex].sort((a, b) => a - b));
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: (_data, _error, pageIndex) => {
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
    isCollected: (pageIndex: number) => (indices === null ? null : indices.includes(pageIndex)),
    /** Saves an unsaved page; for a saved one returns `'pick'` for the caller to open the picker. */
    toggle: (pageIndex: number): 'saved' | 'pick' | 'noop' => {
      if (!enabled || indices === null) return 'noop';
      if (indices.includes(pageIndex)) return 'pick';
      hapticSelection();
      mutation.mutate(pageIndex);
      return 'saved';
    },
  };
}
