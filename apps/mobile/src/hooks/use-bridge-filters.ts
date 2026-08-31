/**
 * Per-bridge filter + sort state machine for the Search screen.
 *
 * Lifted out of the Browse screen when search/filters moved to their own page:
 * it owns the bridge's filter/sort *definitions* (derived from the react-query
 * cache, enriched with live tag search + out-of-band label hints), the user's
 * sparse selections over lazy defaults, and the debounced "committed" snapshot
 * the results fetch actually depends on. Capability-gated: a bridge without the
 * `filters`/`sort` capability yields empty defs and never fetches.
 *
 * The Series→Search tag/meta intent is applied by the caller (search.tsx) via
 * the exposed `setFilterValues`/`setLabelHints` setters once `filtersSettled`,
 * reusing the pure `resolveTagIntent`/`resolveMetaIntent`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useQuery, keepPreviousData } from '@tanstack/react-query';

import type { SortOption, SortState } from '@/components/filters/filter-demo';
import {
  filterDefFromApi,
  filterValueToApi,
  initialValue,
  type FilterDef,
  type FilterValue,
} from '@/components/filters/filter-types';
import { useSearchSort } from '@/hooks/use-search-sort';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive, type QueryOpts } from '@/data/source';
import type { Bridge } from '@/data/types';

/** Debounce before a filter/sort change triggers a re-fetch — avoids spamming the bridge backend
 *  on every tap. Mirrors the reference's snapshot-diff-on-close contract. */
const FILTER_DEBOUNCE_MS = 500;

export type BridgeFilters = {
  filterDefs: FilterDef[];
  sortOptions: SortOption[];
  /** "Filters are loaded for the CURRENT bridge" — the timing gate for intent application. */
  filtersSettled: boolean;
  filterValues: Record<string, FilterValue>;
  setFilterValues: React.Dispatch<React.SetStateAction<Record<string, FilterValue>>>;
  setFilterValue: (id: string, v: FilterValue) => void;
  /** The full value map (user's sparse changes over each def's lazy default). */
  resolvedValues: Record<string, FilterValue>;
  sortValue: SortState;
  setSortValue: (sort: SortState) => void;
  setLabelHints: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  /** Debounced snapshot the fetch depends on (not the raw values). */
  committedFilters: QueryOpts['filters'];
  committedSort: QueryOpts['sort'];
  /** Whether `committedSort` was CHOSEN on this screen rather than restored from the per-bridge
   *  memory — the caller's test for "the user has expressed a search". A remembered sort orders a
   *  search; it must never be the thing that STARTS one, or opening Search on a bridge you have
   *  ever sorted would fire a query-less listing behind the blank page's keyboard. Committed in the
   *  same debounce as the sort itself, so the two can never disagree about one request. */
  committedSortExplicit: boolean;
};

export function useBridgeFilters(bridgeId: string | undefined, currentBridge: Bridge | undefined): BridgeFilters {
  const ds = useDataSource();
  const mock = useMockActive();

  const hasFiltersCap = currentBridge?.capabilities.includes('filters') ?? false;
  const hasSortCap = currentBridge?.capabilities.includes('sort') ?? false;

  const filtersRawQuery = useQuery({
    queryKey: queryKeys.bridgeFilters(mock, bridgeId ?? ''),
    queryFn: ({ signal }) => ds.getFilters(bridgeId!, signal),
    enabled: !!bridgeId && hasFiltersCap,
    placeholderData: keepPreviousData,
  });
  const sortRawQuery = useQuery({
    queryKey: queryKeys.bridgeSortOptions(mock, bridgeId ?? ''),
    queryFn: ({ signal }) => ds.getSortOptions(bridgeId!, signal),
    enabled: !!bridgeId && hasSortCap,
    placeholderData: keepPreviousData,
  });

  // id→label hints for tag values selected out-of-band (a tapped tag chip on a Series screen),
  // merged into the DERIVED `filterDefs` below. Reset on bridge change.
  const [labelHints, setLabelHints] = useState<Record<string, Record<string, string>>>({});

  // `filterDefs` is DERIVED from the query (enriched with the live tag-search fn + any label hints),
  // updating in the SAME render as the query data — so intent effects can gate purely on
  // `filtersSettled` with no separate mirror id.
  const filterDefs = useMemo<FilterDef[]>(() => {
    if (!hasFiltersCap) return [];
    return (filtersRawQuery.data ?? []).map((f) => {
      let def = filterDefFromApi(f);
      if (def.type === 'tags' && !def.options)
        def = { ...def, search: (query: string) => ds.getTags(bridgeId!, query), searchKey: bridgeId };
      const hints = labelHints[def.id];
      if (def.type === 'tags' && hints) def = { ...def, labelHints: { ...(def.labelHints ?? {}), ...hints } };
      return def;
    });
  }, [hasFiltersCap, filtersRawQuery.data, labelHints, ds, bridgeId]);

  const sortOptions = useMemo<SortOption[]>(
    () => (hasSortCap ? (sortRawQuery.data ?? []) : []),
    [hasSortCap, sortRawQuery.data],
  );

  const filtersSettled =
    !hasFiltersCap || ((filtersRawQuery.isSuccess || filtersRawQuery.isError) && !filtersRawQuery.isPlaceholderData);

  // User-editable selections. `filterValues` is SPARSE — only the user's explicit changes; any unset
  // filter falls back to its `initialValue` lazily (see `resolvedValues`). Reset on bridge change.
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});
  // Per-bridge and PERSISTED, unlike the filters beside it — so a bridge you always read by
  // "latest chapter" is still sorted that way on the next search, and after a restart. Derived from
  // `bridgeId` rather than held in state, which is also what retires the sort half of the
  // bridge-change reset below: switching bridges now reads the new bridge's own remembered choice
  // instead of clearing to the default. See useSearchSort for why per bridge is the only shape the
  // key vocabulary allows.
  const [sortValue, setStoredSort] = useSearchSort(bridgeId, sortOptions);
  // Whether the sort in effect was tapped on this screen, as opposed to restored for this bridge.
  // See `committedSortExplicit`. Cleared with the filters on a bridge change: the next bridge's
  // remembered sort is, again, not something the user has asked for here.
  const [sortTouched, setSortTouched] = useState(false);
  const setSortValue = useCallback(
    (next: SortState) => {
      setSortTouched(true);
      setStoredSort(next);
    },
    [setStoredSort],
  );
  const setFilterValue = useCallback((id: string, v: FilterValue) => {
    setFilterValues((prev) => ({ ...prev, [id]: v }));
  }, []);
  const resolvedValues = useMemo<Record<string, FilterValue>>(
    () => Object.fromEntries(filterDefs.map((d) => [d.id, filterValues[d.id] ?? initialValue(d)])),
    [filterDefs, filterValues],
  );

  // Reset user FILTER state (and label hints) when the bridge changes — the new bridge's defaults
  // apply lazily. Sort is not reset here and does not need to be: it is per-bridge and persisted,
  // so it re-derives from the new `bridgeId` on its own. A pending intent applies AFTER this, gated
  // on `filtersSettled`.
  // Done during render rather than in an effect so the new bridge is never described by the old
  // bridge's selections for a commit: the reset lands in the same render that first sees the new
  // `bridgeId`, instead of one paint later. (The effect form also ran a no-op reset on mount; this
  // doesn't need to, since all three already start empty.)
  const [prevBridgeId, setPrevBridgeId] = useState(bridgeId);
  if (prevBridgeId !== bridgeId) {
    setPrevBridgeId(bridgeId);
    setFilterValues({});
    setSortTouched(false);
    setLabelHints({});
  }

  // Debounced "committed" snapshot — the fetch depends on this, not on the raw values, so rapid taps
  // don't each fire a request.
  const [committedFilters, setCommittedFilters] = useState<QueryOpts['filters']>(undefined);
  const [committedSort, setCommittedSort] = useState<QueryOpts['sort']>(undefined);
  const [committedSortExplicit, setCommittedSortExplicit] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = filterDefs
        .map((d) => filterValueToApi(d, resolvedValues[d.id]))
        .filter((v): v is { key: string; value: unknown } => v !== null);
      setCommittedFilters(next.length ? (next as QueryOpts['filters']) : undefined);
      setCommittedSort(sortValue ? { key: sortValue.key, ascending: sortValue.ascending } : undefined);
      setCommittedSortExplicit(!!sortValue && sortTouched);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filterDefs, resolvedValues, sortValue, sortTouched]);

  return {
    filterDefs,
    sortOptions,
    filtersSettled,
    filterValues,
    setFilterValues,
    setFilterValue,
    resolvedValues,
    sortValue,
    setSortValue,
    setLabelHints,
    committedFilters,
    committedSort,
    committedSortExplicit,
  };
}
