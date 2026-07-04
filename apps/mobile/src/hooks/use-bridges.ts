import { useEffect, useMemo, useState } from 'react';

import { isAbort } from '@/data/api';
import { useDataSource } from '@/data/source';
import type { Bridge } from '@/data/types';

/**
 * Fetches the installed bridges once and returns a `bridgeId → Bridge` map plus a
 * `directOf` helper. The Library/History/Activity tabs each carry per-entry
 * bridge ids (unlike the Browse grid's single-bridge view) and need the bridge's
 * display name (for the row/card + the detail header) and its `direct` capability
 * (so opening the series renders the page grid, not a chapter list).
 */
export function useBridgeMap(): {
  byId: Map<string, Bridge>;
  nameOf: (bridgeId: string) => string;
  directOf: (bridgeId: string) => boolean;
} {
  const ds = useDataSource();
  const [bridges, setBridges] = useState<Bridge[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    ds.getBridges(ctrl.signal)
      .then(setBridges)
      .catch((e) => {
        if (!isAbort(e)) setBridges([]);
      });
    return () => ctrl.abort();
  }, [ds]);

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
