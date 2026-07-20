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
import { useDataSource } from '@/data/source';

export type RegistryUpdateCounts = {
  bridges: number;
  trackers: number;
  total: number;
};

const EMPTY: RegistryUpdateCounts = { bridges: 0, trackers: 0, total: 0 };

/** The full breakdown — used by the Settings landing screen to badge the Bridges/Trackers rows. */
export function useRegistryUpdateCounts(): RegistryUpdateCounts {
  const ds = useDataSource();
  const { data } = useQuery({
    queryKey: queryKeys.registryUpdateCount(),
    queryFn: async ({ signal }): Promise<RegistryUpdateCounts> => {
      const [bridges, trackers] = await Promise.all([
        ds.checkRegistryUpdates(signal),
        ds.checkRegistryTrackerUpdates(signal),
      ]);
      const b = bridges?.length ?? 0;
      const t = trackers?.length ?? 0;
      return { bridges: b, trackers: t, total: b + t };
    },
  });
  return data ?? EMPTY;
}

/** The grand total — the Settings tab pip. */
export function useSettingsBadgeCount(): number {
  return useRegistryUpdateCounts().total;
}
