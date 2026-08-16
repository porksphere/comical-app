import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { LibrarySnapshot } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/**
 * One series' collection memberships + an optimistic setter, for the assign picker. Mirrors
 * `useLibrary`'s optimistic/rollback/invalidate shape.
 *
 * Replaces `useEntryLists`. Memberships used to live on the library entry (`entry.listIds`); they
 * now hang off a series ITEM, a separate record pointing at the same coordinates. Two consequences:
 *
 * - The membership read no longer distinguishes "not in the library" from "filed nowhere" — a
 *   series can be filed without being in the library at all. `[]` means unfiled, full stop.
 * - Clearing the last collection REMOVES the item: an item exists only as a member of a collection,
 *   so there is no filed-nowhere state to leave it in (see `setSeriesCollections`).
 *
 * Adding to the library on first file is now a UX choice rather than a technical requirement (the
 * membership write no longer needs an entry to exist). It's kept because "file it" has always
 * implied "keep it" here — see docs/collections-client-plan.md if that should change.
 */
export function useSeriesCollections(
  bridgeId: string | undefined,
  seriesId: string,
  snapshot: () => LibrarySnapshot,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const key = queryKeys.seriesCollections(mock, bridgeId ?? '', seriesId);

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => ds.getSeriesCollections(bridgeId!, seriesId, signal),
    enabled: !!bridgeId && !!seriesId,
  });
  const collectionIds = data ?? [];

  const mutation = useMutation({
    mutationFn: async (next: string[]) => {
      const snap = snapshot();
      // Idempotent, and only on the way IN — un-filing shouldn't drag a series into the library.
      if (next.length > 0) await ds.addToLibrary(bridgeId!, seriesId, snap);
      await ds.setSeriesCollections(bridgeId!, seriesId, next, {
        seriesTitle: snap.title ?? seriesId,
        ...(snap.thumbnailUrl !== undefined && { thumbnailUrl: snap.thumbnailUrl }),
        ...(snap.author !== undefined && { author: snap.author }),
      });
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
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
      queryClient.invalidateQueries({ queryKey: queryKeys.collections(mock) });
      queryClient.invalidateQueries({ queryKey: queryKeys.inLibrary(mock, bridgeId ?? '', seriesId) });
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
