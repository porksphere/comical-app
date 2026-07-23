/**
 * Registry updates available from the user's registries, split by category (bridges vs trackers).
 * One combined query (a single cache entry) feeds BOTH the Settings tab pip — which shows the grand
 * total — AND the per-category pips on the Settings landing rows, so the tab badge and the Bridges/
 * Trackers row badges can never disagree. The per-item detail lives where it always did (the Bridges
 * screen's "Update available" rows and the registry browse screen). Servers without registry support
 * resolve both checks to `null`, so every count is simply 0 there.
 */
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';

export type RegistryUpdateCounts = {
  bridges: number;
  trackers: number;
  total: number;
};

const EMPTY: RegistryUpdateCounts = { bridges: 0, trackers: 0, total: 0 };

/** The full breakdown — used by the Settings landing screen to badge the Bridges/Trackers rows. */
export function useRegistryUpdateCounts(): RegistryUpdateCounts {
  const ds = useDataSource();
  const hideNsfw = useHideNsfw();

  const { data } = useQuery({
    queryKey: queryKeys.registryUpdateCount(),
    // Keep the raw update lists (not pre-counted): the NSFW filter below depends on `hideNsfw`, which
    // must re-derive the count on toggle without a refetch. Still one cache entry feeding every pip.
    queryFn: async ({ signal }) => {
      const [bridges, trackers] = await Promise.all([
        ds.checkRegistryUpdates(signal),
        ds.checkRegistryTrackerUpdates(signal),
      ]);
      return { bridges: bridges ?? [], trackers: trackers ?? [] };
    },
  });

  // The update list carries no `nsfw` flag; the installed-bridge summaries do. When NSFW is hidden a
  // hidden bridge's update must NOT be counted — otherwise the pip advertises an update the user can't
  // see or act on (its row isn't in the Bridges list). Cross-reference by id and drop those. (Same
  // query key the Bridges screen uses, so this is served from cache — no extra fetch.)
  const { data: summaries } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });

  if (!data) return EMPTY;
  const nsfwIds = new Set((summaries ?? []).filter((s) => s.info.nsfw).map((s) => s.info.id));
  const bridgeUpdates = hideNsfw ? data.bridges.filter((u) => !nsfwIds.has(u.id)) : data.bridges;
  const b = bridgeUpdates.length;
  const t = data.trackers.length;
  return { bridges: b, trackers: t, total: b + t };
}

/** The grand total — the Settings tab pip. */
export function useSettingsBadgeCount(): number {
  return useRegistryUpdateCounts().total;
}
