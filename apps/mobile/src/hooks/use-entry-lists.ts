import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { LibrarySnapshot } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/**
 * One series' custom-list memberships + an optimistic setter, for the assign picker. Mirrors
 * `useLibrary`'s optimistic/rollback/invalidate shape.
 *
 * `listIds` is `null` until the check resolves (or when the series isn't in the library yet). Setting
 * memberships on a series that isn't in the library adds it first (using `snapshot`) — filing a
 * series into a list implies keeping it — so the picker works from a card that was never opened.
 * `setLists` invalidates the library grid, the lists collection (counts), and this series'
 * in-library flag so every surface reflects the change.
 */
export function useEntryLists(
  bridgeId: string | undefined,
  seriesId: string,
  snapshot: () => LibrarySnapshot,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const key = queryKeys.entryLists(mock, bridgeId ?? '', seriesId);

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => ds.getEntryLists(bridgeId!, seriesId, signal),
    enabled: !!bridgeId && !!seriesId,
  });
  // `undefined` while loading, `null` when not in the library — both read as "no memberships yet".
  const listIds = data ?? [];

  const mutation = useMutation({
    mutationFn: async (next: string[]) => {
      // Not in the library yet → add it first so `setLists` has an entry to write to (the route 404s
      // otherwise). `data === null` is the definitive "not in library" signal from the seed query.
      if (data === null) await ds.addToLibrary(bridgeId!, seriesId, snapshot());
      await ds.setEntryLists(bridgeId!, seriesId, next);
    },
    onMutate: async (next: string[]) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<string[] | null>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(key, ctx.prev ?? null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: queryKeys.libraryList(mock) });
      queryClient.invalidateQueries({ queryKey: queryKeys.libraryLists(mock) });
      queryClient.invalidateQueries({ queryKey: queryKeys.inLibrary(mock, bridgeId ?? '', seriesId) });
    },
  });

  return {
    listIds,
    loading: isLoading,
    setLists: (next: string[]) => {
      if (!bridgeId) return;
      mutation.mutate(next);
    },
  };
}
