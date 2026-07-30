import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar, SortControl } from '@/components/filters/filter-demo';
import { resolveMetaIntent, resolveTagIntent, type MetaIntent, type TagIntent } from '@/components/filters/filter-intents';
import { filterValueToApi } from '@/components/filters/filter-types';
import { ContentFeed } from '@/components/content-feed';
import { GridSkeleton } from '@/components/grid-skeleton';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { BarSurface } from '@/components/bar-surface';
import { PullIndicator } from '@/components/pull-indicator';
import { SeriesGrid } from '@/components/series-grid';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useDedupedPages } from '@/data/grid-pages';
import { fetchBrowseScope, nextGridCursor, NO_CURSOR, queryKeys, type BrowseScope } from '@/data/queries';
import { subscribeSearchIntent, takeSearchIntent } from '@/data/search-intent';
import { COMICAL_BRIDGE_ID, isComicalBridge, useSelectedBridge } from '@/data/selected-bridge';
import { useDataSource, useMockActive } from '@/data/source';
import type { Bridge } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { useBridgeFilters } from '@/hooks/use-bridge-filters';
import { useCrossBridgeRails } from '@/hooks/use-cross-bridge-rails';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useGridLayout } from '@/hooks/use-grid-layout';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useRevealDim } from '@/hooks/use-reveal-dim';
import { useSlidingBar } from '@/hooks/use-sliding-bar';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';
import { useRouter } from '@/lib/nav';

// Stable, never-fetched key for the results infinite query while it's disabled (no active search).
const DISABLED_RESULTS_KEY = ['browseGrid', 'disabled', 'search'] as const;
// Stable empty array so `useCrossBridgeRails` runs zero queries in single-bridge mode.
const NO_BRIDGES: Bridge[] = [];

// Peak opacity of the top bar's drop shadow at the mid-point of the filter bar's slide.
const SHADOW_PEAK_OPACITY = 0.16;

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

  const {
    currentBridge,
    bridgeId,
    directBridge,
    setBridge,
    bridgesError,
    bridgesLoaded,
    bridges,
    visibleBridges,
    refetchBridges,
  } = useSelectedBridge();

  // Cross-bridge mode: when the synthetic "Comical" bridge is selected, search fans out over every
  // real bridge and shows one rail of results per bridge (no filters/sort — Comical has no capabilities,
  // so useBridgeFilters below yields empty defs and the filter bar auto-hides).
  const isComical = isComicalBridge(bridgeId);
  const realBridges = useMemo(() => visibleBridges.filter((b) => b.id !== COMICAL_BRIDGE_ID), [visibleBridges]);

  // Point Search at the intent's bridge (may differ from the Browse-selected one) on mount.
  useEffect(() => {
    if (initialIntent) setBridge(initialIntent.bridgeId);
    // Once, on mount — `setBridge`/`initialIntent` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [query, setQuery] = useState(initialIntent?.kind === 'query' ? initialIntent.query : '');

  // The cross-bridge search rows (one rail per bridge). Runs zero queries in single-bridge mode.
  const comicalSearch = useCrossBridgeRails(isComical ? realBridges : NO_BRIDGES, { mode: 'search', query });

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
        setBridge(intent.bridgeId);
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
  // Full height the (overlaid) top bar occupies — status bar + the bar itself. Everything below it
  // positions from here: the filter bar's clip window, the grid's top padding, the pull spinner.
  const topBarTotal = insets.top + barHeight;

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
    // Comical has no single-bridge results — its rows come from the cross-bridge fan-out instead.
    enabled: !!scope && !isComical,
    initialPageParam: NO_CURSOR,
    getNextPageParam: nextGridCursor,
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

  // Column count for the loading skeleton below; the grid itself derives its own layout.
  const { numColumns } = useGridLayout();

  // Identifies the current search. SeriesGrid folds it into the list key and the cards' recycle
  // cohort, so a new search resets recycled card state rather than flashing the previous result's cover.
  const scopeKey = scope ? `${bridgeId}|${query}|${committedSort?.key ?? ''}|${JSON.stringify(committedFilters ?? {})}` : 'blank';

  // ── Sliding filter bar ─────────────────────────────────────────────────────
  // The filter bar sits just below the (fixed) search bar and slides up out of view as the results
  // scroll down, back in as they scroll up. Same shared helper the Browse bar uses (so the motion
  // can't drift); a new search (`scopeKey` change) snaps it back to visible and the list to the top.
  const { scrollY, offset: filtersOffsetY, barStyle: filtersStyle, sharedValues, onScroll: onListScroll } =
    useSlidingBar(filtersBarH, { resetKey: scopeKey, listRef });
  // The top bar's hairline is ALWAYS on (BarSurface draws it), including while the filter bar is
  // expanded right beneath it. It used to fade out there, so the two bars read as one flush unit —
  // but they are two separate blur surfaces, and a blur only samples the content directly behind
  // ITSELF (its kernel doesn't reach across the boundary into the neighbouring bar's backdrop). So
  // the two never quite match at the join, and with no divider that mismatch reads as a smudge.
  // A crisp hairline makes the seam deliberate instead: a divider between two bars, which is what it
  // actually is. (Truly seamless would need ONE blur surface spanning both — incompatible with the
  // filter bar sliding up BEHIND the top bar, which requires something to slide behind.)
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
  const pull = usePullToRefresh(scrollY, () =>
    isComical ? comicalSearch.refetch() : scope ? resultsQuery.refetch() : Promise.resolve(),
  );

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
  const showEmpty = gridItems.length === 0 && (bridgesLoaded || bridges.length > 0);
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
    // The CLIP MASK. The filter bar slides up (`filtersStyle`) to hide, and this fixed-height,
    // overflow:hidden window sits exactly in the gap below the top bar — so the bar is progressively
    // CUT OFF at the top bar's bottom edge instead of travelling underneath it.
    //
    // This is what lets the top bar be frosted at all. A blur samples whatever is physically beneath
    // it and can't tell "chrome" from "content", so an unclipped filter bar sliding under it would
    // smear through the frost. Clipped, the filter bar never exists under the top bar, and the only
    // thing left to show through is the RESULTS scrolling up under it — which is the entire point of
    // a frosted bar. The tuck looks the same as before: the clip edge IS the top bar's bottom edge,
    // so the chips still read as sliding in behind it.
    <View pointerEvents="box-none" style={[styles.filtersClip, { top: topBarTotal, height: filtersBarH }]}>
      <BarSurface safeAreaTop={false} style={[styles.filtersBar, { height: filtersBarH }, filtersStyle]}>
        <View style={styles.filtersInner}>
          <FilterBar defs={orderedDefs} values={resolvedValues} onValueChange={setFilterValue} />
        </View>
      </BarSurface>
    </View>
  ) : null;

  return (
    // Touch-driven pull-to-refresh for web + Android is caught here on the outer view, so it works
    // regardless of what's under the finger (iOS sources its pull from the native bounce instead).
    <ThemedView style={styles.container} {...pull.touchHandlers}>
      {/* Overlaid top bar: back button + search field (autofocused after the push settles) + sort.
          Frosted like every other bar (BarSurface): the RESULTS scroll under it and show through. The
          filter bar does NOT — it's clipped out before it can reach here (see `filterBar`) — so the
          frost only ever carries content, never chrome. */}
      <BarSurface style={[styles.topBar, topBarShadowStyle]}>
        <View style={[styles.topBarRow, { height: barHeight }]}>
          <Pressable
            testID="search.back"
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
              testID="search.field"
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
      </BarSurface>

      {bridgesError && bridges.length === 0 ? (
        <View style={[styles.container, styles.centerFill]}>
          <RetryBlock message={bridgesError} onRetry={refetchBridges} />
        </View>
      ) : (
        <View style={styles.listHost}>
          {ready &&
            (isComical ? (
              // Cross-bridge: one rail of results per bridge (each rail carries its own bridge so its
              // cards open the right bridge). No filters, no single-bridge pagination — page 1 per rail;
              // a rail's "See all" (ContentFeed → /results) is where you infinite-scroll one bridge.
              <ContentFeed
                rows={comicalSearch.rows}
                scopeKey={query || 'blank'}
                listRef={listRef}
                header={
                  query.trim() && comicalSearch.rows.length === 0 && !comicalSearch.anyLoading ? (
                    <View style={styles.hint}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.hintText}>
                        No results
                      </ThemedText>
                    </View>
                  ) : null
                }
                paddingTop={topBarTotal + filtersBarH + BarContentGap}
                paddingBottom={insets.bottom + Spacing.five}
                sharedValues={sharedValues}
                onScroll={onListScroll}
                onScrollEndDrag={pull.onScrollEndDrag}
                wrapperStyle={pull.listStyle}
              />
            ) : (
              <SeriesGrid
                items={gridItems}
                scopeKey={scopeKey}
                listRef={listRef}
                header={emptyBody}
                // The top bar OVERLAYS the list (so results scroll under its frost), so reserve it as
                // well as the filter bar beneath it, plus a little breathing room.
                paddingTop={topBarTotal + filtersBarH + BarContentGap}
                paddingBottom={insets.bottom + Spacing.five}
                bridge={currentBridge?.name ?? undefined}
                bridgeId={bridgeId}
                direct={directBridge}
                sharedValues={sharedValues}
                onScroll={onListScroll}
                onEndReached={loadMore}
                onScrollEndDrag={pull.onScrollEndDrag}
                // The pull-to-refresh content shift and the re-search dim both ride the list wrapper.
                wrapperStyle={[pull.listStyle, listDimStyle]}
              />
            ))}
          {ready && filterBar}
          {/* Settles just below the bars, in the gap the pull opens. */}
          <PullIndicator {...pull.indicator} top={topBarTotal + filtersBarH} />
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
  // OVERLAYS the list, so the results scroll underneath and show through its frost (the same shape
  // as the Browse bar). The grid reserves `topBarTotal` at the top of its content to compensate.
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  // Fixed window between the top bar and the results. `overflow: hidden` is the mask: the filter bar
  // inside is cut off at this box's top edge (= the top bar's bottom edge) as it slides up, so it
  // never passes under the top bar and can never be picked up by its blur. See `filterBar`.
  filtersClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  filtersBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
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
