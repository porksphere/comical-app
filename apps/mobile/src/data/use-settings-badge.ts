/**
 * Registry updates available from the user's registries, split by category (bridges vs trackers).
 * These counts feed BOTH the Settings tab pip — the grand total — AND the per-category pips on the
 * Settings landing rows, so the tab badge and the Bridges/Trackers row badges can never disagree.
 *
 * The authoritative "what has a newer version" signal is the registry update check
 * (`checkRegistryUpdates` / `/registry/updates`) — a live check that returns the id + availableVersion
 * for every installed bridge/tracker with a newer version. A bridge summary's `availableVersion` is a
 * *cached mirror* of this that only gets refreshed when a check has run and persisted it back, so it
 * can lag (e.g. a freshly-published update shows in this check and on the registry-browse screen while
 * the summary annotation — and thus the Bridges list's dot — is still stale). So everything that must
 * be correct reads THIS check, not the annotation: the Bridges screen keys its per-row update dot off
 * `useBridgeUpdateMap` below, and the pip counts off the same list here.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';

export type RegistryUpdateCounts = {
  bridges: number;
  trackers: number;
  total: number;
};

const EMPTY: RegistryUpdateCounts = { bridges: 0, trackers: 0, total: 0 };

/** The raw update lists (bridges + trackers) behind every registry-update pip, as one cache entry.
 *  Kept un-counted so the NSFW filter in `useRegistryUpdateCounts` can re-derive on a Hide-NSFW toggle
 *  without a refetch, and so `useBridgeUpdateMap` can share the exact same fetch. */
function useRegistryUpdates() {
  const ds = useDataSource();
  return useQuery({
    queryKey: queryKeys.registryUpdateCount(),
    queryFn: async ({ signal }) => {
      const [bridges, trackers] = await Promise.all([
        ds.checkRegistryUpdates(signal),
        ds.checkRegistryTrackerUpdates(signal),
      ]);
      return { bridges: bridges ?? [], trackers: trackers ?? [] };
    },
  });
}

/** `bridgeId → availableVersion` for every installed bridge with a newer version in its registry —
 *  the live registry check, NOT the (possibly stale) `availableVersion` annotation on the bridge
 *  summary. The Bridges screen reads this so a bridge with a pending update reliably shows its update
 *  dot / swipe-Update even before the annotation has been persisted back onto the summary. Served from
 *  the same cache entry the pip uses — no extra fetch. */
export function useBridgeUpdateMap(): Map<string, string> {
  const { data } = useRegistryUpdates();
  return useMemo(() => new Map((data?.bridges ?? []).map((u) => [u.id, u.availableVersion])), [data]);
}

/** The full breakdown — used by the Settings landing screen to badge the Bridges/Trackers rows. */
export function useRegistryUpdateCounts(): RegistryUpdateCounts {
  const ds = useDataSource();
  const hideNsfw = useHideNsfw();

  const { data } = useRegistryUpdates();

  // The update list carries no `nsfw` flag; the installed-bridge summaries do. When NSFW is hidden a
  // hidden bridge's update must NOT be counted — otherwise the pip advertises an update whose row
  // isn't even in the Bridges list. Cross-reference by id and drop those. (Same query key the Bridges
  // screen uses, so this is served from cache — no extra fetch.)
  const { data: summaries } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });

  if (!data) return EMPTY;
  const nsfwIds = new Set((summaries ?? []).filter((s) => s.info.nsfw).map((s) => s.info.id));
  // While hiding NSFW, hold the bridge count until the summaries load: without them we can't tell
  // which updates belong to hidden bridges, and counting them would flash a pip pointing at a row the
  // Bridges list won't show. (When NSFW is visible there's nothing to filter, so no wait is needed.)
  const bridgeUpdates = hideNsfw ? (summaries ? data.bridges.filter((u) => !nsfwIds.has(u.id)) : []) : data.bridges;
  const b = bridgeUpdates.length;
  const t = data.trackers.length;
  return { bridges: b, trackers: t, total: b + t };
}

/** The grand total — the Settings tab pip. */
export function useSettingsBadgeCount(): number {
  return useRegistryUpdateCounts().total;
}
