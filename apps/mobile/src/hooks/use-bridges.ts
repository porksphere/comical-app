import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { knownBridges } from '@/data/known-bridges';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Bridge } from '@/data/types';

/**
 * Fetches the installed bridges and returns a `bridgeId → Bridge` map plus a
 * `directOf` helper. The Library/History/Activity tabs each carry per-entry
 * bridge ids (unlike the Browse grid's single-bridge view) and need the bridge's
 * display name (for the row/card + the detail header) and its `direct` capability
 * (so opening the series renders the page grid, not a chapter list).
 *
 * react-query, explicitly invalidated by install/update/uninstall (registry-browse.tsx,
 * bridge-settings.tsx) — not a plain effect keyed on `ds`, since these tabs are very often
 * mounted-but-unfocused in the background while the user installs/uninstalls elsewhere. Shares its
 * query key with the Browse tab's own bridge list, so the two dedupe onto one fetch.
 *
 * `byId` is installed bridges only — the pickers built on it must never offer one that can't run.
 * `knownById` adds the bridges the library still references after an uninstall, marked
 * `installed: false`, with whatever the host remembers of them. Every helper here reads that one: a
 * series whose bridge is gone still has to be named, opened as the right kind of series, and hidden
 * when its bridge was adult.
 */
export function useBridgeMap(): {
  byId: Map<string, Bridge>;
  knownById: Map<string, Bridge>;
  nameOf: (bridgeId: string) => string;
  directOf: (bridgeId: string) => boolean;
  /** The bridge's `cardSubtitles` contract flag: whether its entries carry a card sub line, which
   *  is what the grids/rails reserve (or drop) the sub-line height on. Unknown bridge → false. */
  subOf: (bridgeId?: string) => boolean;
  /** The bridge's `ratings` contract flag: whether its source rates series at all. Unknown bridge
   *  → false, which hides the rating UI rather than showing an empty one. */
  ratingsOf: (bridgeId?: string) => boolean;
} {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data: bridges = [] } = useQuery({
    queryKey: queryKeys.bridges(mock),
    queryFn: ({ signal }) => ds.getBridges(signal),
  });
  const { data: missing = [] } = useQuery({
    queryKey: queryKeys.missingBridges(mock),
    queryFn: ({ signal }) => ds.getMissingBridges(signal),
  });

  return useMemo(() => {
    const byId = new Map<string, Bridge>();
    for (const b of bridges) byId.set(b.id, b);
    const knownById = knownBridges(bridges, missing);
    return {
      byId,
      knownById,
      nameOf: (bridgeId: string) => knownById.get(bridgeId)?.name ?? bridgeId,
      directOf: (bridgeId: string) => knownById.get(bridgeId)?.capabilities.includes('direct') ?? false,
      subOf: (bridgeId?: string) => (bridgeId ? (knownById.get(bridgeId)?.cardSubtitles ?? false) : false),
      ratingsOf: (bridgeId?: string) => (bridgeId ? (knownById.get(bridgeId)?.ratings ?? false) : false),
    };
  }, [bridges, missing]);
}
