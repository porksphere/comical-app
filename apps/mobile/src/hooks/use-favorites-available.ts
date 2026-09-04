import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { BridgeSummary } from '@/data/api';
import { favoritesStatusOf, type FavoritesStatus } from '@/data/favorites-status';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import type { Bridge } from '@/data/types';

/**
 * "Can this bridge do favorites right now?" — the one place the app decides whether a bridge's
 * favorites are usable, so every surface (the star button, the card menus' Favorite row, the per-bridge
 * Favorites page, and the consolidated Comical Favorites page) gates on the same rule.
 *
 * The rule itself is `favoritesStatusOf` (data/favorites-status.ts); this hook only feeds it the
 * `GET /bridges` summaries, which already carry everything it reads.
 */
export function useFavoritesAvailability(): {
  /** The status for one bridge — see `FavoritesStatus`. `loading` until the summaries have resolved,
   *  so a star is withheld until we KNOW it's usable rather than flashing enabled and allowing a
   *  toggle that would fail. */
  statusOf: (bridgeId: string | undefined) => FavoritesStatus;
  /** `statusOf(bridgeId) === 'available'`. */
  isAvailable: (bridgeId: string | undefined) => boolean;
  /** The bridge's summary, for a surface that needs to route to its settings (the `source` param). */
  summaryOf: (bridgeId: string | undefined) => BridgeSummary | undefined;
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

  const byId = useMemo(() => new Map((data ?? []).map((s) => [s.info.id, s])), [data]);

  const statusOf = useCallback(
    (bridgeId: string | undefined): FavoritesStatus => {
      if (!isSuccess) return 'loading';
      const summary = bridgeId ? byId.get(bridgeId) : undefined;
      if (!summary) return 'unsupported';
      return favoritesStatusOf(summary);
    },
    [isSuccess, byId],
  );

  const availableBridges = useMemo(
    () => (data ?? []).filter((s) => favoritesStatusOf(s) === 'available').map((s) => s.info as Bridge),
    [data],
  );

  const isAvailable = useCallback((bridgeId: string | undefined) => statusOf(bridgeId) === 'available', [statusOf]);
  const summaryOf = useCallback((bridgeId: string | undefined) => (bridgeId ? byId.get(bridgeId) : undefined), [byId]);

  return { statusOf, isAvailable, summaryOf, availableBridges, loaded: isSuccess };
}
