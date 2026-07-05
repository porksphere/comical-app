import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BridgeThumb } from '@/components/bridge-thumb';
import { FilterBar, type SortOption, type SortState } from '@/components/filters/filter-demo';
import { filterDefFromApi, filterValueToApi, initialValue, type FilterDef, type FilterValue, type TriState } from '@/components/filters/filter-types';
import { Rail, RailSkeleton, SectionHead } from '@/components/rail';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { BridgeThumbSize, Selector } from '@/components/selector';
import { SeriesCard } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { isAbort, pageOptions } from '@/data/api';
import { takeBrowseIntent } from '@/data/browse-intent';
import { useDataSource, useHideNsfw, type QueryOpts } from '@/data/source';
import type { Bridge, BridgeList, HomeGridSection, RailSection, SeriesEntry } from '@/data/types';
import { useIsCompact, useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

// Scroll distance over which the top bar's bottom divider fades in: absent at the
// very top (once collapsed, on narrow viewports), present once content scrolls
// under it (mirrors the reference's `.stuck` divider).
const DIVIDER_SCROLL = Spacing.three;
// The reference's mobile grid uses a tighter inter-card gap than its row gap
// (`.grid { gap: 1rem 0.6rem }`, i.e. ~9.6px columns vs 16px rows) — Spacing.two
// (8px) is the closest token to that column gap. Shared so the main grid and
// HomeGridBlock's non-terminal sections can't drift apart from each other.
const GRID_COLUMN_GAP = Spacing.two;
/** Debounce before a filter/sort change actually triggers a re-fetch — avoids
 *  spamming the bridge's backend on every tap, mirroring the reference's
 *  `doSearchIfChanged` snapshot-diff-on-close contract (app.ts:4765). */
const FILTER_DEBOUNCE_MS = 500;

// Narrow-mobile only: at the very top the bar gets this much extra height (split
// above/below the centred selector row as breathing room) and the bridge
// thumbnail grows by THUMB_GROWTH. Both ease back to the resting dimensions over
// the first EXPAND_EXTRA px of scroll, so once scrolled the bar matches every
// other viewport. The expansion is purely cosmetic — `EXPAND_EXTRA` is also the
// scroll distance the collapse spans, which keeps the content edge pinned to the
// bar's bottom throughout (see the paddingTop note on the list).
const EXPAND_EXTRA = Spacing.four;
const THUMB_GROWTH = 12;

type GridItem = SeriesEntry & { spacer?: boolean };
/** A drilled-into rail: its list id (for pagination) + display title. */
type SeeAll = { listId: string; title: string } | null;

/** Candidate filter-field ids (lowercased) a bridge might use for each meta key
 *  tapped on the Series screen — matched against `FilterDef.id` so e.g. an
 *  Author tap lands on that bridge's own author filter when it has one. */
const META_FILTER_ALIASES: Record<'author' | 'artist' | 'type', string[]> = {
  author: ['author', 'authors'],
  artist: ['artist', 'artists'],
  type: ['type', 'format', 'category'],
};

export default function BrowseScreen() {
  const ds = useDataSource();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const listRef = useRef<FlatList>(null);
  useScrollToTopOnReselect('browse', listRef);

  // ── Bridges ────────────────────────────────────────────────────────────
  const hideNsfw = useHideNsfw();
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [bridgesError, setBridgesError] = useState<string | null>(null);
  const [bridgesReload, setBridgesReload] = useState(0);
  const [bridge, setBridge] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setBridgesError(null);
    ds.getBridges(ctrl.signal)
      .then(setBridges)
      .catch((e) => {
        if (!isAbort(e)) setBridgesError(e.message || 'Failed to load bridges');
      });
    return () => ctrl.abort();
  }, [ds, bridgesReload]);

  const visibleBridges = useMemo(
    () => (hideNsfw ? bridges.filter((b) => !b.nsfw) : bridges),
    [bridges, hideNsfw],
  );
  // Falls back to the first visible bridge whenever the sticky `bridge` selection
  // isn't among the currently-visible ones (initial load, or hidden by Hide
  // NSFW) — derived at render instead of synced via an effect, so toggling Hide
  // NSFW back off restores the original selection with no extra state.
  const currentBridge = visibleBridges.find((b) => b.name === bridge) ?? visibleBridges[0];
  const bridgeId = currentBridge?.id;
  const bridgeThumbnails = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of visibleBridges) if (b.thumbnail) map[b.name] = b.thumbnail;
    return map;
  }, [visibleBridges]);
  const directBridge = currentBridge?.capabilities.includes('direct') ?? false;

  // ── Lists (drives the Page selector) ──────────────────────────────────────
  const [lists, setLists] = useState<BridgeList[]>([]);
  const [page, setPage] = useState('home');

  useEffect(() => {
    if (!bridgeId) return;
    const ctrl = new AbortController();
    ds.getBridgeLists(bridgeId, ctrl.signal)
      .then((ls) => {
        setLists(ls);
        setPage('home');
      })
      .catch((e) => {
        if (!isAbort(e)) setLists([]);
      });
    return () => ctrl.abort();
  }, [bridgeId, ds]);

  const pages = useMemo(
    () => (currentBridge ? pageOptions(lists, currentBridge.capabilities) : ['home']),
    [lists, currentBridge],
  );
  // The list backing a non-home page selection (a `page: true` list, e.g. "Popular").
  const selectedList = useMemo(
    () => lists.find((l) => l.page && l.name.toLowerCase() === page),
    [lists, page],
  );
  const isFavoritesPage = page === 'favorites';

  // ── Filters + sort (fetched once per bridge; capability-gated) ────────────
  const [filterDefs, setFilterDefs] = useState<FilterDef[]>([]);
  const [sortOptions, setSortOptions] = useState<SortOption[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});
  const [sortValue, setSortValue] = useState<SortState>(null);
  // Which bridge the current `filterDefs` belong to — a bridge switch reloads them
  // async and resets `filterValues`, so a pending tag selection (see below) must
  // wait until this matches its bridge before applying, or it'd land on the wrong
  // (soon-to-be-reset) defs.
  const [filterDefsBridgeId, setFilterDefsBridgeId] = useState<string | null>(null);
  // Stable reference so `FilterBar`'s per-filter `React.memo` isn't defeated by
  // a freshly-allocated closure on every render (see `FilterButton`).
  const setFilterValue = useCallback((id: string, v: FilterValue) => {
    setFilterValues((prev) => ({ ...prev, [id]: v }));
  }, []);

  useEffect(() => {
    if (!bridgeId || !currentBridge) {
      setFilterDefs([]);
      setSortOptions([]);
      setFilterValues({});
      setSortValue(null);
      setFilterDefsBridgeId(null);
      return;
    }
    const ctrl = new AbortController();
    const hasTags = (query: string) => ds.getTags(bridgeId, query, ctrl.signal);
    if (currentBridge.capabilities.includes('filters')) {
      ds.getFilters(bridgeId, ctrl.signal)
        .then((apiDefs) => {
          const defs = apiDefs.map((f) => {
            const def = filterDefFromApi(f);
            // Live tag search for a bridge-backed tag-multiselect (no static option list).
            return def.type === 'tags' && !def.options ? { ...def, search: hasTags } : def;
          });
          setFilterDefs(defs);
          setFilterValues(Object.fromEntries(defs.map((d) => [d.id, initialValue(d)])));
          setFilterDefsBridgeId(bridgeId);
        })
        .catch(() => {
          setFilterDefs([]);
          setFilterDefsBridgeId(bridgeId);
        });
    } else {
      setFilterDefs([]);
      setFilterValues({});
      setFilterDefsBridgeId(bridgeId);
    }
    if (currentBridge.capabilities.includes('sort')) {
      ds.getSortOptions(bridgeId, ctrl.signal)
        .then((opts) => {
          setSortOptions(opts);
          setSortValue(null);
        })
        .catch(() => setSortOptions([]));
    } else {
      setSortOptions([]);
      setSortValue(null);
    }
    return () => ctrl.abort();
  }, [bridgeId, currentBridge, ds]);

  // Debounced "committed" snapshot — the actual fetch effect depends on this,
  // not on `filterValues`/`sortValue` directly, so rapid taps don't each fire a
  // request. Reference contract: `doSearchIfChanged`, app.ts:4765.
  const [committedFilters, setCommittedFilters] = useState<QueryOpts['filters']>(undefined);
  const [committedSort, setCommittedSort] = useState<QueryOpts['sort']>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = filterDefs
        .map((d) => filterValueToApi(d, filterValues[d.id]))
        .filter((v): v is { key: string; value: unknown } => v !== null);
      setCommittedFilters(next.length ? (next as QueryOpts['filters']) : undefined);
      setCommittedSort(sortValue ? { key: sortValue.key, ascending: sortValue.ascending } : undefined);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filterDefs, filterValues, sortValue]);
  const hasActiveQuery = !!committedFilters || !!committedSort;

  // ── Home rails + grid sections (only fetched while `page === 'home'`) ─────
  const [sections, setSections] = useState<RailSection[]>([]);
  const [gridSections, setGridSections] = useState<HomeGridSection[]>([]);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeReload, setHomeReload] = useState(0);
  const [homeLoading, setHomeLoading] = useState(false);

  useEffect(() => {
    if (!bridgeId || page !== 'home') return;
    const ctrl = new AbortController();
    setHomeError(null);
    // Clear the previous bridge/visit's rails before fetching, so a switch shows
    // a loading skeleton instead of a stale flash of the old selection's content.
    setHomeLoading(true);
    setSections([]);
    setGridSections([]);
    ds.getHomeSections(bridgeId, ctrl.signal)
      .then((res) => {
        setSections(res.sections);
        setGridSections(res.gridSections);
      })
      .catch((e) => {
        if (!isAbort(e)) setHomeError(e.message || 'Failed to load home');
      })
      .finally(() => setHomeLoading(false));
    return () => ctrl.abort();
  }, [bridgeId, page, ds, homeReload]);
  // Only the LAST grid section infinite-scrolls; earlier ones get "Load more" —
  // see HomeGridSection's doc in types.ts.
  const terminalGridSection = gridSections.at(-1) ?? null;
  const nonTerminalGridSections = gridSections.length > 1 ? gridSections.slice(0, -1) : [];

  // Committed search query (set on submit) and the active "See all" rail, if any.
  const [query, setQuery] = useState('');
  const [seeAll, setSeeAll] = useState<SeeAll>(null);

  // ── Tag-chip / meta-cell search intent (from the Series screen) ───────────
  // A `tagIds` chip resolves to a tag-multiselect filter, which can only be set
  // once this bridge's defs have loaded — stash it here and apply it in the
  // effect below (a `tagQueries` chip is handled inline as a plain query).
  const [pendingTag, setPendingTag] = useState<{
    filterKey: string;
    tagId: string;
    label: string;
  } | null>(null);
  // Same idea for a tapped Author/Artist/Type meta cell: resolved once this
  // bridge's filter defs have loaded, against whichever field it maps to.
  const [pendingMeta, setPendingMeta] = useState<{
    metaKey: 'author' | 'artist' | 'type';
    value: string;
  } | null>(null);
  // Consume the Series screen's intent when Browse gains focus (i.e. after we've
  // navigated to it), not on a background re-render while Series is still on top —
  // so it lands on the instance that's actually shown. Switch to the originating
  // bridge, leave any "See all" / sub-page scope, then either set the query
  // (tagQueries path), stash the tag to apply once this bridge's filter defs
  // load (tagIds path), or stash the meta value to resolve against a filter
  // field the same way (meta path). Mirrors comical-web's navigateToQuerySearch /
  // navigateToFilteredSearch (app.ts).
  useFocusEffect(
    useCallback(() => {
      const intent = takeBrowseIntent();
      if (!intent) return;
      setSeeAll(null);
      setPage('home');
      setBridge(intent.bridgeName);
      if (intent.kind === 'query') {
        setPendingTag(null);
        setPendingMeta(null);
        setQuery(intent.query);
      } else if (intent.kind === 'tag') {
        setQuery('');
        setPendingMeta(null);
        setPendingTag({ filterKey: intent.filterKey, tagId: intent.tagId, label: intent.label });
      } else {
        setQuery('');
        setPendingTag(null);
        setPendingMeta({ metaKey: intent.metaKey, value: intent.value });
      }
    }, []),
  );

  useEffect(() => {
    if (!pendingTag) return;
    // Apply once the CURRENT bridge's filter defs have loaded. The focus effect
    // switched us to the intent's bridge; `filterDefsBridgeId === bridgeId` means
    // those filters are now loaded, so the tag filter def (if any) is the right
    // bridge's. Comparing Browse's own two ids (not the series route param) avoids
    // any mismatch between how the two screens name the bridge.
    if (!bridgeId || filterDefsBridgeId !== bridgeId) return;
    const def = filterDefs.find((d) => d.id === pendingTag.filterKey && d.type === 'tags');
    if (!def) {
      // This bridge doesn't expose that tag filter — nothing to apply.
      setPendingTag(null);
      return;
    }
    // Seed the id→label hint so the trigger/editor show the tag's name, not its
    // raw id (a live-search filter has no static options to look it up in).
    setFilterDefs((prev) =>
      prev.map((d) =>
        d.id === def.id && d.type === 'tags'
          ? { ...d, labelHints: { ...(d.labelHints ?? {}), [pendingTag.tagId]: pendingTag.label } }
          : d,
      ),
    );
    setFilterValues((prev) => ({ ...prev, [def.id]: { [pendingTag.tagId]: 'include' } as TriState }));
    setPendingTag(null);
  }, [pendingTag, filterDefs, filterDefsBridgeId, bridgeId]);

  useEffect(() => {
    if (!pendingMeta) return;
    if (!bridgeId || filterDefsBridgeId !== bridgeId) return;
    // Look for a filter field this bridge exposes for the tapped meta key (a
    // handful of common key spellings) — if found, set the value there instead
    // of just running a raw text search, so e.g. tapping an Author lands on
    // that bridge's actual author filter rather than a fuzzy full-text match.
    const aliases = META_FILTER_ALIASES[pendingMeta.metaKey];
    const def = filterDefs.find((d) => aliases.includes(d.id.toLowerCase()));
    if (def) {
      if (def.type === 'string') {
        setFilterValues((prev) => ({ ...prev, [def.id]: pendingMeta.value }));
        setPendingMeta(null);
        return;
      }
      if (def.type === 'multi' || def.type === 'includeExclude' || def.type === 'tags') {
        const match = def.options?.find((o) => o.label.toLowerCase() === pendingMeta.value.toLowerCase());
        if (match) {
          setFilterValues((prev) => ({
            ...prev,
            [def.id]: def.type === 'multi' ? [match.value] : ({ [match.value]: 'include' } as TriState),
          }));
          setPendingMeta(null);
          return;
        }
      }
    }
    // No matching filter field (or no matching option within it) — fall back to
    // a plain free-text search, same as a `query` intent.
    setQuery(pendingMeta.value);
    setPendingMeta(null);
  }, [pendingMeta, filterDefs, filterDefsBridgeId, bridgeId]);

  // A search, a rail's "See all", a live filter/sort choice, or picking a
  // page-flagged sub-list (e.g. "Popular"/"Favorites") all drop to the flat
  // results grid — matches the reference's `doSearch`: any of
  // query/filters/sort/list-scope leaves the home surface.
  const inResults = !!query || !!seeAll || hasActiveQuery || page !== 'home';
  // The "← Home" banner is for transient drill-downs (search / "See all" / a
  // live filter or sort) — NOT for plain page-selector navigation. Selecting a
  // page-flagged list like "Popular" is a top-level page in its own right (the
  // Page selector itself already shows it's active and is how you switch back
  // to Home), so it shouldn't get the same back-arrow treatment a drill-down
  // does. A drill-down layered on top of a selected page (e.g. searching while
  // on "Popular") still shows the banner, same as it would from Home.
  const showBackBanner = !!query || !!seeAll || hasActiveQuery;
  const resultsLabel = seeAll ? seeAll.title : query ? `Results for “${query}”` : page;

  // ── Grid (unified: a flagged page, favorites, search, or "See all") ───────
  // Home's own grid sections (terminal + non-terminal) are fetched separately
  // above; this is everything else, sharing one fetch/pagination pipeline.
  // "See all" keeps its existing simple behavior (browse that list's items,
  // page-only, no filters/sort/scoped-search) — those apply to the page-flagged
  // list / global search case below instead.
  const activeListId = seeAll ? seeAll.listId : page !== 'home' ? (selectedList?.id ?? null) : null;
  // Scoped-list search: route through the list endpoint's `q` param when the
  // active list is `searchable`, instead of always calling `/search` — mirrors
  // `runSearch`'s branch at app.ts:4857.
  const scopedSearch = !seeAll && page !== 'home' && !!selectedList?.searchable && !!activeListId;
  const showResultsGrid = inResults;
  // Home's terminal grid section (the last one in `gridSections`) shares the
  // SAME scrollable FlatList + infinite scroll as results mode, not the
  // "Load more" blocks non-terminal sections get — so it feeds `gridItems` too.
  const isHomeTerminal = !inResults && page === 'home' && !!terminalGridSection;

  const [gridItems, setGridItems] = useState<SeriesEntry[]>([]);
  const [gridPageNum, setGridPageNum] = useState(1);
  const [gridHasMore, setGridHasMore] = useState(false);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [gridReload, setGridReload] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchGrid = (pageNum: number) => {
    if (!bridgeId) return Promise.reject(new Error('no bridge'));
    if (isHomeTerminal) return ds.getGridPage(bridgeId, terminalGridSection!.id, pageNum);
    if (isFavoritesPage) return ds.getFavorites(bridgeId, pageNum);
    if (seeAll) return ds.getGridPage(bridgeId, seeAll.listId, pageNum);
    const opts: QueryOpts = { filters: committedFilters, sort: committedSort };
    // A page-flagged list browsed with no query (optionally filtered/sorted), or
    // scoped-search on that same list when it's `searchable` and a query is set.
    if (activeListId && (scopedSearch || !query)) {
      return ds.getGridPage(bridgeId, activeListId, pageNum, scopedSearch && query ? { ...opts, query } : opts);
    }
    // Global search: an unscoped query, or filters/sort with no specific list (home).
    return ds.search(bridgeId, query, pageNum, opts);
  };

  useEffect(() => {
    // `getHomeSections` already fetched the terminal section's first page —
    // just adopt it, no extra request needed.
    if (isHomeTerminal) {
      setGridItems(terminalGridSection!.items);
      setGridHasMore(terminalGridSection!.hasNextPage);
      setGridPageNum(1);
      setGridError(null);
      return;
    }
    if (!bridgeId || !showResultsGrid) {
      setGridItems([]);
      setGridHasMore(false);
      return;
    }
    const ctrl = new AbortController();
    setGridLoading(true);
    setGridError(null);
    setGridPageNum(1);
    // Clear the previous list's items before fetching — otherwise they stay on
    // screen (with no skeleton, since `gridItems.length` is non-zero) until the
    // new page swaps in, instead of showing a loading skeleton on the switch.
    setGridItems([]);
    fetchGrid(1)
      .then((res) => {
        setGridItems(res.items);
        setGridHasMore(res.hasNextPage);
      })
      .catch((e) => {
        if (!isAbort(e)) setGridError(e.message || 'Failed to load results');
      })
      .finally(() => setGridLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeId, isHomeTerminal, terminalGridSection, showResultsGrid, isFavoritesPage, activeListId, query, seeAll, scopedSearch, committedFilters, committedSort, ds, gridReload]);

  const loadMore = () => {
    if (loadingMore || !gridHasMore || !bridgeId || (!isHomeTerminal && !showResultsGrid)) return;
    setLoadingMore(true);
    const nextPage = gridPageNum + 1;
    fetchGrid(nextPage)
      .then((res) => {
        setGridItems((prev) => [...prev, ...res.items]);
        setGridHasMore(res.hasNextPage);
        setGridPageNum(nextPage);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const backToHome = () => {
    setQuery('');
    setSeeAll(null);
    setPage('home');
  };

  // Switching bridge or page is top-level navigation, so it drops any active
  // search / "See all" drill-down and lands on that page's full rails+grid.
  const selectBridge = (b: string) => {
    setQuery('');
    setSeeAll(null);
    setBridge(b);
  };
  const selectPage = (p: string) => {
    setQuery('');
    setSeeAll(null);
    setPage(p);
  };

  // See plan: hold the server's column count until mount to avoid a hydration
  // mismatch on the static web export (no viewport → width 0 → 3 columns).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // Shared with the series-detail bar so both stay the same height.
  const barHeight = useTopBarHeight();
  // Match the bridge dropdown's thumbnail size so the bar reads at the same scale.
  const thumbSize = BridgeThumbSize;
  // Only narrow (mobile) viewports get the scroll-driven expand/collapse; on wider
  // screens the bar is static and these expansions are zeroed out below.
  const compact = useIsCompact();
  const numColumns =
    !hydrated || width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));
  // Single hydration-safe viewport width for the rails: a deterministic mobile
  // fallback during prerender/first paint, the real width once mounted.
  const railViewport = hydrated ? width : 390;

  const gridData = useMemo<GridItem[]>(() => {
    const remainder = gridItems.length % numColumns;
    if (remainder === 0) return gridItems;
    const spacers: GridItem[] = Array.from({ length: numColumns - remainder }, (_, i) => ({
      id: `spacer-${i}`,
      title: '',
      cover: '',
      spacer: true,
    }));
    return [...gridItems, ...spacers];
  }, [gridItems, numColumns]);

  // Top bar: the bridge/page selectors sit in a band (barHeight below the
  // safe-area inset) overlaid on the scrolling list. On narrow viewports the band
  // is taller at the very top and eases down to barHeight over the first
  // EXPAND_EXTRA px of scroll; on wider viewports `expand` is 0 so it stays
  // static. The collapse and the bottom divider are driven on the UI thread so
  // the bar tracks the scroll without per-frame re-renders.
  const expand = compact ? EXPAND_EXTRA : 0;
  const thumbGrowth = compact ? THUMB_GROWTH : 0;
  // Resting (collapsed) header height; the list pads to headerHeight + expand so
  // the first row clears the bar at its tallest.
  const headerHeight = insets.top + barHeight;
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const hairline = theme.hairline;
  // 0 at the top → 1 once the bar has fully collapsed (and stays 1 thereafter).
  // When `expand` is 0 (wide viewports) it is always 1, i.e. fully collapsed.
  const collapseProgress = (y: number) => {
    'worklet';
    return expand > 0 ? Math.min(Math.max(y / expand, 0), 1) : 1;
  };
  const headerStyle = useAnimatedStyle(() => ({
    height: headerHeight + (1 - collapseProgress(scrollY.value)) * expand,
    // The divider belongs to the resting bar, so it only begins to appear once the
    // expansion has collapsed away.
    borderBottomColor: interpolateColor(
      scrollY.value,
      [expand, expand + DIVIDER_SCROLL],
      ['rgba(0,0,0,0)', hairline],
    ),
  }));
  const selectorRowStyle = useAnimatedStyle(() => ({
    height: barHeight + (1 - collapseProgress(scrollY.value)) * expand,
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const size = thumbSize + (1 - collapseProgress(scrollY.value)) * thumbGrowth;
    return { width: size, height: size };
  });

  const topBar = (
    <Animated.View
      style={[
        styles.topBar,
        { paddingTop: insets.top, backgroundColor: theme.background, pointerEvents: 'box-none' },
        headerStyle,
      ]}>
      {/* Inner row capped to the content width so the selectors line up with the
          grid below, while the bar background stays full-bleed. The row grows with
          the band (content stays vertically centred) for symmetric breathing room. */}
      <Animated.View style={[styles.selectorRow, selectorRowStyle, { pointerEvents: 'box-none' }]}>
        {currentBridge ? (
          // Animate the wrapping View (a plain host component) rather than the
          // thumbnail itself — expo-image's `Image` is a composite class
          // component, and wrapping it directly with `Animated.createAnimatedComponent`
          // is fragile on native (crashed on launch; fine on web, where
          // expo-image swaps to a ref-forwarding `<img>` container, masking
          // the issue in dev). Gated on `currentBridge` (not `.thumbnail`) so
          // a thumbnail-less bridge still gets its letter-fallback slot here,
          // same as in the dropdown — just not while bridges are still loading.
          <Animated.View style={[styles.bridgeThumb, thumbStyle]}>
            <BridgeThumb uri={currentBridge.thumbnail} label={currentBridge.name} size={thumbSize} fill />
          </Animated.View>
        ) : null}
        <Selector
          title="Bridge"
          value={currentBridge?.name ?? ''}
          options={visibleBridges.map((b) => b.name)}
          onChange={selectBridge}
          size="subtitle"
          thumbnails={bridgeThumbnails}
        />
        <Selector title="Page" value={page} options={pages} onChange={selectPage} size="subtitle" />
      </Animated.View>
    </Animated.View>
  );

  const controls = (
    <View style={styles.controls}>
      <SearchField
        value={query}
        onSubmit={(q) => {
          setSeeAll(null);
          setQuery(q.trim());
        }}
        onClear={() => setQuery('')}
      />
      <FilterBar
        defs={filterDefs}
        values={filterValues}
        onValueChange={setFilterValue}
        sortOptions={sortOptions}
        sort={sortValue}
        onSortChange={setSortValue}
        searchActive={inResults}
      />
      {showBackBanner && (
        <View style={styles.resultsHead}>
          <Pressable onPress={backToHome} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              ← Home
            </ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.resultsLabel}>
            {resultsLabel}
          </ThemedText>
        </View>
      )}
    </View>
  );

  // The list header holds the controls, and — on home — the rails, any
  // non-terminal grid sections (their own "Load more"), and the terminal
  // section's heading. The main grid (results, favorites, or home's terminal
  // section) then renders beneath it, so everything scrolls as one surface.
  const listHeader = (
    <View>
      {controls}
      {!inResults && page === 'home' && (
        <>
          {homeError ? (
            <RetryBlock message={homeError} onRetry={() => setHomeReload((n) => n + 1)} />
          ) : homeLoading ? (
            <View style={styles.rails}>
              <RailSkeleton viewportWidth={railViewport} />
              <RailSkeleton viewportWidth={railViewport} />
            </View>
          ) : (
            <>
              <View style={styles.rails}>
                {sections.map((s) => (
                  <Rail
                    key={s.id}
                    section={s}
                    viewportWidth={railViewport}
                    onSeeAll={(sec) => setSeeAll({ listId: sec.id, title: sec.title })}
                    bridge={currentBridge?.name ?? undefined}
                    bridgeId={bridgeId}
                    direct={directBridge}
                  />
                ))}
              </View>
              {nonTerminalGridSections.map((gs) => (
                <HomeGridBlock
                  key={gs.id}
                  bridgeId={bridgeId}
                  section={gs}
                  bridge={currentBridge?.name ?? undefined}
                  direct={directBridge}
                  numColumns={numColumns}
                />
              ))}
            </>
          )}
          {terminalGridSection && (
            <View style={styles.browseAllHead}>
              <SectionHead title={terminalGridSection.title} />
            </View>
          )}
        </>
      )}
      {gridError && <RetryBlock message={gridError} onRetry={() => setGridReload((n) => n + 1)} />}
    </View>
  );

  if (bridgesError && bridges.length === 0) {
    return (
      <ThemedView style={[styles.container, styles.centerFill]}>
        <RetryBlock message={bridgesError} onRetry={() => setBridgesReload((n) => n + 1)} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* The list fills the screen (behind the header overlay); its top padding
          clears the expanded header so the first content sits just below it. */}
      <Animated.FlatList
        ref={listRef}
        key={numColumns}
        data={gridData}
        keyExtractor={(item: GridItem) => String(item.id)}
        numColumns={numColumns}
        ListHeaderComponent={listHeader}
        columnWrapperStyle={[styles.row, { gap: GRID_COLUMN_GAP }]}
        contentContainerStyle={[
          styles.gridContent,
          // Pad to the bar's tallest (expanded) height so the first row clears it at
          // the top; as the bar collapses by `expand`, content scrolls up by the same
          // amount, keeping the first row pinned just under the bar's bottom edge.
          { paddingTop: headerHeight + expand, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}
        renderItem={({ item }: { item: GridItem }) =>
          item.spacer ? (
            // While a next page is actually loading, fill the last row's
            // remaining slots with skeleton cards (matching the footer's) instead
            // of an invisible spacer — otherwise the row reads as "done" and the
            // incoming skeleton rows below look like they jumped straight to a
            // fresh row rather than finishing this one first.
            loadingMore ? <SkeletonCard /> : <View style={styles.cell} />
          ) : (
            <View style={styles.cell}>
              <SeriesCard entry={item} bridge={currentBridge?.name ?? undefined} bridgeId={bridgeId} direct={directBridge} />
            </View>
          )
        }
        ListFooterComponent={
          gridLoading && gridItems.length === 0 ? (
            <GridSkeleton numColumns={numColumns} rows={2} />
          ) : loadingMore ? (
            <GridSkeleton numColumns={numColumns} rows={2} />
          ) : null
        }
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onEndReachedThreshold={0.6}
        onEndReached={inResults ? undefined : loadMore}
        // Show the browser's native scrollbar on web (the list scrolls in its own
        // overflow container); keep it hidden on native, where it's not idiomatic.
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      />
      {topBar}
    </ThemedView>
  );
}

/**
 * A non-terminal home grid section: its own heading, grid, and "Load more"
 * button — independent pagination from the main FlatList's infinite scroll,
 * matching the reference's `attachLoadMore` for every grid list but the last.
 */
function HomeGridBlock({
  bridgeId,
  section,
  bridge,
  direct,
  numColumns,
}: {
  bridgeId?: string;
  section: HomeGridSection;
  bridge?: string;
  direct: boolean;
  /** Same column count as the main grid, so cards read at one consistent size. */
  numColumns: number;
}) {
  const ds = useDataSource();
  const [items, setItems] = useState(section.items);
  const [hasNextPage, setHasNextPage] = useState(section.hasNextPage);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setItems(section.items);
    setHasNextPage(section.hasNextPage);
    setPageNum(1);
  }, [section]);

  const loadMore = () => {
    if (loading || !hasNextPage || !bridgeId) return;
    setLoading(true);
    const nextPage = pageNum + 1;
    ds.getGridPage(bridgeId, section.id, nextPage)
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setHasNextPage(res.hasNextPage);
        setPageNum(nextPage);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Chunk into fixed-column rows, matching the main FlatList grid's own
  // `numColumns` + `flex: 1` cell layout exactly (same `row`/`cell` styles) so
  // cards read at the same size everywhere, not a separately-sized wrap grid.
  const rows: SeriesEntry[][] = [];
  for (let i = 0; i < items.length; i += numColumns) rows.push(items.slice(i, i + numColumns));

  return (
    <View style={styles.homeGridBlock}>
      <SectionHead title={section.title} />
      <View style={styles.homeGridRows}>
        {rows.map((row, r) => (
          <View key={r} style={[styles.row, styles.gridRow]}>
            {row.map((item) => (
              <View key={item.id} style={styles.cell}>
                <SeriesCard entry={item} bridge={bridge} bridgeId={bridgeId} direct={direct} />
              </View>
            ))}
            {/* Pad the last row with invisible spacers so short rows don't stretch. */}
            {row.length < numColumns &&
              Array.from({ length: numColumns - row.length }).map((_, i) => (
                <View key={`spacer-${i}`} style={styles.cell} />
              ))}
          </View>
        ))}
      </View>
      {hasNextPage && (
        <Pressable onPress={loadMore} disabled={loading} style={styles.loadMoreButton}>
          <ThemedView type="backgroundElement" style={styles.loadMoreInner}>
            <ThemedText type="smallBold">{loading ? 'Loading…' : 'Load more'}</ThemedText>
          </ThemedView>
        </Pressable>
      )}
    </View>
  );
}

/** A single skeleton card (cover + two title lines) — one grid cell's worth. */
function SkeletonCard() {
  return (
    <View style={[styles.cell, styles.skelCell]}>
      <Skeleton style={styles.skelCover} />
      <Skeleton style={styles.skelLine} />
      <Skeleton style={[styles.skelLine, styles.skelLineShort]} />
    </View>
  );
}

/** Skeleton rows shown while the next infinite-scroll page loads — mirrors the
 *  grid card (cover + two title lines) so it reads as "more cards incoming". */
function GridSkeleton({ numColumns, rows }: { numColumns: number; rows: number }) {
  return (
    <View style={styles.skelFooter}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={[styles.row, styles.skelRow]}>
          {Array.from({ length: numColumns }).map((_, c) => (
            <SkeletonCard key={c} />
          ))}
        </View>
      ))}
    </View>
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
  // Absolute overlay so the list scrolls underneath; `justifyContent: flex-end`
  // keeps the selector row pinned to the bottom of the band, with the collapsing
  // breathing room above it.
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    // Cap + centre so the selectors align with the constrained grid; height is
    // set inline from the shared bar height.
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  bridgeThumb: {
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  controls: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  resultsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  resultsLabel: {
    flexShrink: 1,
  },
  rails: {
    gap: Spacing.two,
  },
  browseAllHead: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  homeGridBlock: {
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  homeGridRows: {
    gap: Spacing.three,
  },
  // Same shape as the main FlatList's `columnWrapperStyle` (`row` + this gap),
  // so a non-terminal home grid's rows lay out identically to the main grid.
  gridRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
  loadMoreButton: {
    alignSelf: 'center',
  },
  loadMoreInner: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
  },
  gridContent: {
    gap: Spacing.three,
    // Constrain the whole scrolling surface (controls, rails, grid) to the
    // top-level content width, centred on wider viewports.
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  cell: {
    flex: 1,
  },
  skelFooter: {
    // No top padding: the list's content gap already separates the footer from
    // the last row, so matching it here keeps the loaded rows from popping up
    // when they replace the skeleton.
    gap: Spacing.three,
  },
  skelRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  skelCell: {
    flex: 1,
    gap: Spacing.one,
  },
  skelCover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 10,
  },
  skelLine: {
    height: 12,
    borderRadius: 4,
  },
  skelLineShort: {
    width: '60%',
  },
});
