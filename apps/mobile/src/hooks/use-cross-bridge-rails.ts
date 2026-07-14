/**
 * The shared fan-out behind the synthetic "Comical" aggregate bridge: run one query PER real bridge in
 * parallel and assemble a rail per bridge (skeleton → filled) as `ContentRow[]` for `ContentFeed`. Both
 * the Comical home and the cross-bridge search are this same shape, differing only in what each bridge's
 * rail is fetched from:
 *   - `home`      → `fetchBridgeFeaturedRail(bridgeId)` (that bridge's featured/first rail list, page 1).
 *   - `search`    → `fetchBrowseScope(bridgeId, {kind:'search',query}, 1)` (page 1 of that bridge's
 *                   search), reusing the SAME cache key as single-bridge search (warm hits both ways).
 *   - `favorites` → `fetchBrowseScope(bridgeId, {kind:'favorites'}, 1)` (page 1 of that bridge's account
 *                   favorites) — the consolidated Comical Favorites page, one rail per logged-in bridge.
 *
 * `bridges` MUST be the REAL bridges (the caller excludes `COMICAL_BRIDGE_ID`). Each rail carries its
 * own `BridgeScope`, so its cards navigate to the correct real bridge from the aggregate feed.
 */
import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { buildCrossBridgeRows, type ContentRow, type CrossBridgeRailInput } from '@/data/content-rows';
import { fetchBridgeFeaturedRail, fetchBrowseScope, queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { Bridge, GridPage, RailSection } from '@/data/types';

type CrossBridgeMode = { mode: 'home' } | { mode: 'search'; query: string } | { mode: 'favorites' };

export function useCrossBridgeRails(
  bridges: Bridge[],
  params: CrossBridgeMode,
): { rows: ContentRow[]; anyLoading: boolean; refetch: () => Promise<void> } {
  const ds = useDataSource();
  const mock = useMockActive();
  const query = params.mode === 'search' ? params.query.trim() : '';
  // Home/favorites always run; search only once there's a non-empty query (else a blank landing).
  const active = params.mode !== 'search' || query.length > 0;

  const results = useQueries({
    queries: bridges.map((b) => {
      if (params.mode === 'home') {
        return {
          queryKey: queryKeys.bridgeFeaturedRail(mock, b.id),
          queryFn: ({ signal }: { signal: AbortSignal }) => fetchBridgeFeaturedRail(ds, b.id, signal),
        };
      }
      if (params.mode === 'favorites') {
        return {
          // Same key/call as a single-bridge favorites grid, so the two warm each other.
          queryKey: queryKeys.browseGrid(mock, b.id, { kind: 'favorites' as const }),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            fetchBrowseScope(ds, b.id, { kind: 'favorites' }, 1, signal),
        };
      }
      return {
        queryKey: queryKeys.browseGrid(mock, b.id, { kind: 'search' as const, query }),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchBrowseScope(ds, b.id, { kind: 'search', query }, 1, signal),
        enabled: active,
      };
    }),
  });

  // Refetch every per-bridge query — drives pull-to-refresh on the Comical surfaces. `results` is a new
  // array each render, so this closure is too; callers (usePullToRefresh) hold it in a ref, so that's fine.
  const refetch = useCallback(async () => {
    await Promise.all(results.map((r) => r.refetch()));
  }, [results]);

  const { rows, anyLoading } = useMemo(() => {
    if (!active) return { rows: [] as ContentRow[], anyLoading: false };
    const inputs: CrossBridgeRailInput[] = bridges.map((b, i) => {
      const r = results[i];
      const direct = b.capabilities.includes('direct');
      let section: RailSection | null;
      let drill: { listId?: string; query?: string; favorites?: boolean };
      if (params.mode === 'home') {
        section = (r.data as RailSection | null | undefined) ?? null;
        drill = { listId: section?.id };
      } else if (params.mode === 'favorites') {
        const items = (r.data as GridPage | undefined)?.items ?? [];
        // Titled "Favorites" (not the bridge name) so the "See all" breadcrumb reads "{bridge} › Favorites".
        section = items.length ? { id: `${b.id}:favorites`, title: 'Favorites', kind: 'regular', items } : null;
        drill = { favorites: true };
      } else {
        const items = (r.data as GridPage | undefined)?.items ?? [];
        section = items.length ? { id: b.id, title: b.name, kind: 'regular', items } : null;
        drill = { query };
      }
      return {
        bridgeId: b.id,
        bridgeName: b.name,
        direct,
        // `isPending` (no result yet), NOT `isLoading` (pending AND fetching) — on the very first
        // render a fresh query is pending but not yet fetching, so isLoading is false there. Using
        // isPending shows a skeleton from frame one, so the feed's rows are non-empty immediately (no
        // empty→full remount flash, and the crossfade reveals a skeleton rather than a blank list).
        loading: r.isPending,
        error: r.isError,
        onRetry: () => void r.refetch(),
        section,
        drill,
      };
    });
    return { rows: buildCrossBridgeRows(inputs), anyLoading: results.some((r) => r.isPending) };
  }, [active, bridges, results, params.mode, query]);

  return { rows, anyLoading, refetch };
}
