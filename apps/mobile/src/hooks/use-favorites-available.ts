import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import type { Bridge } from '@/data/types';

/**
 * "Can this bridge do favorites right now?" — the one place the app decides whether a bridge's
 * favorites are usable, so every surface (the star button, the per-bridge Favorites page, and the
 * consolidated Comical Favorites page) gates on the same rule.
 *
 * A bridge's favorites need an account, and an account is its `secret` login settings. The host-server
 * already computes `missingRequired` per bridge and ships it FREE in the `GET /bridges` summary, so the
 * signal is: the bridge advertises the `favorites` capability AND has no required setting still unset
 * (`missingRequired.length === 0`) — i.e. it's logged in. No per-bridge settings fetch, no contract
 * change: `missingRequired` is already there. Centralised here so if a bridge ever needs
 * public-browse-with-optional-login-favorites, this becomes the single spot to swap in a contract-level
 * "favoritesAvailable" flag instead.
 */
export function useFavoritesAvailability(): {
  /** True once the summaries have loaded and the bridge is favorites-capable AND logged in. False
   *  (not "unknown") while loading, so a star greys out until we KNOW it's usable rather than flashing
   *  enabled and allowing a toggle that would fail. */
  isAvailable: (bridgeId: string | undefined) => boolean;
  /** The favorites-available bridges, in `GET /bridges` order — the consolidated Comical Favorites
   *  page fans out over exactly these. */
  availableBridges: Bridge[];
  /** Whether the summaries have resolved at least once (callers that must distinguish "no eligible
   *  bridges" from "not loaded yet"). */
  loaded: boolean;
} {
  const ds = useDataSource();
  // Shares `queryKeys.bridgeSummaries()` with the Settings / Bridges screens, so this dedupes onto the
  // same fetch and is usually already warm.
  const { data, isSuccess } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });

  const availableIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of data ?? []) {
      if (s.info.capabilities.includes('favorites') && s.missingRequired.length === 0) set.add(s.info.id);
    }
    return set;
  }, [data]);

  const availableBridges = useMemo(
    () => (data ?? []).filter((s) => availableIds.has(s.info.id)).map((s) => s.info as Bridge),
    [data, availableIds],
  );

  const isAvailable = useCallback((bridgeId: string | undefined) => !!bridgeId && availableIds.has(bridgeId), [availableIds]);

  return { isAvailable, availableBridges, loaded: isSuccess };
}
