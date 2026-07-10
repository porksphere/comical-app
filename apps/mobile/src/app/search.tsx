import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar } from '@/components/filters/filter-demo';
import { resolveMetaIntent, resolveTagIntent, type MetaIntent, type TagIntent } from '@/components/filters/filter-intents';
import { GridSkeleton } from '@/components/grid-skeleton';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { fetchBrowseScope, queryKeys, type BrowseScope } from '@/data/queries';
import { takeSearchIntent } from '@/data/search-intent';
import { useSelectedBridge } from '@/data/selected-bridge';
import { useDataSource, useMockActive } from '@/data/source';
import type { GridPage, SeriesEntry } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { useBridgeFilters } from '@/hooks/use-bridge-filters';
import { GRID_COLUMN_GAP, padWithSpacers, useGridLayout } from '@/hooks/use-grid-layout';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

type GridItem = SeriesEntry & { spacer?: boolean };

// Stable, never-fetched key for the results infinite query while it's disabled (no active search).
const DISABLED_RESULTS_KEY = ['browseGrid', 'disabled', 'search'] as const;

const getNextPageParam = (last: GridPage, _all: GridPage[], lastParam: number) =>
  last.hasNextPage ? lastParam + 1 : undefined;

/**
 * The dedicated Search screen, pushed over the tabs. Its top bar holds the search
 * field; the filters sit at the top of the page content, with the results grid
 * below. It inherits the Browse-selected bridge (`useSelectedBridge`) — filters
 * are per-bridge — and owns the free-text query + filter/sort state
 * (`useBridgeFilters`). A Series→Search tag/meta intent (see search-intent.ts) is
 * consumed on mount and applied against the intent's bridge.
 */
export default function SearchScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const listRef = useRef<LegendListRef>(null);

  // Take the one-shot Series→Search intent exactly once (lazy initializer), before the first render
  // reads it. `query` seeds directly from a `query` intent; `tag`/`meta` are stashed and applied
  // once this bridge's filter defs settle (below), mirroring the old Browse focus-effect flow.
  const [initialIntent] = useState(() => takeSearchIntent());

  const { currentBridge, bridgeId, directBridge, setBridge, bridgesError, bridgesLoaded, bridges, refetchBridges } =
    useSelectedBridge();

  // Point Search at the intent's bridge (may differ from the Browse-selected one) on mount.
  useEffect(() => {
    if (initialIntent) setBridge(initialIntent.bridgeName);
    // Once, on mount — `setBridge`/`initialIntent` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [query, setQuery] = useState(initialIntent?.kind === 'query' ? initialIntent.query : '');

  const {
    filterDefs,
    sortOptions,
    filtersSettled,
    resolvedValues,
    setFilterValue,
    setFilterValues,
    setLabelHints,
    sortValue,
    setSortValue,
    committedFilters,
    committedSort,
  } = useBridgeFilters(bridgeId, currentBridge);

  // Pending tag/meta intent, resolved once this bridge's filter defs have loaded (`filtersSettled`) —
  // seeded from the mount intent, then cleared. Reuses the pure resolvers + their tests.
  const [pendingTag, setPendingTag] = useState<TagIntent | null>(
    initialIntent?.kind === 'tag'
      ? { filterKey: initialIntent.filterKey, tagId: initialIntent.tagId, label: initialIntent.label }
      : null,
  );
  const [pendingMeta, setPendingMeta] = useState<MetaIntent | null>(
    initialIntent?.kind === 'meta' ? { metaKey: initialIntent.metaKey, value: initialIntent.value } : null,
  );

  useEffect(() => {
    if (!pendingTag || !bridgeId || !filtersSettled) return;
    const res = resolveTagIntent(filterDefs, pendingTag);
    if (res) {
      // Seed the id→label hint so the trigger/editor show the tag's name (a live-search filter has no
      // static options to look it up in), and select it.
      setLabelHints((prev) => ({ ...prev, [res.defId]: { ...(prev[res.defId] ?? {}), ...res.labelHint } }));
      setFilterValues((prev) => ({ ...prev, [res.defId]: res.value }));
    }
    setPendingTag(null);
  }, [pendingTag, filterDefs, filtersSettled, bridgeId, setLabelHints, setFilterValues]);

  useEffect(() => {
    if (!pendingMeta || !bridgeId || !filtersSettled) return;
    // Prefer the bridge's own field for that meta key, else fall back to a free-text search.
    const res = resolveMetaIntent(filterDefs, pendingMeta);
    if (res.kind === 'filter') setFilterValues((prev) => ({ ...prev, [res.defId]: res.value }));
    else setQuery(res.query);
    setPendingMeta(null);
  }, [pendingMeta, filterDefs, filtersSettled, bridgeId, setFilterValues]);

  // A search runs once there's a query, or a committed filter/sort. Until then the page is a blank
  // landing (the desktop entry opens straight here). Both the query key and the fetch derive from
  // this one value (see BrowseScope).
  const scope = useMemo<BrowseScope | null>(() => {
    if (!bridgeId) return null;
    const active = !!query || (committedFilters?.length ?? 0) > 0 || !!committedSort;
    if (!active) return null;
    return { kind: 'search', query, opts: { filters: committedFilters, sort: committedSort } };
  }, [bridgeId, query, committedFilters, committedSort]);

  const resultsQuery = useInfiniteQuery({
    queryKey: scope ? queryKeys.browseGrid(mock, bridgeId ?? '', scope) : DISABLED_RESULTS_KEY,
    queryFn: ({ pageParam, signal }) => fetchBrowseScope(ds, bridgeId ?? '', scope!, pageParam, signal),
    enabled: !!scope,
    initialPageParam: 1,
    getNextPageParam,
    placeholderData: keepPreviousData,
  });

  const gridItems = useMemo<SeriesEntry[]>(
    () => resultsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [resultsQuery.data],
  );
  const gridError =
    scope && resultsQuery.isError && (!resultsQuery.data || resultsQuery.isPlaceholderData)
      ? friendlyError(resultsQuery.error, "Couldn't load results. Try again.")
      : null;

  const { numColumns, sidePad, cardWidth } = useGridLayout();
  const gridData = useMemo<GridItem[]>(
    () => padWithSpacers<GridItem>(gridItems, numColumns, (id) => ({ id, title: '', cover: '', spacer: true })),
    [gridItems, numColumns],
  );

  // Cohort string for SeriesCard recycle-safety (a scope change must reset the recycled card's cover),
  // and the list key's empty↔populated boundary guards LegendList's web reset-during-render bug.
  const scopeKey = scope ? `${bridgeId}|${query}|${committedSort?.key ?? ''}|${JSON.stringify(committedFilters ?? {})}` : 'blank';
  const gridKey = `${numColumns}|${gridData.length > 0 ? 'full' : 'empty'}`;

  const loadMore = () => {
    if (!scope || !resultsQuery.hasNextPage || resultsQuery.isFetchingNextPage) return;
    void resultsQuery.fetchNextPage();
  };

  const goBack = () => {
    hapticImpactLight();
    router.back();
  };

  // Empty-state body shown beneath the filters when the grid has no items: a retry on error, the
  // blank-landing hint before any search, a first-load skeleton, or "no results". Folded into the
  // list header (rather than ListEmptyComponent) to match the Browse/Library grids.
  const showEmpty = gridData.length === 0 && (bridgesLoaded || bridges.length > 0);
  const emptyBody = !showEmpty ? null : gridError ? (
    <RetryBlock message={gridError} onRetry={() => resultsQuery.refetch()} />
  ) : !scope ? (
    <View style={styles.hint}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hintText}>
        {currentBridge ? `Search ${currentBridge.name}` : 'Search'}
      </ThemedText>
    </View>
  ) : resultsQuery.isLoading ? (
    <GridSkeleton numColumns={numColumns} rows={2} />
  ) : (
    <View style={styles.hint}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hintText}>
        No results
      </ThemedText>
    </View>
  );

  const listHeader = (
    <>
      <View style={styles.filters}>
        <FilterBar
          defs={filterDefs}
          values={resolvedValues}
          onValueChange={setFilterValue}
          sortOptions={sortOptions}
          sort={sortValue}
          onSortChange={setSortValue}
          searchActive={!!scope}
        />
      </View>
      {emptyBody}
    </>
  );

  return (
    <ThemedView style={styles.container}>
      {/* Static top bar: back button + the search field (autofocused unless we arrived with an
          intent, which shouldn't pop the keyboard). Centred to the content width on desktop. */}
      <View style={[styles.topBar, { paddingTop: insets.top, borderBottomColor: theme.hairline }]}>
        <View style={[styles.topBarRow, { height: barHeight }]}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            android_ripple={{ color: theme.backgroundSelected, borderless: true }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}>
            <ChevronLeftIcon color={theme.text} />
          </Pressable>
          <View style={styles.searchWrap}>
            <SearchField
              value={query}
              onSubmit={(q) => setQuery(q.trim())}
              onClear={() => setQuery('')}
              autoFocus={!initialIntent}
            />
          </View>
        </View>
      </View>

      {bridgesError && bridges.length === 0 ? (
        <View style={[styles.container, styles.centerFill]}>
          <RetryBlock message={bridgesError} onRetry={refetchBridges} />
        </View>
      ) : (
        <LegendList
          ref={listRef}
          key={gridKey}
          style={styles.list}
          data={gridData}
          estimatedItemSize={estimatedCardHeight(cardWidth)}
          keyExtractor={(item) => String(item.id)}
          numColumns={numColumns}
          recycleItems
          ListHeaderComponent={listHeader}
          columnWrapperStyle={numColumns > 1 ? { gap: GRID_COLUMN_GAP } : undefined}
          contentContainerStyle={{
            paddingTop: Spacing.three,
            paddingBottom: insets.bottom + Spacing.five,
            paddingLeft: sidePad,
            paddingRight: sidePad,
          }}
          renderItem={({ item }) =>
            item.spacer ? (
              <View style={styles.gridCell} />
            ) : (
              <View style={styles.gridCell}>
                <SeriesCard
                  entry={item}
                  bridge={currentBridge?.name ?? undefined}
                  bridgeId={bridgeId}
                  direct={directBridge}
                  cohort={scopeKey}
                />
              </View>
            )
          }
          onEndReachedThreshold={0.6}
          onEndReached={loadMore}
          showsVerticalScrollIndicator={Platform.OS === 'web'}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchWrap: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  filters: {
    paddingVertical: Spacing.three,
  },
  gridCell: {
    flex: 1,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three - Spacing.one,
  },
  hint: {
    alignItems: 'center',
    paddingTop: Spacing.six,
  },
  hintText: {
    textAlign: 'center',
  },
});
