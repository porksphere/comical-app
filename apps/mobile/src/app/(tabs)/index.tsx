import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
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
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive, type QueryOpts } from '@/data/source';
import type { Bridge, BridgeList, HomeGridSection, RailSection, SeriesEntry } from '@/data/types';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
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
// Minimum time pull-to-refresh's spinner stays visible once triggered — see the
// `refreshStartedAtRef` comment below.
const REFRESH_MIN_VISIBLE_MS = 600;

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
    queryKey: ['bridges'],
    queryFn: ({ signal }) => ds.getBridges(signal),
  });
  const bridges = useMemo(() => bridgesQuery.data ?? [], [bridgesQuery.data]);
  const bridgesError = bridgesQuery.isError
    ? (bridgesQuery.error as Error).message || 'Failed to load bridges'
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
  const [lists, setLists] = useState<BridgeList[]>([]);
  // Which bridge `lists` were loaded for. Until this matches `bridgeId`, `lists` (and everything
  // derived from it — `homeList`, `composedHome`) is stale/empty and must not drive a fetch: on first
  // load `lists` is `[]`, which would momentarily look like "composed Home with no sections" and fire
  // getHomeSections against a bridge whose lists are all page-flagged (a spurious home-sections-empty).
  const [listsBridgeId, setListsBridgeId] = useState<string | null>(null);
  const [page, setPage] = useState('home');

  useEffect(() => {
    if (!bridgeId) return;
    const ctrl = new AbortController();
    ds.getBridgeLists(bridgeId, ctrl.signal)
      .then((ls) => {
        setLists(ls);
        setListsBridgeId(bridgeId);
        // The composed Home renders only `page: false` lists (the rest live in the page selector),
        // UNLESS a `page: true` list with id "home" backs the Home tab directly (handled below). A
        // bridge with neither has nothing to show on Home, so default to its first page instead of
        // stranding the user on a blank Home; a bridge with a home-eligible (or home-backing) list
        // still opens on Home as before.
        const hasHomeList = ls.some((l) => !l.page || l.id === 'home');
        const firstPage = ls.find((l) => l.page);
        setPage(hasHomeList || !firstPage ? 'home' : firstPage.name.toLowerCase());
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

  // ── Home rails + grid sections (only fetched while `page === 'home'`) ─────
  const [sections, setSections] = useState<RailSection[]>([]);
  const [gridSections, setGridSections] = useState<HomeGridSection[]>([]);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeReload, setHomeReload] = useState(0);
  const [homeLoading, setHomeLoading] = useState(false);

  useEffect(() => {
    // Wait until `lists` are actually this bridge's — otherwise stale/empty lists make `composedHome`
    // briefly true and fire a spurious fetch (and home-sections-empty log) for a page-only bridge.
    if (!bridgeId || listsBridgeId !== bridgeId || !composedHome) return;
    const ctrl = new AbortController();
    setHomeError(null);
    // Clear the previous bridge/visit's rails before fetching, so a switch shows
    // a loading skeleton instead of a stale flash of the old selection's content.
    // A pull-to-refresh (refreshActiveRef) is the exception: keep the current
    // rails on screen and let the RefreshControl spinner stand in for progress.
    const isRefresh = refreshActiveRef.current;
    if (!isRefresh) {
      setHomeLoading(true);
      setSections([]);
      setGridSections([]);
    }
    ds.getHomeSections(bridgeId, ctrl.signal)
      .then((res) => {
        setSections(res.sections);
        setGridSections(res.gridSections);
      })
      .catch((e) => {
        if (!isAbort(e)) setHomeError(e.message || 'Failed to load home');
      })
      .finally(() => {
        setHomeLoading(false);
        finishRefresh();
      });
    return () => ctrl.abort();
  }, [bridgeId, listsBridgeId, composedHome, ds, homeReload, finishRefresh]);
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

  // ── Grid (unified: a flagged page, favorites, search, or "See all") ───────
  // Home's own grid sections (terminal + non-terminal) are fetched separately
  // above; this is everything else, sharing one fetch/pagination pipeline.
  // "See all" keeps its existing simple behavior (browse that list's items,
  // page-only, no filters/sort/scoped-search) — those apply to the page-flagged
  // list / global search case below instead.
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

  const [gridItems, setGridItems] = useState<SeriesEntry[]>([]);
  const [gridPageNum, setGridPageNum] = useState(1);
  const [gridHasMore, setGridHasMore] = useState(false);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState<string | null>(null);
  const [gridReload, setGridReload] = useState(0);
  // Bumped by pull-to-refresh specifically — kept separate from `gridReload` (Retry) because
  // `gridReload` also feeds `gridScope`/`gridKey` below, and changing that key remounts
  // AnimatedLegendList. A Retry needs that remount (it's crossing the empty→populated boundary the
  // key exists to guard — see the `gridScope` comment). A refresh doesn't: content stays on screen
  // the whole time, so there's no such boundary, and remounting mid-gesture on any results page
  // (favorites, search, see-all, filtered/sorted lists) tore down the native ScrollView/
  // RefreshControl instance while the user's finger was still down, snapping it shut just like the
  // pre-min-duration-fix bug. Folded into the fetch effect's deps below to still trigger a refetch.
  const [gridRefreshTick, setGridRefreshTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Re-runs whichever fetch backs the *current* view: the composed Home surface
  // (rails + grid sections, via `homeReload`) when not in results, or the flat
  // results grid (search / "See all" / a page-flagged sub-page / favorites /
  // live filters+sort, via `gridRefreshTick`) otherwise. Unlike those reload paths'
  // normal firing (bridge/page switch etc.), a pull keeps the existing content
  // on screen and shows only the RefreshControl spinner — the two fetch effects
  // read `refreshActiveRef` to skip their content-clearing skeleton, and call
  // `finishRefresh` (declared above, before those effects) in their `finally`
  // once the fresh data has swapped in.
  const onRefresh = useCallback(() => {
    refreshActiveRef.current = true;
    refreshStartedAtRef.current = Date.now();
    setRefreshing(true);
    if (inResults) setGridRefreshTick((n) => n + 1);
    else setHomeReload((n) => n + 1);
  }, [inResults]);

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

  // Everything shown on the favorites page is, by definition, favorited — so warm the
  // per-series `isFavorite` cache to `true`. Opening one from here then paints ★ instantly
  // (and enabled) instead of gating the button on a fresh per-series status check. Mirrors
  // comical-web's `favoritesCache` pre-seed.
  const seedFavorited = (items: SeriesEntry[]) => {
    if (!isFavoritesPage || !bridgeId) return;
    for (const item of items) {
      queryClient.setQueryData(queryKeys.isFavorite(mock, bridgeId, item.id), true);
    }
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
    setGridError(null);
    setGridPageNum(1);
    // Clear the previous list's items before fetching — otherwise they stay on
    // screen (with no skeleton, since `gridItems.length` is non-zero) until the
    // new page swaps in, instead of showing a loading skeleton on the switch.
    // A pull-to-refresh (refreshActiveRef) is the exception: keep the current
    // results visible under the RefreshControl spinner rather than flashing to a
    // skeleton, then swap the fresh page in on resolve.
    const isRefresh = refreshActiveRef.current;
    if (!isRefresh) {
      setGridLoading(true);
      setGridItems([]);
    }
    fetchGrid(1)
      .then((res) => {
        setGridItems(res.items);
        setGridHasMore(res.hasNextPage);
        seedFavorited(res.items);
      })
      .catch((e) => {
        if (!isAbort(e)) setGridError(e.message || 'Failed to load results');
      })
      .finally(() => {
        setGridLoading(false);
        finishRefresh();
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeId, isHomeTerminal, terminalGridSection, showResultsGrid, isFavoritesPage, activeListId, query, seeAll, scopedSearch, committedFilters, committedSort, ds, gridReload, gridRefreshTick, finishRefresh]);

  const loadMore = () => {
    if (loadingMore || !gridHasMore || !bridgeId || (!isHomeTerminal && !showResultsGrid)) return;
    setLoadingMore(true);
    const nextPage = gridPageNum + 1;
    fetchGrid(nextPage)
      .then((res) => {
        setGridItems((prev) => [...prev, ...res.items]);
        setGridHasMore(res.hasNextPage);
        setGridPageNum(nextPage);
        seedFavorited(res.items);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

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
    // `hasActiveQuery` true and strand us in results. Reset every filter to its
    // neutral value (mirrors the bridge-load init) and drop the sort so the
    // banner dismisses and the underlying page actually returns.
    setFilterValues(Object.fromEntries(filterDefs.map((d) => [d.id, initialValue(d)])));
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
  // Center content in a full-width scroller (scrollbar at the window edge) via symmetric side
  // padding — LegendList drops paddingHorizontal / ignores alignSelf on its content container, so
  // explicit paddingLeft/Right is the reliable lever. The header/footer bleed Spacing.four of this
  // back out so their own self-padded children (controls, rails, section heads) stay aligned.
  const sidePad = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;
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

  // LegendList's web build resets its render state *during render* (`set$` in
  // `shouldResetFreshDataLayout`) whenever `data` goes empty→non-empty after it has already held
  // data — throwing "Cannot update a component while rendering a different component". Every grid
  // scope switch (see-all / search / sort / filter / bridge / page / retry) runs `setGridItems([])`
  // then refetches, so it hits this constantly.
  //
  // The reset only fires when `previousDataLength === 0` on a PERSISTED instance. So the robust
  // guard is to remount across the empty↔populated boundary itself: fold `gridData.length > 0` into
  // the list key. Then a 0→N fill is never seen by an existing instance — it's always a FRESH mount
  // whose first render already has the data (its initial render, which skips the reset path).
  // Keying on the boundary directly (rather than trying to enumerate every dep that clears the grid)
  // is what makes this total. `gridScope` additionally captures which logical view we're on so the
  // collapsing header's scroll offset can be reset per real scope change (see the effect below);
  // it's not load-bearing for the reset guard. `numColumns` forces a fresh grid on column changes.
  // Pagination only appends (length stays > 0), so it never remounts.
  const gridScope = [
    numColumns,
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
    gridReload,
  ].join('|');
  const gridKey = `${gridScope}|${gridData.length > 0 ? 'full' : 'empty'}`;

  // Top bar: the bridge/page selectors sit in a band (barHeight below the
  // safe-area inset) overlaid on the scrolling list. On narrow viewports the band
  // is taller at the very top and eases down to barHeight over the first
  // EXPAND_EXTRA px of scroll; on wider viewports `expand` is 0 so it stays
  // static. The collapse and the bottom divider are driven on the UI thread so
  // the bar tracks the scroll without per-frame re-renders.
  const expand = compact ? EXPAND_EXTRA : 0;
  const thumbGrowth = compact ? THUMB_GROWTH : 0;
  // Resting (collapsed) header height. The list's own frame starts here (see
  // `styles.list`'s inline `marginTop` below) rather than at the screen top —
  // `topBar` only overlays the list for the smaller `expand` sliver above that,
  // not its full height. This keeps the collapse animation's "list scrolls
  // underneath" trick (no per-frame relayout of the list itself) for that small
  // cosmetic overlap, while leaving the rest of the list's own ScrollView frame
  // genuinely uncovered — which matters for pull-to-refresh: iOS can only reveal
  // its overscroll gap within the ScrollView's own frame, so with the frame
  // starting at headerHeight instead of 0, most of a pull's reveal region no
  // longer sits behind the opaque, higher-zIndex `topBar` and its native spinner
  // becomes visible instead of painted behind it.
  const headerHeight = insets.top + barHeight;
  // AnimatedLegendList feeds the live scroll offset into `scrollY` on the UI thread via its
  // `sharedValues` prop (below) — the collapse animations read it directly. A reaction bridges the
  // same value back to JS for the tab-bar-hide, replacing the old useAnimatedScrollHandler+runOnJS
  // (LegendList doesn't take a worklet onScroll the way Animated.FlatList did).
  const scrollY = useSharedValue(0);
  const { reportOffset } = useHideTabBarOnScroll();
  useAnimatedReaction(
    () => scrollY.value,
    (y) => runOnJS(reportOffset)(y),
    [reportOffset],
  );
  // A scope switch remounts the list (see `gridScope`), so it comes back scrolled to the top — but
  // the fresh instance won't emit a scroll event to reset `scrollY` on its own, which would leave
  // the collapsing header stuck in its previous (collapsed) state. Snap the shared value back to 0
  // so the header re-expands to match the top-aligned fresh list.
  useEffect(() => {
    scrollY.value = 0;
  }, [gridScope, scrollY]);
  const hairline = theme.hairline;
  // 0 at the top → 1 once the bar has fully collapsed (and stays 1 thereafter).
  // When `expand` is 0 (wide viewports) it is always 1, i.e. fully collapsed.
  // `Math.abs` (rather than clamping negative offsets to 0) means a *pull*
  // collapses the bar too, over the same `expand` distance as a normal
  // downward scroll — otherwise the bar stayed pinned at its tallest for the
  // whole pull gesture (offset locked at 0 collapses to nothing), and that
  // extra `expand` px of height overlaid the top of the list's own frame the
  // entire time, still partly covering the native refresh spinner underneath
  // (see the `headerHeight` comment above). Collapsing it away within the
  // first `expand` px of drag clears that sliver almost immediately.
  const collapseProgress = (y: number) => {
    'worklet';
    return expand > 0 ? Math.min(Math.abs(y) / expand, 1) : 1;
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
    <ThemedView style={styles.container}>
      {/* The list's frame starts below the bar's resting height (its `marginTop`); its
          contentContainer top padding covers the remaining `expand` sliver the bar overlays. */}
      <AnimatedLegendList
        ref={listRef}
        key={gridKey}
        // Full-width scroller so the scrollbar sits at the window edge; content centered via the
        // symmetric sidePad below. Scroll offset flows into scrollY for the collapsing header.
        // `marginTop: headerHeight` starts the list's own frame below the bar's resting height —
        // see the `headerHeight` comment above.
        style={[styles.list, { marginTop: headerHeight }]}
        sharedValues={{ scrollOffset: scrollY }}
        data={gridData}
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
          // The list's own frame already starts at headerHeight (see `style` above), so only the
          // extra `expand` sliver needs padding here — enough for the first row to clear the bar at
          // its tallest; as the bar collapses by `expand`, content scrolls up by the same amount,
          // keeping the first row pinned just under the bar's bottom edge.
          paddingTop: expand,
          paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        renderItem={({ item }) =>
          item.spacer ? (
            // While a next page is actually loading, fill the last row's
            // remaining slots with skeleton cards (matching the footer's) instead
            // of an invisible spacer — otherwise the row reads as "done" and the
            // incoming skeleton rows below look like they jumped straight to a
            // fresh row rather than finishing this one first.
            loadingMore ? <SkeletonCard /> : <View style={styles.gridCell} />
          ) : (
            <View style={styles.gridCell}>
              <SeriesCard
                entry={item}
                bridge={currentBridge?.name ?? undefined}
                bridgeId={bridgeId}
                direct={directBridge}
                originPage={page}
              />
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
        onEndReachedThreshold={0.6}
        // `loadMore` self-guards to the terminal-home and results/favorites modes (and no-ops
        // in pure composed-home), so it's wired unconditionally — a conditional here otherwise
        // killed infinite scroll for page-flagged home lists (example-bridge) and the favorites page.
        onEndReached={loadMore}
        // Show the browser's native scrollbar on web (the list scrolls in its own
        // overflow container); keep it hidden on native, where it's not idiomatic.
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        // Pull-to-refresh: native only (a pull gesture isn't idiomatic on web,
        // and react-native-web's RefreshControl is a no-op). We deliberately do
        // NOT pass progressViewOffset ourselves: LegendList already folds the
        // contentContainer's paddingTop (now just `expand`, a handful of px —
        // see the `headerHeight`/list `style` comments above) into the
        // RefreshControl's progressViewOffset internally. Adding headerHeight on
        // top of that would double-count the frame offset that's now baked into
        // the list's own `marginTop`, shoving the spinner a full header-height
        // too low — off-screen, and on iOS past the natural pull distance so the
        // control reads as already-engaged and trips mid-pull instead of on
        // release.
        onRefresh={Platform.OS === 'web' ? undefined : onRefresh}
        refreshing={Platform.OS === 'web' ? false : refreshing}
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
  // `gridCell` (not the bare `cell`) so this matches a real card's cell exactly — same
  // flex plus the same top/bottom padding — since this also fills real grid rows directly
  // (the `loadingMore` last-row filler above), where it sits beside `gridCell`-wrapped
  // `SeriesCard`s and must match their box, not just approximate it via the footer skeleton.
  return (
    <View style={[styles.gridCell, styles.skelCell]}>
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
  // Absolute overlay, positioned from the screen top independent of the list's own
  // frame (which starts lower — see `headerHeight`/list `style` above) — the list only
  // scrolls underneath it for the `expand` sliver above the bar's resting height.
  // `justifyContent: flex-end` keeps the selector row pinned to the bottom of the band,
  // with the collapsing breathing room above it.
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
