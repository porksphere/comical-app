import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isFavoriteQuery, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { useFavoritesAvailability } from '@/hooks/use-favorites-available';

/**
 * What a favorite control should show. The first three are the bridge's (see `FavoritesStatus`);
 * `checking` is this series' own status request still in flight, and `ready` is a star that can be
 * toggled. A surface that can't tell `login` from `checking` shows a dead button for both, which is
 * exactly the ambiguity this exists to remove.
 */
export type FavoriteStatus = 'unsupported' | 'loading' | 'login' | 'checking' | 'ready';

/**
 * Per-series favorite state + optimistic toggle, shared by the Series screen and the reader's
 * settings panel so both stay in exact lockstep — same cache key, same optimistic-update /
 * rollback / list-invalidation flow — instead of two hand-kept copies that could drift.
 *
 * `favorited` is `null` while the initial check is still loading (toggle disabled); an errored or
 * unsupported check (a bridge without "favorites", or one needing auth) reads as `false` so the
 * star stays usable but empty rather than surfacing an error for a peripheral action.
 *
 * `status` is what a control renders from (see `FavoriteStatus`); `available` is the gate behind it
 * (see `useFavoritesAvailability`). When not available the status check is skipped and `toggle` is a
 * no-op. `loginSettings` are the route params that open the bridge's settings — where the login
 * fields are — for a `login` status; the control makes itself the way in rather than a dead end.
 */
export function useFavorite(
  bridgeId: string | undefined,
  seriesId: string,
  options?: { enabled?: boolean },
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const { statusOf, summaryOf } = useFavoritesAvailability();
  const bridgeStatus = statusOf(bridgeId);
  const available = bridgeStatus === 'available';
  const key = queryKeys.isFavorite(mock, bridgeId ?? '', seriesId);
  // retry:false — an unsupported/unauthed check should read as "not favorited", not spin a retry.
  // `enabled` lets a caller defer the check until it's actually needed (e.g. a per-card context menu
  // only arms it once the user interacts with that card) so a full grid doesn't fan out into a
  // status check per cell; defaults to on, so the existing always-checking callers are unchanged.
  // Gated on `available` too: no point scraping favorite status for a bridge you're not logged into.
  const { data, isError } = useQuery({
    ...isFavoriteQuery(ds, mock, bridgeId ?? '', seriesId),
    retry: false,
    enabled: (options?.enabled ?? true) && !!bridgeId && !!seriesId && available,
  });
  const favorited = available ? (data ?? (isError ? false : null)) : false;

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
      if (ctx) queryClient.setQueryData(key, ctx.prev ?? false);
    },
    // Refresh both favorites surfaces so a toggle here shows up: the single-bridge favorites grid
    // (`browseGrid` `favorites` scope) and the consolidated Comical Favorites rail (its own
    // `bridgeFavoritesRail` key — separate on purpose; see queries.ts).
    onSettled: () => {
      if (!bridgeId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.browseGrid(mock, bridgeId, { kind: 'favorites' }) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bridgeFavoritesRail(mock, bridgeId) });
    },
  });

  const toggle = () => {
    if (!available || !bridgeId || favorited === null) return;
    mutation.mutate(!favorited);
  };
  const status: FavoriteStatus = available ? (favorited === null ? 'checking' : 'ready') : bridgeStatus;
  const summary = summaryOf(bridgeId);
  const loginSettings = bridgeId && summary ? { bridgeId, source: summary.source } : undefined;
  return { favorited, toggle, available, status, loginSettings };
}
