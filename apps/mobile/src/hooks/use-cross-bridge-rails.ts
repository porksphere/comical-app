/**
 * The shared fan-out behind the synthetic "Comical" aggregate bridge: run one query PER real bridge in
 * parallel and assemble a rail per bridge (skeleton → filled) as `ContentRow[]` for `ContentFeed`. Both
 * the Comical home and the cross-bridge search are this same shape, differing only in what each bridge's
 * rail is fetched from:
 *   - `home`   → `fetchBridgeFeaturedRail(bridgeId)` (that bridge's featured/first rail list, page 1).
 *   - `search` → `fetchBrowseScope(bridgeId, {kind:'search',query}, 1)` (page 1 of that bridge's search),
 *                reusing the SAME cache key as single-bridge search (warm hits both ways).
 *
 * `bridges` MUST be the REAL bridges (the caller excludes `COMICAL_BRIDGE_ID`). Each rail carries its
 * own `BridgeScope`, so its cards navigate to the correct real bridge from the aggregate feed.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { buildCrossBridgeRows, type ContentRow, type CrossBridgeRailInput } from '@/data/content-rows';
import { fetchBridgeFeaturedRail, fetchBrowseScope, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Bridge, GridPage, RailSection } from '@/data/types';

type CrossBridgeMode = { mode: 'home' } | { mode: 'search'; query: string };

export function useCrossBridgeRails(
  bridges: Bridge[],
  params: CrossBridgeMode,
): { rows: ContentRow[]; anyLoading: boolean } {
  const ds = useDataSource();
  const mock = useMockActive();
  const query = params.mode === 'search' ? params.query.trim() : '';
  // Home always runs; search only once there's a non-empty query (else a blank landing).
  const active = params.mode === 'home' || query.length > 0;

  const results = useQueries({
    queries: bridges.map((b) =>
      params.mode === 'home'
        ? {
            queryKey: queryKeys.bridgeFeaturedRail(mock, b.id),
            queryFn: ({ signal }: { signal: AbortSignal }) => fetchBridgeFeaturedRail(ds, b.id, signal),
          }
        : {
            queryKey: queryKeys.browseGrid(mock, b.id, { kind: 'search' as const, query }),
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              fetchBrowseScope(ds, b.id, { kind: 'search', query }, 1, signal),
            enabled: active,
          },
    ),
  });

  return useMemo(() => {
    if (!active) return { rows: [] as ContentRow[], anyLoading: false };
    const inputs: CrossBridgeRailInput[] = bridges.map((b, i) => {
      const r = results[i];
      const direct = b.capabilities.includes('direct');
      let section: RailSection | null;
      let drill: { listId?: string; query?: string };
      if (params.mode === 'home') {
        section = (r.data as RailSection | null | undefined) ?? null;
        drill = { listId: section?.id };
      } else {
        const items = (r.data as GridPage | undefined)?.items ?? [];
        section = items.length ? { id: b.id, title: b.name, kind: 'regular', items } : null;
        drill = { query };
      }
      return { bridgeId: b.id, bridgeName: b.name, direct, loading: r.isLoading, section, drill };
    });
    return { rows: buildCrossBridgeRows(inputs), anyLoading: results.some((r) => r.isLoading) };
  }, [active, bridges, results, params.mode, query]);
}
