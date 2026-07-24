/**
 * Registry updates available from the user's registries, split by category (bridges vs trackers).
 * These counts feed BOTH the Settings tab pip — the grand total — AND the per-category pips on the
 * Settings landing rows, so the tab badge and the Bridges/Trackers row badges can never disagree.
 * The per-item detail lives where it always did (the Bridges screen's "Update available" rows and the
 * registry browse screen). A server without registry support has no `availableVersion` on any summary
 * and resolves the tracker check to `null`, so every count is simply 0 there.
 *
 * The BRIDGE count is derived from the same source the Bridges list shows its update dots for — each
 * installed bridge summary's `availableVersion` — rather than a separate `/registry/updates` list.
 * That's deliberate: the two must never disagree. The old approach cross-referenced the update list
 * (which carries no `nsfw` flag) against the summaries by id to drop hidden-NSFW updates, but the two
 * were separate queries — when the update list resolved before the summaries one, the filter had no
 * ids to match yet and a hidden NSFW bridge's update briefly leaked into the pip (visible on Settings,
 * yet absent from the NSFW-filtered Bridges list). Counting `availableVersion` on the SAME
 * (NSFW-filtered) summaries the list renders makes the pip and the list agree by construction.
 */
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';

export type RegistryUpdateCounts = {
  bridges: number;
  trackers: number;
  total: number;
};

/** The full breakdown — used by the Settings landing screen to badge the Bridges/Trackers rows. */
export function useRegistryUpdateCounts(): RegistryUpdateCounts {
  const ds = useDataSource();
  const hideNsfw = useHideNsfw();

  // Bridge updates: the SAME query the Bridges screen reads (served from cache — no extra fetch), so
  // the pip counts exactly the rows that would show an update dot. `availableVersion` is set by the
  // host from its registry update check, so this is the identical signal the list's dot keys off.
  const { data: summaries } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });

  // Trackers have no NSFW concept and no per-summary update field, so they keep the registry check.
  const { data: trackerUpdates } = useQuery({
    queryKey: queryKeys.registryUpdateCount(),
    queryFn: async ({ signal }) => (await ds.checkRegistryTrackerUpdates(signal)) ?? [],
  });

  // Apply the exact visibility rule the Bridges list uses (`bridges.tsx`), so a hidden NSFW bridge's
  // update is never counted — its row isn't in that list, so advertising it would be a dead-end pip.
  const visibleBridges = summaries && hideNsfw ? summaries.filter((s) => !s.info.nsfw) : summaries;
  const b = (visibleBridges ?? []).filter((s) => s.availableVersion).length;
  const t = (trackerUpdates ?? []).length;
  return { bridges: b, trackers: t, total: b + t };
}

/** The grand total — the Settings tab pip. */
export function useSettingsBadgeCount(): number {
  return useRegistryUpdateCounts().total;
}
