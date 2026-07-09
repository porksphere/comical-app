import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
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
 */
export function useBridgeMap(): {
  byId: Map<string, Bridge>;
  nameOf: (bridgeId: string) => string;
  directOf: (bridgeId: string) => boolean;
} {
  const ds = useDataSource();
  const { data: bridges = [] } = useQuery({
    queryKey: queryKeys.bridges(),
    queryFn: ({ signal }) => ds.getBridges(signal),
  });

  return useMemo(() => {
    const byId = new Map<string, Bridge>();
    for (const b of bridges) byId.set(b.id, b);
    return {
      byId,
      nameOf: (bridgeId: string) => byId.get(bridgeId)?.name ?? bridgeId,
      directOf: (bridgeId: string) => byId.get(bridgeId)?.capabilities.includes('direct') ?? false,
    };
  }, [bridges]);
}
