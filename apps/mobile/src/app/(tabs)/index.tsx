import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BridgeThumb } from '@/components/bridge-thumb';
import { FilterBar, type SortOption, type SortState } from '@/components/filters/filter-demo';
import {
  resolveMetaIntent,
  resolveTagIntent,
  type MetaIntent,
  type TagIntent,
} from '@/components/filters/filter-intents';
import { filterDefFromApi, filterValueToApi, initialValue, type FilterDef, type FilterValue } from '@/components/filters/filter-types';
import { Rail, RailSkeleton, SectionHead } from '@/components/rail';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { BridgeThumbSize, Selector } from '@/components/selector';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PullIndicator } from '@/components/pull-indicator';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { pageOptions } from '@/data/api';
import { takeBrowseIntent } from '@/data/browse-intent';
import { useDedupedPages } from '@/data/grid-pages';
import { fetchBrowseScope, homeSectionsQuery, queryKeys, type BrowseScope } from '@/data/queries';
import { isRailLayout, useDataSource, useHideNsfw, useMockActive, type QueryOpts } from '@/data/source';
import type { Bridge, BridgeList, GridPage, HomeGridSection, SeriesEntry } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useNativePullToRefresh } from '@/hooks/use-native-pull-to-refresh';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { useTouchPullToRefresh } from '@/hooks/use-touch-pull-to-refresh';

// The reference's mobile grid uses a tighter inter-card gap than its row gap
// (`.grid { gap: 1rem 0.6rem }`, i.e. ~9.6px columns vs 16px rows) — Spacing.two
// (8px) is the closest token to that column gap. Shared so the main grid and
// HomeGridBlock's non-terminal sections can't drift apart from each other.
const GRID_COLUMN_GAP = Spacing.two;
/** Debounce before a filter/sort change actually triggers a re-fetch — avoids
 *  spamming the bridge's backend on every tap, mirroring the reference's
 *  `doSearchIfChanged` snapshot-diff-on-close contract (app.ts:4765). */
const FILTER_DEBOUNCE_MS = 500;

// Minimum time pull-to-refresh's spinner stays visible once triggered — see the
// `refreshStartedAtRef` comment below.
const REFRESH_MIN_VISIBLE_MS = 600;

type GridItem = SeriesEntry & { spacer?: boolean };
/** A drilled-into rail: its list id (for pagination) + display title. */
type SeeAll = { listId: string; title: string } | null;

// Stable, never-fetched keys for the two grid infinite queries while they're disabled (no active
// scope) — hooks must be called unconditionally, so a disabled query still needs a queryKey; these
// can't collide with a real `browseGrid` key (which always carries mock/bridgeId/scope).
const DISABLED_RESULTS_KEY = ['browseGrid', 'disabled', 'results'] as const;
const DISABLED_TERMINAL_KEY = ['browseGrid', 'disabled', 'terminal'] as const;

export default function BrowseScreen() {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const mock = useMockActive();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('browse', listRef);

  // ── Bridges ────────────────────────────────────────────────────────────
  const hideNsfw = useHideNsfw();
  const [bridge, setBridge] = useState<string | null>(null);

  // Fetched via react-query (invalidated explicitly by install/update/uninstall — see
  // registry-browse.tsx and bridge-settings.tsx) rather than a plain effect keyed on `ds`, since
  // this is the list that must reflect a bridge change immediately, on a screen that's very often
  // sitting mounted-but-unfocused in the background while the user installs/uninstalls elsewhere.
  const bridgesQuery = useQuery({
    queryKey: queryKeys.bridges(),
    queryFn: ({ signal }) => ds.getBridges(signal),
  });
  const bridges = useMemo(() => bridgesQuery.data ?? [], [bridgesQuery.data]);
  const bridgesError = bridgesQuery.isError
    ? friendlyError(bridgesQuery.error, 'Failed to load bridges. Try again.')
    : null;
  // Distinguishes "still fetching" from "fetched, and there are none" — both start out as an empty
  // `bridges` array, so without this the no-bridges placeholder would flash before the first load
  // resolves.
  const bridgesLoaded = bridgesQuery.isFetched;

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
  // Fetched via react-query, keyed by bridge, so `lists` is DERIVED from the cache rather than
  // effect-synced into local state: switching back to a bridge reuses its cached lists instantly,
  // and there's no "which bridge are these lists for?" mirror id. The query key answers that, and
  // `listsSettled` (below) is the "loaded for the current bridge" signal the old `listsBridgeId`
  // provided. keepPreviousData holds the prior bridge's lists during a switch — same as the old
  // effect, which left `lists` in place until the new fetch resolved.
  const bridgeListsQuery = useQuery({
    queryKey: queryKeys.bridgeLists(mock, bridgeId ?? ''),
    queryFn: ({ signal }) => ds.getBridgeLists(bridgeId!, signal),
    enabled: !!bridgeId,
    placeholderData: keepPreviousData,
  });
  const lists = useMemo<BridgeList[]>(() => bridgeListsQuery.data ?? [], [bridgeListsQuery.data]);
  // "Lists are loaded for the CURRENT bridge" — resolved at least once AND not a keepPreviousData
  // placeholder from the previous bridge. Gates the Home fetch and the results scope so neither
  // fires off stale lists (the old `listsBridgeId === bridgeId` check).
  const listsSettled =
    !!bridgeId && (bridgeListsQuery.isSuccess || bridgeListsQuery.isError) && !bridgeListsQuery.isPlaceholderData;
  const [page, setPage] = useState('home');

  // Default landing page for a bridge, applied once its lists settle: a bridge whose lists are ALL
  // page-flagged (no composed Home) opens on its first page instead of a blank Home; anything with a
  // home-eligible (or home-backing) list opens on Home. Ref-guarded to once per bridge so a later
  // lists refetch — or the user navigating to a sub-page — can't reset the page out from under them
  // (matches the old effect, which only re-picked on a bridge switch).
  const pageInitedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bridgeId || !listsSettled) return;
    if (pageInitedForRef.current === bridgeId) return;
    pageInitedForRef.current = bridgeId;
    const hasHomeList = lists.some((l) => !l.page || l.id === 'home');
    const firstPage = lists.find((l) => l.page);
    setPage(hasHomeList || !firstPage ? 'home' : firstPage.name.toLowerCase());
  }, [bridgeId, listsSettled, lists]);

  const pages = useMemo(
    () => (currentBridge ? pageOptions(lists, currentBridge.capabilities) : ['home']),
    [lists, currentBridge],
  );
  // A `page: true` list with id "home" IS the Home tab's content (the bridge's front page): it
  // replaces the composed rails/grid Home entirely. Mirrors comical-web's selectHomeTab("home")
  // special case (app.ts) — without it the Home tab falls through to getHomeSections, which excludes
  // every `page` list, so a bridge whose only lists are page-flagged shows a permanently blank Home.
  const homeList = useMemo(() => lists.find((l) => l.id === 'home' && l.page), [lists]);
  // The built-in composed Home surface (rails + grid from non-`page` lists) — only when no page-list
  // backs the Home tab. Every "is this Home?" decision below keys off this, not a bare page === 'home'.
  const composedHome = page === 'home' && !homeList;
  // The list backing the current page: a `page: true` list picked in the selector (e.g. "Popular"),
  // or the home-backing list above when the Home tab is showing the bridge's front page.
  const selectedList = useMemo(
    () => (page === 'home' ? homeList : lists.find((l) => l.page && l.name.toLowerCase() === page)),
    [lists, page, homeList],
  );
  const isFavoritesPage = page === 'favorites';

  // ── Filters + sort (react-query per bridge; capability-gated) ─────────────
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
  // merged into the DERIVED `filterDefs` below rather than mutated into them, since the defs now
  // come straight from the query cache. Reset on bridge change.
  const [labelHints, setLabelHints] = useState<Record<string, Record<string, string>>>({});

  // `filterDefs` is DERIVED from the query (enriched with the live tag-search fn + any label hints),
  // not effect-synced local state. Because it updates in the SAME render as the query data, there's
  // no lag between "query settled" and "defs are current" — which is what lets the tag/meta intent
  // effects below gate purely on `filtersSettled`, with no `filterDefsBridgeId` mirror.
  const filterDefs = useMemo<FilterDef[]>(() => {
    if (!hasFiltersCap) return [];
    return (filtersRawQuery.data ?? []).map((f) => {
      let def = filterDefFromApi(f);
      // Live tag search for a bridge-backed tag-multiselect (no static option list). `searchKey`
      // (the bridge id) scopes the react-query cache the editor keys its search on.
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
  // "Filters are loaded for the CURRENT bridge" — the timing gate the old `filterDefsBridgeId`
  // provided for intent application. No filters capability ⇒ nothing to wait for.
  const filtersSettled =
    !hasFiltersCap || ((filtersRawQuery.isSuccess || filtersRawQuery.isError) && !filtersRawQuery.isPlaceholderData);

  // User-editable selections. `filterValues` is SPARSE — it holds only the user's explicit changes;
  // any unset filter falls back to its `initialValue` lazily (see `resolvedValues`). That removes
  // the old "seed every value on bridge load" step and the ordering it forced against intent
  // application. Reset on bridge change (below).
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});
  const [sortValue, setSortValue] = useState<SortState>(null);
  // Stable reference so `FilterBar`'s per-filter `React.memo` isn't defeated by a freshly-allocated
  // closure on every render (see `FilterButton`).
  const setFilterValue = useCallback((id: string, v: FilterValue) => {
    setFilterValues((prev) => ({ ...prev, [id]: v }));
  }, []);
  // The full value map the bar + committed snapshot read: the user's sparse changes over each def's
  // lazy default.
  const resolvedValues = useMemo<Record<string, FilterValue>>(
    () => Object.fromEntries(filterDefs.map((d) => [d.id, filterValues[d.id] ?? initialValue(d)])),
    [filterDefs, filterValues],
  );

  // Reset user filter/sort state (and label hints) when the bridge changes — the new bridge's
  // defaults apply lazily. A pending tag/meta intent (set by the focus effect) applies AFTER this,
  // gated on `filtersSettled`, so it is never wiped by the reset.
  useEffect(() => {
    setFilterValues({});
    setSortValue(null);
    setLabelHints({});
  }, [bridgeId]);

  // Debounced "committed" snapshot — the actual fetch depends on this, not on
  // `filterValues`/`sortValue` directly, so rapid taps don't each fire a request. Reference
  // contract: `doSearchIfChanged`, app.ts:4765.
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

  // ── Pull-to-refresh (native only) ─────────────────────────────────────────
  // Declared up here (rather than by `onRefresh` below) because the home-sections
  // fetch effect just below needs `refreshActiveRef`/`finishRefresh` in its own
  // deps/closure and is defined before `inResults` exists — see `onRefresh` for
  // the full picture, which needs `inResults` and so stays down there.
  const [refreshing, setRefreshing] = useState(false);
  const refreshActiveRef = useRef(false);
  // A same-device fetch (embedded transport, or just a fast network) can resolve
  // in a handful of ms — far less than the ~600ms a real pull-release-and-settle
  // takes native iOS's UIRefreshControl. If `refreshing` flips to `false` while
  // the user's finger is still down mid-drag, RN imperatively force-ends the
  // native control right then instead of on release, which reads as an abrupt
  // snap-back rather than a natural spring — and leaves no time for the spinner
  // to even render before it's told to stop. Padding the visible window out to
  // REFRESH_MIN_VISIBLE_MS keeps `refreshing` true long enough to see and to let
  // the gesture resolve normally.
  const refreshStartedAtRef = useRef(0);
  const finishRefresh = useCallback(() => {
    if (!refreshActiveRef.current) return;
    refreshActiveRef.current = false;
    const elapsed = Date.now() - refreshStartedAtRef.current;
    const wait = Math.max(0, REFRESH_MIN_VISIBLE_MS - elapsed);
    if (wait === 0) setRefreshing(false);
    else setTimeout(() => setRefreshing(false), wait);
  }, []);

  // ── Home rails + grid sections (composed Home surface) ─────────────────────
  // react-query with keepPreviousData (see homeSectionsQuery): a bridge switch keeps the prior
  // Home on screen until the new one resolves rather than clearing to a skeleton, so the shared
  // LegendList instance — and the filter bar in its header — never unmounts on a switch (that
  // remount was the reported flash). Gated on `composedHome` AND this bridge's lists being loaded
  // (`listsSettled`) so stale/empty lists can't make `composedHome` briefly true and fire a
  // spurious fetch for a page-only bridge.
  const homeQuery = useQuery(homeSectionsQuery(ds, mock, bridgeId ?? '', composedHome && listsSettled));
  const sections = useMemo(() => homeQuery.data?.sections ?? [], [homeQuery.data]);
  const gridSections = useMemo(() => homeQuery.data?.gridSections ?? [], [homeQuery.data]);
  // Surface a Retry when the CURRENT bridge's Home failed and we have no real data for it — either
  // a dataless first load (`!data`) or a failed switch where keepPreviousData is still showing the
  // PREVIOUS bridge's Home as a placeholder (`isPlaceholderData`); without the placeholder check a
  // failed switch would silently strand the user on the old bridge's content. A refetch that fails
  // while we hold real current data (e.g. a pull-to-refresh) keeps the content and shows no banner.
  const homeError =
    homeQuery.isError && (!homeQuery.data || homeQuery.isPlaceholderData)
      ? friendlyError(homeQuery.error, "Couldn't load this bridge's home. Try again.")
      : null;
  // Skeleton only on a genuinely dataless first load: keepPreviousData keeps prior data during a
  // bridge switch (isPlaceholderData) and a refetch keeps its own data, so neither shows a skeleton.
  const homeLoading = homeQuery.isLoading;
  // While a bridge switch is in flight, keepPreviousData shows the PREVIOUS bridge's Home — dim it
  // so it reads as "updating" rather than as the new bridge's real content.
  const homeUpdating = homeQuery.isPlaceholderData;
  // Only the LAST grid section infinite-scrolls; earlier ones get "Load more" —
  // see HomeGridSection's doc in types.ts.
  const terminalGridSection = gridSections.at(-1) ?? null;
  const nonTerminalGridSections = gridSections.length > 1 ? gridSections.slice(0, -1) : [];

  // ── Home skeleton shape, derived from `lists` (already fetched, layout included) ──────────
  // `lists` resolves before `getHomeSections`'s per-list content fetch, so while `homeLoading`
  // is true we already know each home list's name + layout (rail vs. grid) and can shape the
  // skeleton to match — same partition `getHomeSections` applies to real items, just applied to
  // the list metadata instead. Mirrors comical-web's `appendSkeletonSection`, which does the same
  // from `SeriesList.layout` before its own per-list fetch resolves.
  const homeListsPreview = useMemo(() => lists.filter((l) => !l.page), [lists]);
  const railListsPreview = useMemo(() => homeListsPreview.filter((l) => isRailLayout(l.layout)), [homeListsPreview]);
  const gridListsPreview = useMemo(
    () => homeListsPreview.filter((l) => !isRailLayout(l.layout)),
    [homeListsPreview],
  );
  const terminalGridPreview = gridListsPreview.at(-1) ?? null;
  const nonTerminalGridListsPreview = gridListsPreview.length > 1 ? gridListsPreview.slice(0, -1) : [];

  // Committed search query (set on submit) and the active "See all" rail, if any.
  const [query, setQuery] = useState('');
  const [seeAll, setSeeAll] = useState<SeeAll>(null);

  // ── Tag-chip / meta-cell search intent (from the Series screen) ───────────
  // A `tagIds` chip resolves to a tag-multiselect filter, which can only be set
  // once this bridge's defs have loaded — stash it here and apply it in the
  // effect below (a `tagQueries` chip is handled inline as a plain query).
  const [pendingTag, setPendingTag] = useState<TagIntent | null>(null);
  // Same idea for a tapped Author/Artist/Type meta cell: resolved once this
  // bridge's filter defs have loaded, against whichever field it maps to.
  const [pendingMeta, setPendingMeta] = useState<MetaIntent | null>(null);
  // Consume the Series screen's intent when Browse gains focus (i.e. after we've
  // navigated to it), not on a background re-render while Series is still on top —
  // so it lands on the instance that's actually shown. Switch to the originating
  // bridge, leave any "See all" / sub-page scope, then either set the query
  // (tagQueries path), stash the tag to apply once this bridge's filter defs
  // load (tagIds path), or stash the meta value to resolve against a filter
  // field the same way (meta path). Mirrors comical-web's navigateToQuerySearch /
  // navigateToFilteredSearch (app.ts). `originPage` restores the Browse sub-page the series
  // was opened from (e.g. "Popular") so the drill-down's back arrow returns there instead of
  // Home — falls back to 'home' when absent (series opened from a different tab, where there's
  // no Browse sub-page to return to).
  useFocusEffect(
    useCallback(() => {
      const intent = takeBrowseIntent();
      if (!intent) return;
      setSeeAll(null);
      setPage(intent.originPage ?? 'home');
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

  // Apply once the CURRENT bridge's filter defs are loaded (`filtersSettled`). Because `filterDefs`
  // is derived (never lagging the query), a null resolution here genuinely means this bridge has no
  // matching tag filter — so it's safe to drop the intent. See resolveTagIntent + its tests.
  useEffect(() => {
    if (!pendingTag || !bridgeId || !filtersSettled) return;
    const res = resolveTagIntent(filterDefs, pendingTag);
    if (res) {
      // Seed the id→label hint so the trigger/editor show the tag's name, not its raw id (a
      // live-search filter has no static options to look it up in), and select it.
      setLabelHints((prev) => ({ ...prev, [res.defId]: { ...(prev[res.defId] ?? {}), ...res.labelHint } }));
      setFilterValues((prev) => ({ ...prev, [res.defId]: res.value }));
    }
    setPendingTag(null);
  }, [pendingTag, filterDefs, filtersSettled, bridgeId]);

  useEffect(() => {
    if (!pendingMeta || !bridgeId || !filtersSettled) return;
    // Prefer the bridge's own field for that meta key (so an Author tap lands on its author filter),
    // else fall back to a plain free-text search — see resolveMetaIntent + its tests.
    const res = resolveMetaIntent(filterDefs, pendingMeta);
    if (res.kind === 'filter') setFilterValues((prev) => ({ ...prev, [res.defId]: res.value }));
    else setQuery(res.query);
    setPendingMeta(null);
  }, [pendingMeta, filterDefs, filtersSettled, bridgeId]);

  // A search, a rail's "See all", a live filter/sort choice, or picking a
  // page-flagged sub-list (e.g. "Popular"/"Favorites") all drop to the flat
  // results grid — matches the reference's `doSearch`: any of
  // query/filters/sort/list-scope leaves the home surface.
  const inResults = !!query || !!seeAll || hasActiveQuery || !composedHome;
  // The back banner is for transient drill-downs (search / "See all" / a live
  // filter or sort) — NOT for plain page-selector navigation. Selecting a
  // page-flagged list like "Popular" is a top-level page in its own right (the
  // Page selector itself already shows it's active and is how you switch back
  // to Home), so it shouldn't get the same back-arrow treatment a drill-down
  // does. A drill-down layered on top of a selected page (e.g. searching while
  // on "Popular") still shows the banner, and its arrow returns to that page.
  const showBackBanner = !!query || !!seeAll || hasActiveQuery;
  // Where the back arrow returns to — the page the drill-down was layered on:
  // Home if that's where we were, otherwise the selected page (e.g. "Popular"). A tag/meta
  // chip from the Series screen restores whichever page it was opened from (see the focus
  // effect's `originPage` handling) — 'home' only when it wasn't opened from Browse itself.
  const backLabel =
    page === 'home' ? 'Home' : (selectedList?.name ?? page.charAt(0).toUpperCase() + page.slice(1));
  // Caption for what's being shown: a "See all" list, a text search, or — with
  // neither (so `showBackBanner` is only true via a live filter/sort) — a
  // refinement of the current page. Not the bare page name, which would just
  // echo the back arrow.
  const resultsLabel = seeAll ? seeAll.title : query ? `Results for “${query}”` : 'Filtered results';

  // ── Grid derivations (which logical view the flat grid is showing) ─────────
  // These discriminators feed `resultsScope`/`terminalScope` below, which the infinite queries key
  // and fetch from. "See all" keeps its simple behavior (browse that list's items, page-only, no
  // filters/sort/scoped-search); those apply to the page-flagged list / global search case instead.
  const activeListId = seeAll ? seeAll.listId : !composedHome ? (selectedList?.id ?? null) : null;
  // Scoped-list search: route through the list endpoint's `q` param when the
  // active list is `searchable`, instead of always calling `/search` — mirrors
  // `runSearch`'s branch at app.ts:4857.
  const scopedSearch = !seeAll && !composedHome && !!selectedList?.searchable && !!activeListId;
  const showResultsGrid = inResults;
  // Home's terminal grid section (the last one in `gridSections`) shares the
  // SAME scrollable FlatList + infinite scroll as results mode, not the
  // "Load more" blocks non-terminal sections get — so it feeds `gridItems` too.
  const isHomeTerminal = !inResults && composedHome && !!terminalGridSection;

  // The results scope (search / "See all" / a page-flagged list / favorites), or null when we're
  // not showing a results grid (pure composed Home, or Home's terminal section — handled below).
  // Both the query key and the fetch derive from this one value (see BrowseScope), which is what
  // lets the grid move between scopes without ever clearing to empty.
  const resultsScope = useMemo<BrowseScope | null>(() => {
    // Wait for the current bridge's lists to settle: `activeListId`/`scopedSearch` derive from
    // `lists`, so computing a scope off the previous bridge's placeholder lists would fetch a list
    // id that doesn't exist on the new bridge (an "unknown list" / HTML-parse error). keepPreviousData
    // keeps the grid populated meanwhile.
    if (isHomeTerminal || !showResultsGrid || !bridgeId || !listsSettled) return null;
    if (isFavoritesPage) return { kind: 'favorites' };
    if (seeAll) return { kind: 'seeAll', listId: seeAll.listId };
    const opts: QueryOpts = { filters: committedFilters, sort: committedSort };
    // A page-flagged list browsed with no query (optionally filtered/sorted), or scoped-search on
    // that same list when it's `searchable` and a query is set.
    if (activeListId && (scopedSearch || !query)) {
      return { kind: 'list', listId: activeListId, opts: scopedSearch && query ? { ...opts, query } : opts };
    }
    // Global search: an unscoped query, or filters/sort with no specific list (home).
    return { kind: 'search', query, opts };
  }, [isHomeTerminal, showResultsGrid, bridgeId, listsSettled, isFavoritesPage, seeAll, activeListId, scopedSearch, query, committedFilters, committedSort]);

  const getNextPageParam = (last: GridPage, _all: GridPage[], lastParam: number) =>
    last.hasNextPage ? lastParam + 1 : undefined;

  // keepPreviousData holds the previous scope's items until the new scope resolves, so a
  // bridge/page/filter/sort/search switch never clears the grid to empty — no flash, and no
  // empty→populated transition for the list to choke on (see the list `key` below).
  const resultsQuery = useInfiniteQuery({
    queryKey: resultsScope ? queryKeys.browseGrid(mock, bridgeId ?? '', resultsScope) : DISABLED_RESULTS_KEY,
    queryFn: ({ pageParam, signal }) => fetchBrowseScope(ds, bridgeId ?? '', resultsScope!, pageParam, signal),
    enabled: !!resultsScope,
    initialPageParam: 1,
    getNextPageParam,
    placeholderData: keepPreviousData,
  });

  // Home's terminal grid section shares the main list's infinite scroll. Page 1 is seeded from
  // `getHomeSections` via `initialData` (no extra request on Home); pages 2+ come through here.
  // Keyed on the terminal list's id, so a bridge switch (a different terminal list) is a fresh scope.
  //
  // Gate the fetch scope on the home data being SETTLED (`!isPlaceholderData`): mid-switch,
  // keepPreviousData makes `homeQuery.data` briefly the previous bridge's Home, so
  // `terminalGridSection.id` would be the OLD list paired with the NEW `bridgeId` — a wrong fetch.
  // While unsettled, `terminalScope` is null (query disabled), and keepPreviousData keeps the prior
  // terminal items on screen so the body never empties; once Home settles, `initialData` seeds the
  // new page 1 with no extra request. `isHomeTerminal` itself stays true across the switch (so we
  // keep reading `terminalQuery`, not the empty results query) — only the fetch key waits.
  const terminalScope: BrowseScope | null =
    isHomeTerminal && terminalGridSection && !homeQuery.isPlaceholderData
      ? { kind: 'homeGrid', listId: terminalGridSection.id }
      : null;
  const terminalQuery = useInfiniteQuery({
    queryKey: terminalScope ? queryKeys.browseGrid(mock, bridgeId ?? '', terminalScope) : DISABLED_TERMINAL_KEY,
    queryFn: ({ pageParam, signal }) => fetchBrowseScope(ds, bridgeId ?? '', terminalScope!, pageParam, signal),
    enabled: !!terminalScope,
    initialPageParam: 1,
    getNextPageParam,
    ...(terminalScope && terminalGridSection
      ? {
          initialData: {
            pages: [{ items: terminalGridSection.items, hasNextPage: terminalGridSection.hasNextPage }],
            pageParams: [1],
          },
        }
      : {}),
    placeholderData: keepPreviousData,
  });

  const activeGridQuery = isHomeTerminal ? terminalQuery : resultsQuery;
  // De-duplicate by series id while flattening the infinite pages: live-reordering browse feeds
  // (e.g. a trending / recently-updated list paginated by offset) can return the same series on
  // two adjacent pages, which would collide on the list `keyExtractor`. See useDedupedPages.
  const gridItems = useDedupedPages(activeGridQuery.data);
  const gridError =
    resultsScope && resultsQuery.isError && (!resultsQuery.data || resultsQuery.isPlaceholderData)
      ? friendlyError(resultsQuery.error, "Couldn't load results. Try again.")
      : null;
  // Skeleton only on a genuinely dataless first load (see homeLoading for the same reasoning).
  const gridLoading = !!resultsScope && resultsQuery.isLoading;
  // The active grid query is showing the previous scope's items (keepPreviousData) while the new
  // scope loads — dim the cards to signal the refresh (bridge / page / filter / sort / search).
  const gridUpdating = activeGridQuery.isPlaceholderData;

  // ── Full-home crossfade on a bridge switch ────────────────────────────────
  // A source switch is a wholesale change, so dissolve the ENTIRE home (controls + rails + grid,
  // everything in the list): fade it out, COMMIT the switch only once it's hidden, then fade the new
  // bridge's home in. Committing at opacity 0 is what makes it seamless for an already-cached bridge
  // too — its content is available instantly and would otherwise hard-cut before any fade. The commit
  // is deferred by holding setBridge/setQuery/setSeeAll until the fade-out's completion callback (see
  // `selectBridge`); until then the OLD bridge stays fully rendered and fades out as itself. The
  // bridge/page selector (topBar, outside the list) stays put throughout. Within-bridge refinements
  // (page/filter/sort/search) keep the lighter dim below, suppressed while `switching`.
  const XFADE_OUT_MS = 140;
  const XFADE_IN_MS = 200;
  // Hard cap on the hidden window — reveal whatever's there rather than ever leaving the home
  // stranded invisible if readiness somehow never resolves.
  const XFADE_MAX_WAIT_MS = 1800;
  const homeXfade = useSharedValue(1);
  const homeXfadeStyle = useAnimatedStyle(() => ({ opacity: homeXfade.value }));
  const [switching, setSwitching] = useState(false);
  const [committed, setCommitted] = useState(false);
  // Run at the bottom of the fade-out (opacity 0): swap to the new bridge here, so the old→new change
  // is never on screen. `selectBridge` also drops query/seeAll (as it always has) as part of the same
  // top-level navigation. Stable so the fade-out worklet callback closes over a fixed reference.
  const commitBridgeTo = useCallback((name: string) => {
    setBridge(name);
    setQuery('');
    setSeeAll(null);
    setCommitted(true);
  }, []);
  // "The new bridge's home is ready to reveal": its content query has settled, or errored (so a
  // failed switch shows its Retry instead of stranding a blank home). Only consult `homeUpdating`
  // when the COMPOSED home actually drives the surface. A page-list bridge (home is a page-flagged
  // list, composedHome=false) has its home query DISABLED, and under keepPreviousData a disabled
  // query sits on the previous bridge's data as a permanent placeholder — so homeUpdating would be
  // stuck true forever and the crossfade would never fade back in, leaving the home invisible at
  // opacity 0 (a page-list bridge showed no home content). Such a home is ready on its grid alone.
  const homeReady =
    !!homeError || !!gridError || (!gridUpdating && (composedHome ? !homeUpdating : true));
  useEffect(() => {
    // `committed` gates out the fade-out phase, when `homeReady` still reflects the outgoing bridge.
    if (!switching || !committed) return;
    const revealNow = () => {
      homeXfade.value = withTiming(1, { duration: XFADE_IN_MS, easing: Easing.out(Easing.quad) });
      setSwitching(false);
      setCommitted(false);
    };
    if (homeReady) {
      revealNow();
      return;
    }
    // Not ready yet — reveal on readiness (this effect re-runs when homeReady flips), but never wait
    // past the cap, so a stuck/edge query state can't strand the home invisible.
    const t = setTimeout(revealNow, XFADE_MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [switching, committed, homeReady, homeXfade]);

  // ── Within-bridge grid dim (page/filter/sort/search refinements) ──────────
  // A lighter treatment than a full source switch: the kept grid eases to a dimmed 0.45 while the new
  // scope loads, then back to full — "refreshing", not "swapping". Suppressed while `switching` (the
  // full crossfade above owns a bridge change; this would just fight it). One shared animated style is
  // reused across every grid cell (no per-cell hook — renderItem isn't a component). Only the grid
  // needs it: the composed-home rails are only ever placeholder-swapped by a bridge change, which the
  // crossfade already covers — so there's no separate rails dim (homeUpdating ⇒ switching).
  const REVEAL_DIM = 0.45;
  const REVEAL_MS = 200;
  const gridReveal = useSharedValue(1);
  useEffect(() => {
    gridReveal.value = withTiming(gridUpdating && !switching ? REVEAL_DIM : 1, { duration: REVEAL_MS, easing: Easing.out(Easing.quad) });
  }, [gridUpdating, switching, gridReveal]);
  const gridCellStyle = useAnimatedStyle(() => ({ opacity: gridReveal.value }));

  // Everything shown on the favorites page is, by definition, favorited — so warm the per-series
  // `isFavorite` cache to `true`. Opening one from here then paints ★ instantly (and enabled)
  // instead of gating the button on a fresh per-series status check. Mirrors comical-web's
  // `favoritesCache` pre-seed. Runs as items arrive (page 1 and each infinite-scroll page).
  useEffect(() => {
    if (!isFavoritesPage || !bridgeId) return;
    for (const item of gridItems) {
      queryClient.setQueryData(queryKeys.isFavorite(mock, bridgeId, item.id), true);
    }
  }, [isFavoritesPage, bridgeId, mock, gridItems, queryClient]);

  const loadMore = () => {
    // `hasNextPage`/`isFetchingNextPage` are react-query's own guards — a fast fling firing
    // `onEndReached` repeatedly can't double-fetch the same page (it dedupes internally).
    if (!activeGridQuery.hasNextPage || activeGridQuery.isFetchingNextPage || !bridgeId) return;
    if (!isHomeTerminal && !showResultsGrid) return;
    void activeGridQuery.fetchNextPage();
  };

  // Re-runs whichever query backs the current view. keepPreviousData keeps the existing content on
  // screen under the RefreshControl spinner (no skeleton), and `finishRefresh` enforces the minimum
  // visible spinner duration once the refetch resolves. A ref holds the latest refetch closure so
  // `onRefresh` itself stays stable (the query objects it closes over change identity every render).
  const refreshRef = useRef<() => Promise<unknown>>(() => Promise.resolve());
  refreshRef.current = () => {
    const jobs: Promise<unknown>[] = [];
    if (inResults) {
      if (resultsScope) jobs.push(resultsQuery.refetch());
    } else {
      jobs.push(homeQuery.refetch());
      if (isHomeTerminal) jobs.push(terminalQuery.refetch());
    }
    return Promise.all(jobs);
  };
  const onRefresh = useCallback(() => {
    refreshActiveRef.current = true;
    refreshStartedAtRef.current = Date.now();
    setRefreshing(true);
    void refreshRef.current().finally(finishRefresh);
  }, [finishRefresh]);

  // Leave a transient drill-down (search / "See all" / a live filter or sort) and
  // return to the page it was layered on — Home if that's where we were, or the
  // selected page (e.g. "Popular") otherwise. `page` is deliberately left
  // untouched so we land back where the user actually was instead of always
  // jumping to Home; a tag/meta chip from the Series screen has already set
  // `page` to 'home' (see the focus effect), so that flow still returns Home.
  const exitDrilldown = () => {
    setQuery('');
    setSeeAll(null);
    // A tag chip / author-artist-type meta cell (and any live filter/sort) drives
    // results via a filter, not `query` — so clearing just the query would leave
    // `hasActiveQuery` true and strand us in results. Clear the user's filter selections
    // (each filter falls back to its neutral default lazily) and drop the sort so the
    // banner dismisses and the underlying page actually returns.
    setFilterValues({});
    setSortValue(null);
    // `hasActiveQuery` (and so `inResults`) reads the DEBOUNCED committed filters/sort, not
    // `filterValues`/`sortValue` directly — clearing only those would leave `committedFilters`/
    // `committedSort` stale for up to FILTER_DEBOUNCE_MS, stranding the banner/results grid on
    // screen for half a second after the tap (looks like the button is blocked on a request).
    // Clear the committed snapshot synchronously too so `inResults` flips on the same tick.
    setCommittedFilters(undefined);
    setCommittedSort(undefined);
    // Drop any not-yet-applied intent so it can't re-set the filter after we've
    // just cleared it (a race if back is pressed before this bridge's defs load).
    setPendingTag(null);
    setPendingMeta(null);
  };

  // Switching bridge or page is top-level navigation, so it drops any active
  // search / "See all" drill-down and lands on that page's full rails+grid.
  // A real bridge change runs through the deferred-commit crossfade (see the crossfade block):
  // fade the whole home out, then commit (setBridge/setQuery/setSeeAll) at opacity 0 so the swap is
  // never seen, then fade the new bridge in. A no-op re-tap (or before any bridge resolves) just
  // commits immediately — nothing to dissolve.
  const selectBridge = (b: string) => {
    if (!currentBridge || b === currentBridge.name) {
      setQuery('');
      setSeeAll(null);
      setBridge(b);
      return;
    }
    setSwitching(true);
    setCommitted(false);
    homeXfade.value = withTiming(0, { duration: XFADE_OUT_MS, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) runOnJS(commitBridgeTo)(b);
    });
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
  const numColumns =
    !hydrated || width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));
  // Center content in a full-width scroller (scrollbar at the window edge) via symmetric side
  // padding — LegendList drops paddingHorizontal / ignores alignSelf on its content container, so
  // explicit paddingLeft/Right is the reliable lever. The header/footer bleed Spacing.four of this
  // back out so their own self-padded children (controls, rails, section heads) stay aligned.
  const sidePad = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;
  // Single hydration-safe viewport width for the rails: a deterministic mobile
  // fallback during prerender/first paint, the real width once mounted.
  const railViewport = hydrated ? width : 390;
  // Feeds LegendList's `estimatedItemSize` below — a first-paint/pagination size hint so it
  // doesn't have to lay out a full screen of never-measured rows during a fast fling. Mirrors the
  // content width math above (window width minus the same symmetric `sidePad`) minus the grid's
  // own column gaps.
  const gridContentWidth = width - sidePad * 2;
  const cardWidth = (gridContentWidth - (numColumns - 1) * GRID_COLUMN_GAP) / numColumns;

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

  // A scope switch no longer remounts the list: keepPreviousData keeps the grid populated across
  // switches (see the grid queries above), so the filter bar in the header stays mounted — no flash.
  // The list key is reduced to just the two things that genuinely require a fresh instance:
  //  - `numColumns` (a different column count is a different grid layout), and
  //  - the empty↔populated boundary, which still guards LegendList's web "reset during render" bug
  //    (`set$` in `shouldResetFreshDataLayout`, thrown as "Cannot update a component while rendering
  //    a different component") on the rare genuinely-empty→populated transition. keepPreviousData
  //    removes it for the common populated→populated scope switch, but a scope that legitimately
  //    returns 0 results, followed by one that returns some, still crosses 0→N on a persisted
  //    instance — remounting across that boundary keeps the fill on a fresh mount's first render.
  const gridKey = `${numColumns}|${gridData.length > 0 ? 'full' : 'empty'}`;
  // Logical scope string — drives ONLY the header/scroll reset effect below (not the list key), so
  // the collapsing top bar snaps back and the persisted list scrolls to top on a real scope change.
  const gridScope = [
    bridgeId ?? '',
    page,
    inResults ? 'r' : 'h',
    activeListId ?? '',
    seeAll?.listId ?? '',
    isFavoritesPage ? 'fav' : '',
    isHomeTerminal ? 'term' : '',
    scopedSearch ? 'scoped' : '',
    query,
    committedSort ?? '',
    JSON.stringify(committedFilters ?? {}),
  ].join('|');

  // Top bar: the bridge/page selectors sit in a fixed-height band (barHeight below
  // the safe-area inset), overlaid on the scrolling list. Unlike the old
  // expand-at-top/collapse-on-scroll animation, the bar itself never changes size —
  // instead it slides away as a whole (see `headerOffsetY` below), X/Twitter-style.
  const headerHeight = insets.top + barHeight;
  // AnimatedLegendList feeds the live scroll offset into `scrollY` on the UI thread via its
  // `sharedValues` prop (below). A reaction bridges the same value back to JS for the
  // tab-bar-hide, replacing the old useAnimatedScrollHandler+runOnJS (LegendList doesn't take a
  // worklet onScroll the way Animated.FlatList did).
  const scrollY = useSharedValue(0);
  const { reportOffset } = useHideTabBarOnScroll();
  useAnimatedReaction(
    () => scrollY.value,
    (y) => runOnJS(reportOffset)(y),
    [reportOffset],
  );
  // The list's max scroll offset (contentHeight - viewportHeight), kept in sync via the plain
  // `onScroll` below — used only to tell a genuine upward scroll apart from the bottom's elastic
  // bounce-back recoil (see the reaction below). `scrollY`/`sharedValues` gives a live UI-thread
  // offset but not the content/layout sizes needed for that; a plain (non-worklet) onScroll still
  // fires alongside it and carries both.
  const maxScrollY = useSharedValue(0);
  // 0 = bar fully visible (resting position); -headerHeight = fully hidden, slid up and
  // off-screen. Tracks the scroll delta 1:1 (X/Twitter-style): scrolling down by dy px hides
  // the bar by the same dy, scrolling up reveals it again from wherever it currently sits —
  // it doesn't need to reach the very top first. At/above the top (y <= 0 — resting, or an
  // active pull/overscroll, which reports negative y) it's pinned fully visible: the pull-to-
  // refresh spinner is a separate overlay that sits just below the bar's resting edge (the shared
  // PullIndicator, driven by useTouchPullToRefresh on web+Android / useNativePullToRefresh on iOS — not a
  // native RefreshControl behind the bar), so the bar has nothing to get out of the way of, and
  // staying put reads as an anchored top bar with the spinner emerging beneath it, X-style.
  const headerOffsetY = useSharedValue(0);
  useAnimatedReaction(
    () => scrollY.value,
    (y, prevY) => {
      if (y <= 0) {
        headerOffsetY.value = 0;
        return;
      }
      // Past the real end of the content, the list is either overscrolled into the elastic
      // bottom bounce or springing back out of it — both produce the same "offset decreasing"
      // delta a genuine scroll-up does, which would otherwise reveal the bar on every bounce at
      // the bottom of the list. Only apply the delta once the offset is genuinely below the max,
      // i.e. actual upward scrolling past that point.
      if (maxScrollY.value > 0 && y >= maxScrollY.value) {
        return;
      }
      const dy = y - (prevY ?? y);
      headerOffsetY.value = Math.min(0, Math.max(-headerHeight, headerOffsetY.value - dy));
    },
    [headerHeight],
  );
  // On a real scope change, snap the sliding top bar back to fully-visible (resetting the shared
  // scroll values) AND scroll the list itself to the top. The list instance now persists across
  // scope changes (no remount — see `gridKey`), so unlike before it won't come back at the top on
  // its own; `scrollToOffset` puts it there to match the reset bar.
  useEffect(() => {
    scrollY.value = 0;
    headerOffsetY.value = 0;
    maxScrollY.value = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [gridScope, scrollY, headerOffsetY, maxScrollY]);
  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headerOffsetY.value }],
  }));
  // Pull-to-refresh: one overlay spinner (`PullIndicator`) across every platform, fed by whichever
  // hook can source a pull there — all funneling into the same `onRefresh`/`refreshing` pair, so
  // every path runs the identical refetch/min-visible-duration flow:
  //  - Web + Android (`useTouchPullToRefresh`): touch-driven, since neither has usable elastic
  //    overscroll (web's RefreshControl is inert; Android clamps to a glow).
  //  - iOS (`useNativePullToRefresh`): reads the native bounce directly — no touch plumbing needed,
  //    and its RefreshControl can't be used anyway (spinner draws behind the top bar, see the hook).
  // We deliberately don't use RN's native RefreshControl on any platform — a consistent custom
  // spinner beats the Material control looking different on Android alone. Both hooks are inert off
  // their platforms, so calling both unconditionally is safe.
  const touchPull = useTouchPullToRefresh(scrollY, onRefresh, refreshing);
  const nativePull = useNativePullToRefresh(scrollY, onRefresh, refreshing);
  const customPull = Platform.OS === 'ios' ? nativePull : touchPull;
  // Shift the whole grid down so the gap the spinner sits in opens up. On web + Android that tracks
  // the pull the whole way (the touch hook translates the list to create the gap). On iOS it stays 0
  // during the pull — the native bounce already moves the content — and only engages during the hold
  // to keep the content pinned down while refreshing (see `listTranslateY` in the native hook).
  const listPullStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: customPull.listTranslateY.value }],
  }));

  const topBar = (
    <Animated.View
      style={[
        styles.topBar,
        {
          paddingTop: insets.top,
          height: headerHeight,
          backgroundColor: theme.background,
          borderBottomColor: theme.hairline,
          pointerEvents: 'box-none',
        },
        headerStyle,
      ]}>
      {/* Inner row capped to the content width so the selectors line up with the
          grid below, while the bar background stays full-bleed. */}
      <View style={[styles.selectorRow, { height: barHeight }]}>
        {currentBridge ? (
          <View style={[styles.bridgeThumb, { width: thumbSize, height: thumbSize }]}>
            <BridgeThumb uri={currentBridge.thumbnail} label={currentBridge.name} size={thumbSize} fill />
          </View>
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
      </View>
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
        values={resolvedValues}
        onValueChange={setFilterValue}
        sortOptions={sortOptions}
        sort={sortValue}
        onSortChange={setSortValue}
        searchActive={inResults}
      />
      {showBackBanner && (
        <View style={styles.resultsHead}>
          <Pressable onPress={exitDrilldown} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              ← {backLabel}
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
    // Bleed out the list's new contentContainer horizontal padding: every header child
    // (controls, rails, section heads) already self-pads by Spacing.four, so this keeps them at a
    // single inset instead of doubling. See the contentContainerStyle note on the list.
    <View style={styles.bleed}>
      {controls}
      {!inResults && composedHome && (
        <>
          {homeError ? (
            <RetryBlock message={homeError} onRetry={() => homeQuery.refetch()} />
          ) : homeLoading ? (
            <>
              <View style={styles.rails}>
                {/* Falls back to a generic pair when `lists` hasn't resolved any home
                    sections at all (shouldn't normally happen — `composedHome` implies
                    at least one — but avoids a blank flash if it ever does). */}
                {railListsPreview.length > 0 || gridListsPreview.length > 0 ? (
                  railListsPreview.map((l) => <RailSkeleton key={l.id} viewportWidth={railViewport} title={l.name} />)
                ) : (
                  <>
                    <RailSkeleton viewportWidth={railViewport} />
                    <RailSkeleton viewportWidth={railViewport} />
                  </>
                )}
              </View>
              {nonTerminalGridListsPreview.map((l) => (
                // Mirrors HomeGridBlock's own row layout (`styles.row` + `styles.gridRow`) rather than
                // reusing `GridSkeleton` here — that component's `skelFooter` wrapper carries its own
                // bleed margin for its usual job as a *sibling* of this bled header (the main list's
                // ListFooterComponent, see below); nesting it inside the header would double it up.
                <View key={l.id} style={styles.homeGridBlock}>
                  <SectionHead title={l.name} />
                  <View style={styles.homeGridRows}>
                    {Array.from({ length: 2 }).map((_, r) => (
                      <View key={r} style={[styles.row, styles.gridRow]}>
                        {Array.from({ length: numColumns }).map((_, c) => (
                          <SkeletonCard key={c} />
                        ))}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </>
          ) : (
            // The whole home (this block included) is dissolved as one by the bridge-switch crossfade
            // on the list wrapper — see `homeXfade` — so the rails need no opacity treatment of their
            // own here; they only ever placeholder-swap on a bridge change, which the crossfade owns.
            <View>
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
            </View>
          )}
          {terminalGridSection ? (
            <View style={styles.browseAllHead}>
              <SectionHead title={terminalGridSection.title} />
            </View>
          ) : (
            homeLoading &&
            terminalGridPreview && (
              <View style={styles.browseAllHead}>
                <SectionHead title={terminalGridPreview.name} />
              </View>
            )
          )}
        </>
      )}
      {gridError && <RetryBlock message={gridError} onRetry={() => resultsQuery.refetch()} />}
    </View>
  );

  if (bridgesError && bridges.length === 0) {
    return (
      <ThemedView style={[styles.container, styles.centerFill]}>
        <RetryBlock message={bridgesError} onRetry={() => bridgesQuery.refetch()} />
      </ThemedView>
    );
  }

  if (bridgesLoaded && bridges.length === 0) {
    return (
      <ThemedView style={[styles.container, styles.centerFill]}>
        <View style={styles.noBridges}>
          <Image style={styles.noBridgesIcon} source={require('@/assets/images/comical-logo.png')} />
          <ThemedText type="subtitle" style={styles.noBridgesTitle}>
            Comical
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.noBridgesDetail}>
            Add a registry to install bridges and start browsing series.
          </ThemedText>
          <Pressable onPress={() => router.push('/registries')} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Manage registries
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={styles.container}
      // Touch-driven pull-to-refresh for web + Android — see `useTouchPullToRefresh`. Catching the
      // raw touch events here (rather than needing LegendList to forward them from wherever the
      // touch actually started) works regardless of what's under the finger. Not wired on iOS,
      // which sources its pull from the native bounce instead (`useNativePullToRefresh`).
      {...(Platform.OS === 'ios'
        ? null
        : { onTouchStart: touchPull.onTouchStart, onTouchMove: touchPull.onTouchMove, onTouchEnd: touchPull.onTouchEnd })}>
      {/* The list's own frame spans the full screen, from behind the topBar — its contentContainer
          top padding (headerHeight) reserves the bar's resting height so content starts below it;
          as the bar slides away (see `headerOffsetY` above) the content already sitting there is
          revealed, rather than the list itself needing to relayout. */}
      {/* Wrapping rather than animating AnimatedLegendList's own `style` directly — LegendList's
          style prop isn't typed for a Reanimated animated style the way Animated.View's is. */}
      <Animated.View style={[styles.list, listPullStyle, homeXfadeStyle]}>
      <AnimatedLegendList
        ref={listRef}
        key={gridKey}
        // Full-width scroller so the scrollbar sits at the window edge; content centered via the
        // symmetric sidePad below. Scroll offset flows into scrollY for the sliding header.
        style={styles.listInner}
        sharedValues={{ scrollOffset: scrollY }}
        // WEB ONLY. Root-causes the "loading only resumes once you lift your finger" symptom on web:
        // when no `renderScrollComponent` is given, `@legendapp/list/reanimated`'s internal scroll
        // bridge renders `Animated.ScrollView` with whatever `scrollEventThrottle` LegendList's own
        // internal ListComponent hardcodes for it — which is 0. At 0, react-native-web's ScrollView
        // only fires `onScroll` once at gesture start and once ~100ms after the gesture goes idle (its
        // 100ms debounced `handleScrollEnd`), never during an active drag/momentum — so LegendList's
        // visible range (and onEndReached) only advances once you let go. Passing ANY
        // renderScrollComponent here routes through the bridge's *other* branch, which forces
        // scrollEventThrottle: 1 before calling us — restoring continuous updates during the gesture.
        // On NATIVE we deliberately don't pass it: forcing scrollEventThrottle:1 there just saturates
        // the JS thread every frame during a fling (the plain onScroll below and the UI→JS tab-bar
        // reaction already run per frame), and native's default scroll bridge is fine — the UI-thread
        // `scrollY` (sharedValues) that drives the sliding header works regardless of this.
        renderScrollComponent={
          Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined
        }
        // Plain (JS-thread) onScroll alongside `sharedValues` above — only used to keep
        // `maxScrollY` in sync (see its comment) for the bottom-bounce guard; everything else
        // reads the UI-thread `scrollY` instead.
        onScroll={(e) => {
          const { contentSize, layoutMeasurement } = e.nativeEvent;
          if (contentSize && layoutMeasurement) {
            maxScrollY.value = Math.max(0, contentSize.height - layoutMeasurement.height);
          }
        }}
        data={gridData}
        estimatedItemSize={estimatedCardHeight(cardWidth)}
        // `estimatedItemSize` is a deliberately rough hint (worst-case 3-line titles), so measured
        // rows routinely differ from it. LegendList's default `maintainVisibleContentPosition`
        // (size:true) reacts to that by retro-correcting the scroll offset — which shows up as a
        // visible bounce/jitter while flinging. Turn it off (data:false is already the default: no
        // re-anchor on page-append) so positions settle once measured instead of nudging the offset.
        maintainVisibleContentPosition={{ data: false, size: false }}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        // Recycle card instances rather than remounting per reuse — SeriesCard is now recycle-safe
        // (resets its per-item state synchronously on entry change), so scrolling reuses cards
        // instead of paying a fresh heavy mount for every row that scrolls into view.
        recycleItems
        ListHeaderComponent={listHeader}
        // LegendList takes gap keys only in columnWrapperStyle (column gap); the outer inset +
        // centering come from contentContainerStyle's paddingLeft/Right (= sidePad), and the
        // header/footer bleed Spacing.four back out so their self-padded children line up.
        columnWrapperStyle={{ gap: GRID_COLUMN_GAP }}
        contentContainerStyle={{
          // Reserves the bar's resting height so the first row starts just below it — see the
          // list's leading comment above.
          paddingTop: headerHeight,
          paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        renderItem={({ item }) => {
          if (item.spacer) {
            return <View style={styles.gridCell} />;
          }
          return (
            <Animated.View style={[styles.gridCell, gridCellStyle]}>
              <SeriesCard
                entry={item}
                bridge={currentBridge?.name ?? undefined}
                bridgeId={bridgeId}
                direct={directBridge}
                originPage={page}
                cohort={gridScope}
                crossfading={switching}
              />
            </Animated.View>
          );
        }}
        // No footer skeleton for infinite-scroll pagination (`loadingMore`) — it was
        // unreliable on web (LegendList's web recycling/remeasure timing made it flicker
        // or vanish before the next page landed) and, per feedback, more trouble than it
        // was worth. Only the initial/scope-switch loading state still shows one.
        ListFooterComponent={
          (gridLoading || (homeLoading && composedHome && terminalGridPreview)) && gridItems.length === 0 ? (
            <GridSkeleton numColumns={numColumns} rows={2} />
          ) : null
        }
        onEndReachedThreshold={0.6}
        // `loadMore` self-guards to the terminal-home and results/favorites modes (and no-ops
        // in pure composed-home), so it's wired unconditionally — a conditional here otherwise
        // killed infinite scroll for page-flagged home lists (example-bridge) and the favorites page.
        onEndReached={loadMore}
        // Show the browser's native scrollbar on web (the list scrolls in its own
        // overflow container); keep it hidden on native, where it's not idiomatic.
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        // No native RefreshControl on any platform — pull-to-refresh is the custom overlay spinner
        // (see the two pull hooks above), consistent everywhere. Android's edge-stretch glow is
        // suppressed so it doesn't fight the custom pull; iOS keeps its bounce (that's what sources
        // the pull there), and a release past the threshold triggers the refresh via onScrollEndDrag.
        overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
        onScrollEndDrag={Platform.OS === 'ios' ? nativePull.onScrollEndDrag : undefined}
      />
      </Animated.View>
      {topBar}
      <PullIndicator
        pullY={customPull.pullY}
        pullThreshold={customPull.pullThreshold}
        refreshing={refreshing}
        top={headerHeight}
      />
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
  const mock = useMockActive();
  const queryClient = useQueryClient();
  // Same infinite-query pipeline as the main grid (`homeGrid` scope keyed on this section's list
  // id). Page 1 is seeded from the section itself via `initialData`, so no extra request fires on
  // Home; "Load more" pulls pages 2+.
  const query = useInfiniteQuery({
    queryKey: queryKeys.browseGrid(mock, bridgeId ?? '', { kind: 'homeGrid', listId: section.id }),
    queryFn: ({ pageParam, signal }) =>
      fetchBrowseScope(ds, bridgeId ?? '', { kind: 'homeGrid', listId: section.id }, pageParam, signal),
    enabled: !!bridgeId,
    initialPageParam: 1,
    getNextPageParam: (last: GridPage, _all: GridPage[], lastParam: number) =>
      last.hasNextPage ? lastParam + 1 : undefined,
    initialData: { pages: [{ items: section.items, hasNextPage: section.hasNextPage }], pageParams: [1] },
  });
  // When the underlying section changes (a Home refetch / pull-to-refresh brought fresh page-1
  // content), reset this block's cache to that fresh page 1 — matching the old reset-on-prop-change,
  // discarding any expanded "Load more" pages so the block never shows stale content after a refresh.
  useEffect(() => {
    queryClient.setQueryData(queryKeys.browseGrid(mock, bridgeId ?? '', { kind: 'homeGrid', listId: section.id }), {
      pages: [{ items: section.items, hasNextPage: section.hasNextPage }],
      pageParams: [1],
    });
  }, [section, mock, bridgeId, queryClient]);

  const flat = useDedupedPages(query.data);
  const items = query.data ? flat : section.items;
  const hasNextPage = !!query.hasNextPage;
  const loading = query.isFetchingNextPage;
  const loadMore = () => {
    if (!query.hasNextPage || query.isFetchingNextPage || !bridgeId) return;
    void query.fetchNextPage();
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
  // `gridCell` (not the bare `cell`) so this matches a real card's cell exactly — same
  // flex plus the same top/bottom padding as a real `gridCell`-wrapped `SeriesCard`.
  return (
    <View style={[styles.gridCell, styles.skelCell]}>
      <Skeleton style={styles.skelCover} />
      <Skeleton style={styles.skelLine} />
      <Skeleton style={[styles.skelLine, styles.skelLineShort]} />
    </View>
  );
}

/** Skeleton rows shown while a grid's first page loads (scope switch, retry, etc.) — mirrors
 *  the grid card (cover + two title lines) so it reads as "cards incoming". Infinite-scroll
 *  pagination itself shows no skeleton (see `ListFooterComponent`/`loadMore`). */
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
  noBridges: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  noBridgesIcon: {
    width: 128,
    height: 128,
    marginBottom: Spacing.two,
  },
  noBridgesTitle: {
    textAlign: 'center',
  },
  noBridgesDetail: {
    textAlign: 'center',
    maxWidth: 320,
  },
  // Absolute overlay, positioned from the screen top, fixed size — the whole bar slides
  // as one unit via `headerOffsetY`/`headerStyle` (see the comment above `topBar`'s JSX)
  // rather than changing height, hiding/revealing 1:1 with scroll-down/up but staying
  // pinned in place at/above the top (see `headerOffsetY`'s own comment).
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
  // Full-width scroll host so the scrollbar sits at the window edge; the content is centred by the
  // symmetric sidePad on contentContainerStyle instead (see the list's paddingLeft/Right).
  list: {
    flex: 1,
  },
  // Same as `list` — split out only because the web pull-to-refresh transform animates the
  // wrapping Animated.View (see its comment), while this stays on the actual scroller beneath it.
  listInner: {
    flex: 1,
  },
  // Cancels Spacing.four of the list's contentContainer side padding for header/footer blocks, whose
  // own children already self-pad by Spacing.four — so they line up with the grid cells.
  bleed: {
    marginHorizontal: -Spacing.four,
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  cell: {
    flex: 1,
  },
  // Main-grid cell only (not the header's HomeGridBlock / skeleton rows, which space themselves):
  // LegendList ignores contentContainerStyle `gap` vertically, so the inter-row gap lives here.
  // Split top+bottom (4 + 12 = the same 16 between rows) rather than all-bottom: LegendList's web
  // row container is `contain: paint`, so a card flush to the row's top edge has its highlight
  // ring's top stroke clipped — paddingTop reserves room for it.
  gridCell: {
    flex: 1,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three - Spacing.one,
  },
  skelFooter: {
    // No top padding: the list's content gap already separates the footer from
    // the last row, so matching it here keeps the loaded rows from popping up
    // when they replace the skeleton.
    gap: Spacing.three,
    // Bleed the list's contentContainer horizontal padding back out — the skeleton rows
    // self-pad via `styles.row`, same as the header children (see the bleed note above).
    marginHorizontal: -Spacing.four,
  },
  // Same column gap as the real grid's `columnWrapperStyle` (GRID_COLUMN_GAP) — this used to be
  // Spacing.three (double), so skeleton columns sat at different x-offsets than the real cards
  // that replace them.
  skelRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
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
