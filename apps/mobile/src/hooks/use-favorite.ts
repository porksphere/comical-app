import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isFavoriteQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';

/**
 * Per-series favorite state + optimistic toggle, shared by the Series screen and the reader's
 * settings panel so both stay in exact lockstep — same cache key, same optimistic-update /
 * rollback / list-invalidation flow — instead of two hand-kept copies that could drift.
 *
 * `favorited` is `null` while the initial check is still loading (toggle disabled); an errored or
 * unsupported check (a bridge without "favorites", or one needing auth) reads as `false` so the
 * star stays usable but empty rather than surfacing an error for a peripheral action.
 */
export function useFavorite(bridgeId: string | undefined, seriesId: string) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const key = queryKeys.isFavorite(mock, bridgeId ?? '', seriesId);
  // retry:false — an unsupported/unauthed check should read as "not favorited", not spin a retry.
  const { data, isError } = useQuery({ ...isFavoriteQuery(ds, mock, bridgeId ?? '', seriesId), retry: false });
  const favorited = data ?? (isError ? false : null);

  const mutation = useMutation({
    mutationFn: (next: boolean) => (next ? ds.addFavorite(bridgeId!, seriesId) : ds.removeFavorite(bridgeId!, seriesId)),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData(key, next);
      return { prev };
    },
    // A confirmed write is the source of truth: re-assert `next` so a slow `isFavorite` scrape that
    // resolves after the toggle can't leave the star reverted while the favorite actually landed.
    onSuccess: (_data, next) => queryClient.setQueryData(key, next),
    onError: (_e, _next, ctx) => {
      // Roll back optimistically, THEN re-check the real state: some bridges (e.g. atsu.moe under
      // rate-limiting) return an error status even when the write actually landed, so trusting the
      // rollback would revert a favorite that really succeeded. A fresh `isFavorite` read settles it.
      if (ctx) queryClient.setQueryData(key, ctx.prev ?? false);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    // Refresh the Browse favorites list so a toggle here shows up there. Since the grid migration
    // it's a `browseGrid` `favorites` scope — a plain `['favorites', …]` key would match nothing.
    onSettled: () => {
      if (bridgeId) void queryClient.invalidateQueries({ queryKey: queryKeys.browseGrid(mock, bridgeId, { kind: 'favorites' }) });
    },
  });

  const toggle = () => {
    if (!bridgeId || favorited === null) return;
    mutation.mutate(!favorited);
  };
  return { favorited, toggle };
}
