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
  hasActiveQuery: boolean;
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
  const [sortValue, setSortValue] = useState<SortState>(null);
  const setFilterValue = useCallback((id: string, v: FilterValue) => {
    setFilterValues((prev) => ({ ...prev, [id]: v }));
  }, []);
  const resolvedValues = useMemo<Record<string, FilterValue>>(
    () => Object.fromEntries(filterDefs.map((d) => [d.id, filterValues[d.id] ?? initialValue(d)])),
    [filterDefs, filterValues],
  );

  // Reset user filter/sort state (and label hints) when the bridge changes — the new bridge's
  // defaults apply lazily. A pending intent applies AFTER this, gated on `filtersSettled`.
  useEffect(() => {
    setFilterValues({});
    setSortValue(null);
    setLabelHints({});
  }, [bridgeId]);

  // Debounced "committed" snapshot — the fetch depends on this, not on the raw values, so rapid taps
  // don't each fire a request.
  const [committedFilters, setCommittedFilters] = useState<QueryOpts['filters']>(undefined);
  const [committedSort, setCommittedSort] = useState<QueryOpts['sort']>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = filterDefs
        .map((d) => filterValueToApi(d, resolvedValues[d.id]))
        .filter((v): v is { key: string; value: unknown } => v !== null);
      setCommittedFilters(next.length ? (next as QueryOpts['filters']) : undefined);
      setCommittedSort(sortValue ? { key: sortValue.key, ascending: sortValue.ascending } : undefined);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filterDefs, resolvedValues, sortValue]);
  const hasActiveQuery = !!committedFilters || !!committedSort;

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
    hasActiveQuery,
  };
}
