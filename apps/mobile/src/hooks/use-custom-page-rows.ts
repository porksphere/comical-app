/**
 * Renders a user-composed custom page (see `data/custom-pages.ts`) into `ContentRow[]` for
 * `ContentFeed` — the sibling of `use-cross-bridge-rails.ts`, but driven by the page's explicit
 * sections instead of a fan-out over every bridge.
 *
 * Two parallel `useQueries` fans (both run unconditionally; empty when `page` is undefined):
 *   - **lists** — one `getBridgeLists` per DISTINCT bridge the page references. Supplies each list's
 *     LIVE name (for a section whose `name` is null → dynamic inheritance) and layout (rail kind).
 *     Subscribing to the same `queryKeys.bridgeLists` entry the rest of the app writes is what makes
 *     a bridge renaming a list re-title the section automatically, no migration.
 *   - **items** — page 1 of each section's list, under a dedicated `customSectionPage` key (NOT the
 *     infinite grid's `homeGrid` key — see queries.ts). Feeds the rail's items and the grid block's
 *     page-1 seed.
 */
import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { buildCustomPageRows, type ContentRow, type CustomPageSectionInput } from '@/data/content-rows';
import type { CustomPage } from '@/data/custom-pages';
import { queryKeys } from '@/data/queries';
import { railKindFor, useDataSource, useMockActive } from '@/data/source';
import type { BridgeList, GridPage } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';

const NO_SECTIONS: CustomPage['sections'] = [];

/**
 * A `(bridgeId, listId) → live list name / layout` resolver over a set of bridges. Shared by the
 * render hook AND the editor (so a section row shows the same dynamic title the home does). Runs one
 * `getBridgeLists` query per distinct bridge id.
 */
export function useBridgeListsResolver(bridgeIds: string[]): {
  listOf: (bridgeId: string, listId: string) => BridgeList | undefined;
  loadingOf: (bridgeId: string) => boolean;
} {
  const ds = useDataSource();
  const mock = useMockActive();
  const distinct = useMemo(() => [...new Set(bridgeIds)], [bridgeIds]);

  const results = useQueries({
    queries: distinct.map((bid) => ({
      queryKey: queryKeys.bridgeLists(mock, bid),
      queryFn: ({ signal }: { signal: AbortSignal }) => ds.getBridgeLists(bid, signal),
    })),
  });

  return useMemo(() => {
    const byBridge = new Map<string, BridgeList[]>();
    const loading = new Map<string, boolean>();
    distinct.forEach((bid, i) => {
      const r = results[i];
      if (r?.data) byBridge.set(bid, r.data);
      loading.set(bid, !!r?.isPending);
    });
    return {
      listOf: (bridgeId: string, listId: string) => byBridge.get(bridgeId)?.find((l) => l.id === listId),
      loadingOf: (bridgeId: string) => loading.get(bridgeId) ?? false,
    };
  }, [distinct, results]);
}

export function useCustomPageRows(
  page: CustomPage | undefined,
): { rows: ContentRow[]; anyLoading: boolean; refetch: () => Promise<void> } {
  const ds = useDataSource();
  const mock = useMockActive();
  const { byId } = useBridgeMap();

  const sections = page?.sections ?? NO_SECTIONS;
  const bridgeIds = useMemo(() => sections.map((s) => s.bridgeId), [sections]);
  const { listOf, loadingOf } = useBridgeListsResolver(bridgeIds);

  const itemResults = useQueries({
    queries: sections.map((s) => ({
      queryKey: queryKeys.customSectionPage(mock, s.bridgeId, s.listId),
      queryFn: ({ signal }: { signal: AbortSignal }) => ds.getGridPage(s.bridgeId, s.listId, 1, undefined, signal),
    })),
  });

  const refetch = useCallback(async () => {
    await Promise.all(itemResults.map((r) => r.refetch()));
  }, [itemResults]);

  const { rows, anyLoading } = useMemo(() => {
    const inputs: CustomPageSectionInput[] = sections.map((s, i) => {
      const r = itemResults[i];
      const bridge = byId.get(s.bridgeId);
      const bridgeName = bridge?.name ?? s.bridgeId;
      const list = listOf(s.bridgeId, s.listId);
      const page = r?.data as GridPage | undefined;
      // Title: explicit name → live list name (dynamic inheritance) → bridge name. The live-name leg
      // is why a bridge renaming a list re-titles an un-named section with no migration.
      const title = s.name ?? list?.name ?? bridgeName;
      return {
        key: s.id,
        layout: s.layout,
        title,
        // The rail's STYLE follows the section's chosen content type (carousel/ranked/hero → the
        // matching kind), not the underlying list's own layout hint — that's what the picker controls.
        railKind: railKindFor(s.layout),
        bridgeId: s.bridgeId,
        bridgeName,
        direct: bridge?.capabilities.includes('direct') ?? false,
        listId: s.listId,
        // Pending until BOTH the list metadata (title/kind) and the items have first resolved — a
        // skeleton from frame one, so the feed's rows are non-empty immediately (matches the
        // cross-bridge hook's `isPending` reveal behavior).
        loading: !!r?.isPending || loadingOf(s.bridgeId),
        error: !!r?.isError,
        onRetry: () => void r?.refetch(),
        items: page?.items ?? [],
        hasNextPage: page?.hasNextPage ?? false,
      };
    });
    return {
      rows: buildCustomPageRows(inputs),
      anyLoading: itemResults.some((r) => r.isPending) || bridgeIds.some((bid) => loadingOf(bid)),
    };
  }, [sections, itemResults, byId, listOf, loadingOf, bridgeIds]);

  return { rows, anyLoading, refetch };
}
