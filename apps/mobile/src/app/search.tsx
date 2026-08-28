import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ComposedGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
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
import { clearSearchIntent, peekSearchIntent, subscribeSearchIntent, takeSearchIntent } from '@/data/search-intent';
import { COMICAL_BRIDGE_ID, isComicalBridge, useInheritedBridge } from '@/data/selected-bridge';
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

/**
 * The dedicated Search screen, pushed over the tabs. Its top bar holds the search
 * field; a secondary bar directly below holds the filters and closes over them as
 * the results scroll down (reopening on scroll up). It inherits the Browse-selected
 * bridge (`useInheritedBridge`) — filters are per-bridge — and owns the free-text
 * query + filter/sort state (`useBridgeFilters`). A Series→Search tag/meta intent
 * (see search-intent.ts) is consumed on mount and applied against the intent's bridge.
 */
/** EXPERIMENTAL series page embedding (see SearchLayer in app/series page/index.tsx): the
 *  same screen mounted as an in-screen LAYER instead of a pushed route — `onBack` replaces the
 *  router pop (the layer slides itself out). Remove with the experiment (the route path passes
 *  nothing). */
export type SearchEmbedded = {
  onBack: () => void;
  /** The layer's back-swipe pan composed with a `Gesture.Native()` (`Gesture.Simultaneous`), to
   *  mount on the results scroller: on iOS the scroll view's own recognizer force-fails a foreign
   *  pan before its activation distance, so the pan must ride the scroller's own detector — see
   *  the series page's makeBackSwipePan. */
  scrollGesture?: ComposedGesture;
  /** Whether this embedded copy is the TOP layer. Layers are sibling views on ONE route, so
   *  react-navigation reports every one of them focused — the host has to say which is live.
   *  See the intent subscription below, which is what this exists for. */
  isTop?: boolean;
  /** False while this layer's back-swipe owns the touch — the results list stops scrolling under
   *  a page that is being dragged away. See RecyclerList's `scrollEnabled`. */
  scrollEnabled?: boolean;
};

export default function SearchScreen({ embedded }: { embedded?: SearchEmbedded } = {}) {
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
  const [initialIntent] = useState(() => peekSearchIntent());
  // Consume it AFTER mount: a consuming read in the initializer loses the intent under
  // StrictMode's double invocation (see peekSearchIntent).
  useEffect(() => {
    clearSearchIntent(initialIntent);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialIntent is mount-stable
  }, []);

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
  } = useInheritedBridge();

  // Cross-bridge mode: when the synthetic "Comical" bridge is selected, search fans out over every
  // real bridge and shows one rail of results per bridge (no filters/sort — Comical has no capabilities,
  // so useBridgeFilters below yields empty defs and the filter bar auto-hides).
  const isComical = isComicalBridge(bridgeId);
  const realBridges = useMemo(() => visibleBridges.filter((b) => b.id !== COMICAL_BRIDGE_ID), [visibleBridges]);

  // Point Search at the intent's bridge (may differ from the one inherited from Browse) on mount.
  // `setBridge` moves THIS screen's selection only — see useInheritedBridge for what writing the
  // shared one did to the Browse tab (and to a series page's collapse) underneath.
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
  //
  // Each pending intent CARRIES ITS TARGET BRIDGE, and the resolve effects below wait for the
  // resolved `bridgeId` to actually BE that bridge. Without the guard, the mount-pass effects run
  // with the pre-`setBridge` selection still resolved — and when that's a bridge whose filters are
  // already "settled", the intent is consumed against the WRONG bridge's defs and lost. The
  // deterministic case: first tag tap after a relaunch, when the in-memory selection is still null
  // and resolves to the capability-less Comical aggregate, whose empty filter defs settle
  // instantly — the search mounted blank.
  const [pendingTag, setPendingTag] = useState<(TagIntent & { bridgeId: string }) | null>(
    initialIntent?.kind === 'tag'
      ? {
          bridgeId: initialIntent.bridgeId,
          filterKey: initialIntent.filterKey,
          tagId: initialIntent.tagId,
          label: initialIntent.label,
        }
      : null,
  );
  const [pendingMeta, setPendingMeta] = useState<(MetaIntent & { bridgeId: string }) | null>(
    initialIntent?.kind === 'meta'
      ? { bridgeId: initialIntent.bridgeId, metaKey: initialIntent.metaKey, value: initialIntent.value }
      : null,
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
  // Focus alone is not enough INSIDE the series page, and that is a real bug this fixes rather than
  // a hypothetical: the page's layers (search, drilled series, another search…) are sibling views on
  // ONE route, so react-navigation calls every one of them focused. Browse → series → search →
  // series → tag chip therefore had the BURIED search — still mounted two layers down — answer the
  // subscription and quietly re-search itself, while the search layer the chip opened mounted on an
  // empty intent and showed nothing. `isTop` is the host telling us which layer is actually live.
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
  // Mirrored into a ref rather than read from the closure: the subscription is set up once (its
  // deps are all stable setters), so a captured `embedded` would freeze at whatever was true when
  // this screen mounted — which is exactly "I am on top", the wrong answer forever after.
  const topRef = useRef(true);
  useEffect(() => {
    topRef.current = embedded ? !!embedded.isTop : true;
  });
  useEffect(
    () =>
      subscribeSearchIntent(() => {
        if (!focusedRef.current || !topRef.current) return;
        const intent = takeSearchIntent();
        if (!intent) return;
        setBridge(intent.bridgeId);
        setFilterValues({});
        setSortValue(null);
        setQuery(intent.kind === 'query' ? intent.query : '');
        setPendingTag(
          intent.kind === 'tag'
            ? { bridgeId: intent.bridgeId, filterKey: intent.filterKey, tagId: intent.tagId, label: intent.label }
            : null,
        );
        setPendingMeta(
          intent.kind === 'meta' ? { bridgeId: intent.bridgeId, metaKey: intent.metaKey, value: intent.value } : null,
        );
      }),
    [setBridge, setFilterValues, setSortValue],
  );

  useEffect(() => {
    // The bridge match is what makes the mount-time race safe — see the pending state above.
    if (!pendingTag || bridgeId !== pendingTag.bridgeId || !filtersSettled) return;
    const res = resolveTagIntent(filterDefs, pendingTag);
    if (res) {
      // Seed the id→label hint so the trigger/editor show the tag's name (a live-search filter has no
      // static options to look it up in), and select it.
      setLabelHints((prev) => ({ ...prev, [res.defId]: { ...(prev[res.defId] ?? {}), ...res.labelHint } }));
      setFilterValues((prev) => ({ ...prev, [res.defId]: res.value }));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- draining a one-shot navigation intent: it can only be applied once the bridge's filters have settled, so the wait is the whole mechanism, and clearing it is what stops a re-apply.
    setPendingTag(null);
  }, [pendingTag, filterDefs, filtersSettled, bridgeId, setLabelHints, setFilterValues]);

  useEffect(() => {
    if (!pendingMeta || bridgeId !== pendingMeta.bridgeId || !filtersSettled) return;
    // Prefer the bridge's own field for that meta key, else fall back to a free-text search.
    const res = resolveMetaIntent(filterDefs, pendingMeta);
    if (res.kind === 'filter') setFilterValues((prev) => ({ ...prev, [res.defId]: res.value }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- draining a one-shot navigation intent: it can only be applied once the bridge's filters have settled, so the wait is the whole mechanism.
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
  // The filter bar sits just below the (fixed) search bar and closes as the results scroll down,
  // back open as they scroll up — the offset is the bar's own slide, which `filterBar` turns into a
  // wipe over chips that hold still. Same shared helper the Browse bar uses (so the motion can't
  // drift); a new search (`scopeKey` change) snaps it back open and the list to the top.
  const {
    scrollY,
    offset: filtersOffsetY,
    barStyle: filtersStyle,
    contentStyle: filtersFadeStyle,
    sharedValues,
    scrollRef,
    onScroll: onListScroll,
  } = useSlidingBar(filtersBarH, {
    resetKey: scopeKey,
    listRef,
    // The two opt-ins, and this is the only bar that takes them. It is one you MANIPULATE — the
    // chips are the point, and pulling it half open only to have it shut again reads as the drag
    // being ignored — and it moves alone, so it is free to answer a release differently from the
    // top/tab bar pair that hide together. See `settleTarget` and `settleScrollDelta`.
    settle: 'nearest',
    lockstepScroll: true,
  });
  // The top bar YIELDS ITS RULE while any of the filter bar is showing. Both bars are the same flat
  // colour and the filter bar sits flush beneath, carrying the edge for the pair — the same trade
  // StickySectionHeader makes with the Browse bar, and BarSurface's `borderBottomColor` is
  // overridable from an animated style for exactly this.
  //
  // It used to stay on, on the grounds that the seam was real: two bars, one sliding up BEHIND the
  // other, and a divider is what says so. The shutter ended that. Nothing slides behind anything
  // now — the filter bar closes in place — so the only edge there is is the one it closes to, and a
  // second line above it was drawing a join that no longer happens.
  //
  // The handoff at the end is invisible rather than merely quick: the filter bar's own hairline is
  // its bottom border, so as it finishes closing that line arrives at exactly `topBarTotal` and
  // disappears behind the top bar on the same pixel the top bar's own line appears. No cross-fade
  // needed, and none would help — a partly-faded rule above a fully-drawn one is two lines, not one.
  //
  // `t` is 1 when there is no filter bar at all, which is the same "nothing is covering the seam"
  // state as fully closed. A 0 there would have left the rule permanently transparent on a bridge
  // with no filters.
  // The dep array carries `filtersBarH` as well as the colour, and has to: it is 0 on the first
  // renders (the bridge's filter defs have not arrived yet) and only then becomes the bar's height,
  // and an explicit dep array REPLACES the ones Reanimated's plugin would otherwise infer from the
  // worklet's own closure. Without it the worklet keeps the captured 0, `t` is pinned at 1 by the
  // guard above, and the rule never yields at all — which is exactly what it did.
  const topBarRuleStyle = useAnimatedStyle(() => {
    const t = filtersBarH > 0 ? Math.min(1, Math.max(0, -filtersOffsetY.value / filtersBarH)) : 1;
    return { borderBottomColor: t >= 1 ? theme.barHairline : 'transparent' };
  }, [theme.barHairline, filtersBarH]);

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
    if (embedded) embedded.onBack();
    else router.back();
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

  // The chips' counter-translate. Exactly cancels the shutter's own transform, so the filters hold
  // still in WINDOW coordinates while the bar closes over them — see `filterBar`. Their FADE is the
  // hook's own `contentStyle`, the same one Browse's bar fades its selectors with: a chip cut in
  // half by the closing edge is a hard edge through a word, and fading it out over the same travel
  // turns that into the chips receding as the bar takes their room back.
  const filtersHoldStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -filtersOffsetY.value }] }));

  const filterBar = hasFilterBar ? (
    // THE SHUTTER. The bar is the thing that moves; the filters inside it do not.
    //
    // It used to be the other way round — a fixed window with the bar sliding up inside it — and the
    // chips travelled with it, so hiding the filters carried them off the top of the screen. Now the
    // BAR's own box slides up behind the top bar and its `overflow: hidden` takes the chips with it
    // from the BOTTOM edge: the filters stay exactly where they are and the bar closes over them,
    // wiped away under its own bottom hairline. Same `filtersStyle`, same distance, same settle —
    // only what the motion is applied to changed.
    //
    // Three things fall out of moving the box rather than its contents, and all three are why it is
    // built this way rather than by animating the window's HEIGHT:
    //  · The hairline rides the closing edge for free. It is BarSurface's own bottom border, so it
    //    is always exactly where the bar currently ends. An animated-height window would have left
    //    its border clipped off and the chips cut at nothing.
    //  · Fully closed, the box has slid a full `filtersBarH` up, which puts that hairline at the top
    //    bar's own bottom edge — BEHIND it (zIndex 20 vs 10), so it can't double up with it.
    //  · It stays a transform. Height is a layout property: animating it would run Yoga over the
    //    chip row every frame, and this animation plays while a grid is being scrolled.
    //
    // The overshoot above `topBarTotal` never shows — the top bar is opaque and sits over it. The
    // chips are hit-tested against this box too, so the wiped-away half stops taking taps.
    <BarSurface
      safeAreaTop={false}
      style={[styles.filtersClip, { top: topBarTotal, height: filtersBarH }, filtersStyle]}>
      <Animated.View style={[styles.filtersRow, { height: filtersBarH }, filtersHoldStyle, filtersFadeStyle]}>
        <View style={styles.filtersInner}>
          <FilterBar defs={orderedDefs} values={resolvedValues} onValueChange={setFilterValue} />
        </View>
      </Animated.View>
    </BarSurface>
  ) : null;

  return (
    // Touch-driven pull-to-refresh for web + Android is caught here on the outer view, so it works
    // regardless of what's under the finger (iOS sources its pull from the native bounce instead).
    <ThemedView style={styles.container} {...pull.touchHandlers}>
      {/* Overlaid top bar: back button + search field (autofocused after the push settles) + sort.
          Opaque, like every other bar (BarSurface): the results scroll behind it. */}
      <BarSurface style={[styles.topBar, topBarRuleStyle]}>
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
                scrollRef={scrollRef}
                onScroll={onListScroll}
                onScrollEndDrag={pull.onScrollEndDrag}
                wrapperStyle={pull.listStyle}
                scrollGesture={embedded?.scrollGesture}
                scrollEnabled={embedded?.scrollEnabled}
              />
            ) : (
              <SeriesGrid
                items={gridItems}
                scopeKey={scopeKey}
                listRef={listRef}
                header={emptyBody}
                // The top bar OVERLAYS the list (results scroll behind it), so reserve it as well
                // as the filter bar beneath it, plus a little breathing room.
                paddingTop={topBarTotal + filtersBarH + BarContentGap}
                paddingBottom={insets.bottom + Spacing.five}
                bridge={currentBridge?.name ?? undefined}
                bridgeId={bridgeId}
                direct={directBridge}
                sharedValues={sharedValues}
                scrollRef={scrollRef}
                onScroll={onListScroll}
                onEndReached={loadMore}
                onScrollEndDrag={pull.onScrollEndDrag}
                // The pull-to-refresh content shift and the re-search dim both ride the list wrapper.
                wrapperStyle={[pull.listStyle, listDimStyle]}
                scrollGesture={embedded?.scrollGesture}
                scrollEnabled={embedded?.scrollEnabled}
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
  // OVERLAYS the list, so the results scroll behind it (the same shape as the Browse bar). The grid
  // reserves `topBarTotal` at the top of its content to compensate.
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
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
  // The bar itself, and the mask. It sits in the gap below the top bar and slides up from there;
  // `overflow: hidden` is what makes that slide a wipe rather than a move, cutting the (held still)
  // chips off at whatever height the bar currently has. See `filterBar`.
  filtersClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  // Absolute rather than in flow, so the row keeps its full height no matter how far the bar above
  // has closed — it is being clipped, not squeezed.
  filtersRow: {
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
