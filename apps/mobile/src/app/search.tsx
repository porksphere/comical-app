import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar, SortControl } from '@/components/filters/filter-demo';
import { resolveMetaIntent, resolveTagIntent, type MetaIntent, type TagIntent } from '@/components/filters/filter-intents';
import { filterValueToApi } from '@/components/filters/filter-types';
import { GridSkeleton } from '@/components/grid-skeleton';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { PullIndicator } from '@/components/pull-indicator';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useDedupedPages } from '@/data/grid-pages';
import { fetchBrowseScope, queryKeys, type BrowseScope } from '@/data/queries';
import { subscribeSearchIntent, takeSearchIntent } from '@/data/search-intent';
import { useSelectedBridge } from '@/data/selected-bridge';
import { useDataSource, useMockActive } from '@/data/source';
import type { GridPage, SeriesEntry } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { useBridgeFilters } from '@/hooks/use-bridge-filters';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { GRID_COLUMN_GAP, padWithSpacers, useGridLayout } from '@/hooks/use-grid-layout';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useRevealDim } from '@/hooks/use-reveal-dim';
import { useSlidingBar } from '@/hooks/use-sliding-bar';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

type GridItem = SeriesEntry & { spacer?: boolean };

// Stable, never-fetched key for the results infinite query while it's disabled (no active search).
const DISABLED_RESULTS_KEY = ['browseGrid', 'disabled', 'search'] as const;

// Peak opacity of the top bar's drop shadow at the mid-point of the filter bar's slide.
const SHADOW_PEAK_OPACITY = 0.16;

const getNextPageParam = (last: GridPage, _all: GridPage[], lastParam: number) =>
  last.hasNextPage ? lastParam + 1 : undefined;

/**
 * The dedicated Search screen, pushed over the tabs. Its top bar holds the search
 * field; a secondary bar directly below holds the filters and slides away as the
 * results scroll down (reappearing on scroll up). It inherits the Browse-selected
 * bridge (`useSelectedBridge`) — filters are per-bridge — and owns the free-text
 * query + filter/sort state (`useBridgeFilters`). A Series→Search tag/meta intent
 * (see search-intent.ts) is consumed on mount and applied against the intent's bridge.
 */
export default function SearchScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const listRef = useRef<LegendListRef>(null);
  // Paint the top/filter bars first, then mount the heavy grid `runAfterInteractions` so the push
  // transition plays immediately instead of stuttering behind the list's first render (native only).
  const ready = useDeferredMount();

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

  // An intent can also arrive while Search is ALREADY mounted: cards in the results grid below carry
  // the long-press preview, and tapping one of its tag rows sets an intent without changing the route
  // (see series-card-context-menu), so the mount-only read above would never see it.
  //
  // Only consume it while FOCUSED. This screen can also sit BACKGROUNDED in the stack (Search → tap a
  // card → Series), and a tag tapped up on that Series pushes a NEW Search for it — if this
  // backgrounded instance answered the subscription it would swallow the intent, leaving the pushed
  // screen to mount on an empty `takeSearchIntent()`. Unfocused, we ignore it and let the push consume
  // it on mount.
  //
  // Seed the same three paths as mount — but clear the existing query/filters/sort first, so the tap
  // lands on a clean slate exactly as it would on a freshly-pushed Search. Without that, the new tag
  // would MERGE into whatever refinement is already on screen (the filters hook only self-resets on a
  // bridge CHANGE, and this intent is usually for the same bridge), silently ANDing the tag with the
  // previous search's filters — not what "search this tag" means.
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      return () => {
        focusedRef.current = false;
      };
    }, []),
  );
  useEffect(
    () =>
      subscribeSearchIntent(() => {
        if (!focusedRef.current) return;
        const intent = takeSearchIntent();
        if (!intent) return;
        setBridge(intent.bridgeName);
        setFilterValues({});
        setSortValue(null);
        setQuery(intent.kind === 'query' ? intent.query : '');
        setPendingTag(
          intent.kind === 'tag'
            ? { filterKey: intent.filterKey, tagId: intent.tagId, label: intent.label }
            : null,
        );
        setPendingMeta(intent.kind === 'meta' ? { metaKey: intent.metaKey, value: intent.value } : null);
      }),
    [setBridge, setFilterValues, setSortValue],
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

  // Filter ordering: default is the bridge's own order; once a filter has an edit (a non-default
  // value that actually contributes to the query), move it to the FRONT. A stable partition — edited
  // filters keep their relative bridge order, then the untouched ones in bridge order — so the list
  // never shuffles unpredictably, and the filters you've set are the ones most likely to stay
  // visible before the "+N" overflow.
  const orderedDefs = useMemo(() => {
    const edited: typeof filterDefs = [];
    const rest: typeof filterDefs = [];
    for (const d of filterDefs) {
      (filterValueToApi(d, resolvedValues[d.id]) !== null ? edited : rest).push(d);
    }
    return edited.length ? [...edited, ...rest] : filterDefs;
  }, [filterDefs, resolvedValues]);

  const hasFilterBar = filterDefs.length > 0;
  // The filter bar is exactly the top bar's height, so the two read as one stacked unit. No floor is
  // needed here any more: `TopBarHeight` is itself derived as CONTROL_HEIGHT + BarVerticalPad * 2
  // (see constants/theme.ts), so the bar can never be too short to hold its own 44pt chips without
  // squashing them. Its horizontal insets match the top bar too, so the "+N" overflow chip lines up
  // with the sort button above.
  const filtersBarH = hasFilterBar ? barHeight : 0;

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

  // Re-search dim: while a NEW scope (query / filter / sort change) loads, keepPreviousData holds the
  // previous results on screen — ease them to a dim and back rather than letting them sit there
  // looking live, or flashing to a skeleton. `isPlaceholderData` is true exactly for that case and
  // NOT for a plain refetch, so a pull-to-refresh doesn't dim (it has the spinner below instead).
  // Same hook the Browse grid uses. See useRevealDim for why a refinement dims where a bridge/page
  // switch crossfades.
  // Applied to the list wrapper (below), not per cell, so every result cell is a plain View.
  const { style: listDimStyle } = useRevealDim(resultsQuery.isPlaceholderData);

  // De-duplicate by series id while flattening the infinite pages — a live-reordering search feed can
  // return the same series on two adjacent pages, colliding on the list `keyExtractor`. Same helper
  // the Browse grid uses.
  const gridItems = useDedupedPages(resultsQuery.data);
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

  // ── Sliding filter bar ─────────────────────────────────────────────────────
  // The filter bar sits just below the (fixed) search bar and slides up out of view as the results
  // scroll down, back in as they scroll up. Same shared helper the Browse bar uses (so the motion
  // can't drift); a new search (`scopeKey` change) snaps it back to visible and the list to the top.
  const { scrollY, offset: filtersOffsetY, barStyle: filtersStyle, sharedValues, onScroll: onListScroll } =
    useSlidingBar(filtersBarH, { resetKey: scopeKey, listRef });
  // The top bar's own bottom hairline is the inverse of the filter bar's visibility: hidden while the
  // filter bar is fully expanded right below it (the filter bar's hairline is the divider then), and
  // fading in as the filter bar slides up out of view (so the top bar keeps a divider from the
  // content). With no filter bar at all, it's simply always shown.
  const topBarBorderStyle = useAnimatedStyle(() => {
    const t = filtersBarH > 0 ? Math.min(1, Math.max(0, -filtersOffsetY.value / filtersBarH)) : 1;
    return { borderBottomColor: interpolateColor(t, [0, 1], ['transparent', theme.hairline]) };
  });
  // A subtle drop shadow only while the filter bar is mid-slide — a depth cue as it pops out from
  // behind the top bar. Zero at both rest states (fully expanded = flush unit; fully collapsed = the
  // hairline takes over), peaking in the middle of the motion (a parabola over the slide progress).
  const topBarShadowStyle = useAnimatedStyle(() => {
    const t = filtersBarH > 0 ? Math.min(1, Math.max(0, -filtersOffsetY.value / filtersBarH)) : 0;
    return { shadowOpacity: SHADOW_PEAK_OPACITY * 4 * t * (1 - t) };
  });

  // Pull-to-refresh: the whole thing (gesture per platform, spinner, min-visible window, content
  // shift) lives in the shared hook — same one the Browse grid uses. Refetches the CURRENT search;
  // guarded on `scope` because the blank landing has nothing to refresh, and refetching a disabled
  // query would resolve instantly and just flash the spinner.
  const pull = usePullToRefresh(scrollY, () => (scope ? resultsQuery.refetch() : Promise.resolve()));

  const loadMore = () => {
    if (!scope || !resultsQuery.hasNextPage || resultsQuery.isFetchingNextPage) return;
    void resultsQuery.fetchNextPage();
  };

  const goBack = () => {
    hapticImpactLight();
    router.back();
  };

  // Empty-state body shown when the grid has no items: a retry on error, a first-load skeleton, or
  // "no results". The blank landing (no query/filter yet) shows nothing. Folded into the list header
  // to match the Browse/Library grids.
  const showEmpty = gridData.length === 0 && (bridgesLoaded || bridges.length > 0);
  const emptyBody = !showEmpty ? null : gridError ? (
    <RetryBlock message={gridError} onRetry={() => resultsQuery.refetch()} />
  ) : !scope ? null : resultsQuery.isLoading ? (
    <GridSkeleton numColumns={numColumns} rows={2} />
  ) : (
    <View style={styles.hint}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hintText}>
        No results
      </ThemedText>
    </View>
  );

  const filterBar = hasFilterBar ? (
    // Absolute overlay pinned to the top of the list host; slides up via `filtersStyle`. Opaque
    // background so results pass behind it, with a bottom hairline as the divider from the content.
    // Inner row capped + centred to line up with the grid.
    <Animated.View
      style={[
        styles.filtersBar,
        { height: filtersBarH, backgroundColor: theme.background, borderBottomColor: theme.hairline },
        filtersStyle,
      ]}
      pointerEvents="box-none">
      <View style={styles.filtersInner}>
        <FilterBar defs={orderedDefs} values={resolvedValues} onValueChange={setFilterValue} />
      </View>
    </Animated.View>
  ) : null;

  return (
    // Touch-driven pull-to-refresh for web + Android is caught here on the outer view, so it works
    // regardless of what's under the finger (iOS sources its pull from the native bounce instead).
    <ThemedView style={styles.container} {...pull.touchHandlers}>
      {/* Fixed top bar: back button + search field (autofocused after the push settles) + sort.
          Opaque background so the filter bar tucks fully behind it as it slides up. Its bottom
          hairline fades in only once the filter bar has slid away (see topBarBorderStyle). */}
      <Animated.View
        style={[
          styles.topBar,
          { paddingTop: insets.top, backgroundColor: theme.background },
          topBarBorderStyle,
          topBarShadowStyle,
        ]}>
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
          {sortOptions.length > 0 && (
            <SortControl sortOptions={sortOptions} sort={sortValue} onSortChange={setSortValue} />
          )}
        </View>
      </Animated.View>

      {bridgesError && bridges.length === 0 ? (
        <View style={[styles.container, styles.centerFill]}>
          <RetryBlock message={bridgesError} onRetry={refetchBridges} />
        </View>
      ) : (
        <View style={styles.listHost}>
          {/* Wrapping rather than animating AnimatedLegendList's own `style` — LegendList's style prop
              isn't typed for a Reanimated animated style the way Animated.View's is. Shifts the grid
              down to open the gap the spinner sits in. */}
          {ready && (
            <Animated.View style={[styles.list, pull.listStyle, listDimStyle]}>
            <AnimatedLegendList
              ref={listRef}
              key={gridKey}
              style={styles.list}
              sharedValues={sharedValues}
              // Web only: forces scrollEventThrottle:1 so onScroll/onEndReached advance during the
              // gesture, not only on release. On native it just saturates the JS thread each frame
              // during a fling — the UI-thread `scrollY` drives the sliding bar regardless. (Same
              // reasoning as the Browse list.)
              renderScrollComponent={
                Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined
              }
              onScroll={onListScroll}
              data={gridData}
              estimatedItemSize={estimatedCardHeight(cardWidth)}
              // Rough `estimatedItemSize` means measured rows differ from it; LegendList's default
              // maintain-visible-content-position would retro-correct the offset and cause a
              // fling bounce/jitter. Turn it off so positions settle once measured. (Same as Browse.)
              maintainVisibleContentPosition={{ data: false, size: false }}
              keyExtractor={(item) => String(item.id)}
              numColumns={numColumns}
              recycleItems
              ListHeaderComponent={emptyBody}
              columnWrapperStyle={numColumns > 1 ? { gap: GRID_COLUMN_GAP } : undefined}
              contentContainerStyle={{
                // Reserve the filter bar's height so the first row starts below it, plus a little gap.
                paddingTop: filtersBarH + Spacing.three,
                paddingBottom: insets.bottom + Spacing.five,
                paddingLeft: sidePad,
                paddingRight: sidePad,
              }}
              renderItem={({ item }) =>
                item.spacer ? (
                  <View style={styles.gridCell} />
                ) : (
                  // Plain View — the re-search dim now rides the list wrapper (listDimStyle above),
                  // so no Reanimated Animated.View per result cell.
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
              // Android's edge glow would fight the custom pull; iOS keeps its bounce (that's what
              // sources the pull there), and a release past the threshold fires via onScrollEndDrag.
              overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
              onScrollEndDrag={pull.onScrollEndDrag}
            />
            </Animated.View>
          )}
          {ready && filterBar}
          {/* Settles just below the filter bar, in the gap the pull opens. */}
          <PullIndicator {...pull.indicator} top={filtersBarH} />
        </View>
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
    zIndex: 20,
    // Downward drop shadow (iOS/web); its opacity is animated by topBarShadowStyle so it only shows
    // mid-slide. Elevation is deliberately omitted — the Android system shadow can't be faded the
    // same way, and this is a minor iOS/web depth cue.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
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
  listHost: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  filtersBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filtersInner: {
    // Same cap + horizontal padding as the top bar row, so the filter row spans exactly the same
    // width — the "+N" overflow chip ends where the sort button above it ends.
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
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
