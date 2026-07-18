import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarSurface } from '@/components/bar-surface';
import { BridgeThumb } from '@/components/bridge-thumb';
import { GridSkeleton } from '@/components/grid-skeleton';
import { ContentFeed } from '@/components/content-feed';
import { SearchIcon } from '@/components/icons/ui-icons';
import { RetryBlock } from '@/components/retry-block';
import { SeriesGrid } from '@/components/series-grid';
import { BridgeThumbSize, Selector } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PullIndicator } from '@/components/pull-indicator';
import { showToast } from '@/components/toast';
import { BarContentGap, BottomTabInset, MaxTopLevelWidth, Spacing, TopLevelGutter } from '@/constants/theme';
import { pageOptions } from '@/data/api';
import { toggleNsfwUntilRestart } from '@/data/nsfw';
import { buildHomeRows } from '@/data/content-rows';
import { useComicalExcludedIds } from '@/data/comical-home';
import { useCustomPages } from '@/data/custom-pages';
import { useCrossBridgeRails } from '@/hooks/use-cross-bridge-rails';
import { useCustomPageRows } from '@/hooks/use-custom-page-rows';
import { useFavoritesAvailability } from '@/hooks/use-favorites-available';
import { useDedupedPages } from '@/data/grid-pages';
import { fetchBrowseScope, homeSectionsQuery, queryKeys, type BrowseScope } from '@/data/queries';
import { COMICAL_BRIDGE_ID, COMICAL_ICON, isComicalBridge, useSelectedBridge } from '@/data/selected-bridge';
import { isRailLayout, useDataSource, useMockActive } from '@/data/source';
import type { Bridge, BridgeList, GridPage } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useIsLargeScreen, useTopBarHeight } from '@/hooks/use-responsive';
import { useSlidingBar } from '@/hooks/use-sliding-bar';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useRampedHold } from '@/hooks/use-ramped-hold';
import { useRevealDim } from '@/hooks/use-reveal-dim';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

// Stable, never-fetched keys for the two grid infinite queries while they're disabled (no active
// scope) — hooks must be called unconditionally, so a disabled query still needs a queryKey; these
// can't collide with a real `browseGrid` key (which always carries mock/bridgeId/scope).
const DISABLED_RESULTS_KEY = ['browseGrid', 'disabled', 'results'] as const;
const DISABLED_TERMINAL_KEY = ['browseGrid', 'disabled', 'terminal'] as const;
// Stable empty array so `useCrossBridgeRails` runs zero queries when Comical isn't selected.
const NO_BRIDGES: Bridge[] = [];
// The Comical bridge's icon is a bundled asset (not a remote URL), so the Bridge selector gets it as a
// local `source` rather than through the URL-keyed `thumbnails` map (which only holds real bridges).
const COMICAL_SOURCES: Record<string, number> = { [COMICAL_BRIDGE_ID]: COMICAL_ICON };

export default function BrowseScreen() {
  const ds = useDataSource();
  const queryClient = useQueryClient();
  const mock = useMockActive();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('browse', listRef);

  // ── Bridges ────────────────────────────────────────────────────────────
  // Selected bridge + its resolution live in a shared hook (`useSelectedBridge`) so the pushed
  // Search screen inherits whichever bridge Browse is on. `setBridge` writes the shared observable;
  // the crossfade's deferred commit (see `beginCrossfade`) still drives it.
  const {
    setBridge,
    bridges,
    visibleBridges,
    currentBridge,
    bridgeId,
    bridgeThumbnails,
    bridgeLabels,
    directBridge,
    bridgesError,
    bridgesLoaded,
    refetchBridges,
  } = useSelectedBridge();

  // ── Comical aggregate bridge ──────────────────────────────────────────────
  // When the synthetic "Comical" bridge is selected, the home is a cross-bridge fan-out (one rail per
  // real bridge) instead of the normal single-bridge composed home. The lists/home/terminal queries
  // below all gate off for it (`!isComical`), and ContentFeed is fed `comicalRails.rows` directly.
  const isComical = isComicalBridge(bridgeId);
  const realBridges = useMemo(() => visibleBridges.filter((b) => b.id !== COMICAL_BRIDGE_ID), [visibleBridges]);
  // Drop bridges the user excluded from the Comical home (per-bridge setting). Cross-bridge SEARCH is
  // unaffected — this only trims the home rails.
  const comicalExcluded = useComicalExcludedIds();
  const comicalRailBridges = useMemo(
    () => realBridges.filter((b) => !comicalExcluded[b.id]),
    [realBridges, comicalExcluded],
  );
  const comicalRails = useCrossBridgeRails(isComical ? comicalRailBridges : NO_BRIDGES, { mode: 'home' });
  // User-composed custom pages surface in Comical's Page selector alongside the built-in "Home" (the
  // featured aggregate). `activeCustomPage`/`customPageRows` are resolved below, once `page` exists.
  const customPages = useCustomPages();
  // The consolidated "Favorites" page: one rail per Comical-included bridge whose account favorites are
  // usable (favorites-capable AND logged in — see useFavoritesAvailability). A bridge with no login set
  // is simply absent, so its rail never appears. `favoritesRows`/`activeFavoritesPage` resolve below.
  const { isAvailable: favoritesAvailable } = useFavoritesAvailability();
  const comicalFavoritesBridges = useMemo(
    () => comicalRailBridges.filter((b) => favoritesAvailable(b.id)),
    [comicalRailBridges, favoritesAvailable],
  );

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
    // Comical is synthetic — it has no lists endpoint; its home fans out over real bridges instead.
    enabled: !!bridgeId && !isComical,
    placeholderData: keepPreviousData,
  });
  const lists = useMemo<BridgeList[]>(() => bridgeListsQuery.data ?? [], [bridgeListsQuery.data]);
  // "Lists are loaded for the CURRENT bridge" — resolved at least once AND not a keepPreviousData
  // placeholder from the previous bridge. Gates the Home fetch and the results scope so neither
  // fires off stale lists (the old `listsBridgeId === bridgeId` check).
  const listsSettled =
    !!bridgeId && (bridgeListsQuery.isSuccess || bridgeListsQuery.isError) && !bridgeListsQuery.isPlaceholderData;
  const [page, setPage] = useState('home');

  // The active custom page: Comical selected AND the page state is a custom page id (not 'home').
  // Undefined otherwise, which makes `useCustomPageRows` run zero queries and the home fall back to
  // the featured aggregate (`comicalRails`).
  const activeCustomPage = useMemo(
    () => (isComical && page !== 'home' ? customPages.find((p) => p.id === page) : undefined),
    [isComical, page, customPages],
  );
  const customPageRows = useCustomPageRows(activeCustomPage);

  // The consolidated Favorites page is active when Comical is selected and it's the chosen page. Its
  // rails fan out over `comicalFavoritesBridges` (the logged-in, favorites-capable bridges); NO_BRIDGES
  // otherwise, so the hook runs zero queries when the page isn't showing.
  const activeFavoritesPage = isComical && page === 'favorites';
  const favoritesRows = useCrossBridgeRails(activeFavoritesPage ? comicalFavoritesBridges : NO_BRIDGES, { mode: 'favorites' });

  // Default landing page for a bridge, applied once its lists settle: a bridge whose lists are ALL
  // page-flagged (no composed Home) opens on its first page instead of a blank Home; anything with a
  // home-eligible (or home-backing) list opens on Home. Ref-guarded to once per bridge so a later
  // lists refetch — or the user navigating to a sub-page — can't reset the page out from under them
  // (matches the old effect, which only re-picked on a bridge switch).
  const pageInitedForRef = useRef<string | null>(null);
  useEffect(() => {
    // Comical's Page selector is "Home" (the featured aggregate) plus the user's custom pages. Keep a
    // valid selection (Home, or a still-existing custom page id) but clear any stale page carried from
    // the previous bridge — otherwise a page like "Popular" would strand the selector on a dead label.
    if (isComical) {
      setPage((prev) => {
        if (prev === 'home') return prev;
        // Favorites survives only while at least one bridge qualifies (else it's not in the selector).
        if (prev === 'favorites') return comicalFavoritesBridges.length > 0 ? prev : 'home';
        return customPages.some((p) => p.id === prev) ? prev : 'home';
      });
      return;
    }
    if (!bridgeId || !listsSettled) return;
    if (pageInitedForRef.current === bridgeId) return;
    pageInitedForRef.current = bridgeId;
    const hasHomeList = lists.some((l) => !l.page || l.id === 'home');
    const firstPage = lists.find((l) => l.page);
    setPage(hasHomeList || !firstPage ? 'home' : firstPage.name.toLowerCase());
  }, [isComical, customPages, comicalFavoritesBridges, bridgeId, listsSettled, lists]);

  // Comical: "home" (featured aggregate), then "Favorites" (only when a bridge qualifies), then each
  // custom page id. Real bridge: its pageOptions — with favorites gated on the login being set.
  const pages = useMemo(
    () =>
      isComical
        ? ['home', ...(comicalFavoritesBridges.length > 0 ? ['favorites'] : []), ...customPages.map((p) => p.id)]
        : currentBridge
          ? pageOptions(lists, currentBridge.capabilities, favoritesAvailable(bridgeId))
          : ['home'],
    [isComical, comicalFavoritesBridges, customPages, lists, currentBridge, favoritesAvailable, bridgeId],
  );
  // The Page selector's option values for Comical are opaque page ids — map them back to display
  // names (and the built-in 'home' → "Home", 'favorites' → "Favorites"). Undefined for a real bridge
  // (its option values are already the human-readable page names).
  const pageLabels = useMemo(() => {
    if (!isComical) return undefined;
    const map: Record<string, string> = { home: 'Home', favorites: 'Favorites' };
    for (const p of customPages) map[p.id] = p.name;
    return map;
  }, [isComical, customPages]);
  // A `page: true` list with id "home" IS the Home tab's content (the bridge's front page): it
  // replaces the composed rails/grid Home entirely. Mirrors comical-web's selectHomeTab("home")
  // special case (app.ts) — without it the Home tab falls through to getHomeSections, which excludes
  // every `page` list, so a bridge whose only lists are page-flagged shows a permanently blank Home.
  const homeList = useMemo(() => lists.find((l) => l.id === 'home' && l.page), [lists]);
  // The built-in composed Home surface (rails + grid from non-`page` lists) — only when no page-list
  // backs the Home tab. Every "is this Home?" decision below keys off this, not a bare page === 'home'.
  // Comical is ALWAYS its composed (cross-bridge) home regardless of the `page` state — otherwise a
  // stale `page` carried over from the previous bridge (e.g. "Popular") would flip this false, route
  // Comical through the SeriesGrid branch, and strand its disabled results query as a permanent
  // placeholder → `gridUpdating` stuck true → the reveal dim never clears (a stuck crossfade).
  const composedHome = isComical || (page === 'home' && !homeList);
  // The list backing the current page: a `page: true` list picked in the selector (e.g. "Popular"),
  // or the home-backing list above when the Home tab is showing the bridge's front page.
  const selectedList = useMemo(
    () => (page === 'home' ? homeList : lists.find((l) => l.page && l.name.toLowerCase() === page)),
    [lists, page, homeList],
  );
  // The per-BRIDGE favorites page (a real bridge's account favorites as a flat results grid). Comical's
  // 'favorites' is the CONSOLIDATED page instead (`activeFavoritesPage`), rendered as rails — so exclude
  // Comical here, or its composed surface would be mistaken for a single-bridge favorites results grid.
  const isFavoritesPage = !isComical && page === 'favorites';

  // Search + filters now live on the pushed Search screen (`app/search.tsx`), reachable from this
  // screen's top bar. Browse itself is pure discovery: bridge/page selectors, rails, home grid,
  // "See all", favorites, and page-flagged list browsing (unfiltered).

  // ── Home rails + grid sections (composed Home surface) ─────────────────────
  // react-query with keepPreviousData (see homeSectionsQuery): a bridge switch keeps the prior
  // Home on screen until the new one resolves rather than clearing to a skeleton, so the shared
  // LegendList instance — and the filter bar in its header — never unmounts on a switch (that
  // remount was the reported flash). Gated on `composedHome` AND this bridge's lists being loaded
  // (`listsSettled`) so stale/empty lists can't make `composedHome` briefly true and fire a
  // spurious fetch for a page-only bridge.
  const homeQuery = useQuery(homeSectionsQuery(ds, mock, bridgeId ?? '', composedHome && listsSettled));
  // Force EMPTY for Comical: its home comes from `comicalRails`, not `homeQuery`. homeQuery is disabled
  // for Comical, but under keepPreviousData it still holds the PREVIOUS bridge's sections — which would
  // otherwise leave `terminalGridSection` non-null → `isHomeTerminal` true → `gridActive` true → the
  // reveal dim stuck on (the crossfade "fade sticking around"). See the crossfade block.
  const sections = useMemo(() => (isComical ? [] : (homeQuery.data?.sections ?? [])), [isComical, homeQuery.data]);
  const gridSections = useMemo(
    () => (isComical ? [] : (homeQuery.data?.gridSections ?? [])),
    [isComical, homeQuery.data],
  );
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
  // Memoized so a fresh `[]`/slice each render doesn't churn the `homeRows` memo that depends on it.
  const nonTerminalGridSections = useMemo(
    () => (gridSections.length > 1 ? gridSections.slice(0, -1) : []),
    [gridSections],
  );

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
  const nonTerminalGridListsPreview = useMemo(
    () => (gridListsPreview.length > 1 ? gridListsPreview.slice(0, -1) : []),
    [gridListsPreview],
  );

  // A rail's "See all" now pushes the standalone `/results` page (see ContentFeed's sectionHead), so
  // Browse no longer holds an inline drill-down scope. Only picking a page-flagged sub-list
  // ("Popular"/"Favorites") drops to the flat results grid; plain composed Home shows the rails.
  const inResults = !composedHome;

  // ── Grid derivations (which logical view the flat grid is showing) ─────────
  // These discriminators feed `resultsScope`/`terminalScope` below, which the infinite queries key
  // and fetch from.
  const activeListId = !composedHome ? (selectedList?.id ?? null) : null;
  const showResultsGrid = inResults;
  // Home's terminal grid section (the last one in `gridSections`) shares the
  // SAME scrollable FlatList + infinite scroll as results mode, not the
  // "Load more" blocks non-terminal sections get — so it feeds `gridItems` too.
  const isHomeTerminal = !inResults && composedHome && !!terminalGridSection;

  // The results scope ("See all" / a page-flagged list / favorites), or null when we're not showing
  // a results grid (pure composed Home, or Home's terminal section — handled below). Both the query
  // key and the fetch derive from this one value (see BrowseScope), which is what lets the grid move
  // between scopes without ever clearing to empty.
  const resultsScope = useMemo<BrowseScope | null>(() => {
    // Wait for the current bridge's lists to settle: `activeListId` derives from `lists`, so
    // computing a scope off the previous bridge's placeholder lists would fetch a list id that
    // doesn't exist on the new bridge (an "unknown list" / HTML-parse error). keepPreviousData keeps
    // the grid populated meanwhile.
    if (isHomeTerminal || !showResultsGrid || !bridgeId || !listsSettled) return null;
    if (isFavoritesPage) return { kind: 'favorites' };
    // A page-flagged list (e.g. "Popular") browsed unfiltered — refinement now happens on the
    // Search screen, so no `opts` here.
    if (activeListId) return { kind: 'list', listId: activeListId };
    return null;
  }, [isHomeTerminal, showResultsGrid, bridgeId, listsSettled, isFavoritesPage, activeListId]);

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

  // ── Full-home crossfade on a bridge OR page switch ────────────────────────
  // Both are a wholesale change of the surface, so dissolve the ENTIRE home (rails + grid, everything
  // in the list): fade it out, COMMIT the switch only once it's hidden, then fade the new content in.
  // Committing at opacity 0 is what makes it seamless for already-cached content too — it's available
  // instantly and would otherwise hard-cut before any fade. The commit is deferred by holding the
  // setBridge/setPage (+ setSeeAll) until the fade-out's completion callback (see `beginCrossfade` /
  // the two selectors); until then the OLD surface stays fully rendered and fades out as itself. The
  // bridge/page selector (topBar, outside the list) stays put throughout. A "See all" drill-down
  // keeps the lighter dim below, suppressed while `switching`.
  const XFADE_OUT_MS = 140;
  const XFADE_IN_MS = 200;
  // Hard cap on the hidden window — reveal whatever's there rather than ever leaving the home
  // stranded invisible if readiness somehow never resolves.
  const XFADE_MAX_WAIT_MS = 1800;
  const homeXfade = useSharedValue(1);
  const [switching, setSwitching] = useState(false);
  const [committed, setCommitted] = useState(false);
  // Both selectors (bridge AND page) drive the same crossfade, so the thing to swap at opacity 0 is
  // deferred generically: `beginCrossfade` stashes the caller's commit here, and `runPendingCommit`
  // fires it at the bottom of the fade-out. A ref (not a state closure) so the fade-out worklet
  // callback closes over one stable JS function regardless of which navigation started it.
  const pendingCommitRef = useRef<(() => void) | null>(null);
  // Run at the bottom of the fade-out (opacity 0): apply the deferred swap here, so the old→new
  // change is never on screen. Null-guarded and one-shot (clear before calling) so a cancelled
  // animation's stray callback — or a rapid re-tap that already committed — is a harmless no-op.
  const runPendingCommit = useCallback(() => {
    const commit = pendingCommitRef.current;
    pendingCommitRef.current = null;
    commit?.();
    setCommitted(true);
  }, []);
  // Start a full-home crossfade: fade to opacity 0, then commit `commit` while invisible. The
  // `if (finished)` guard is load-bearing — a second select mid-fade starts a NEW withTiming(0)
  // that cancels this one, whose callback then fires with finished=false; skipping it means we
  // never commit at a partial opacity (which would flash the swap). Only the latest (completing)
  // animation commits, running whatever `pendingCommitRef` holds by then — last tap wins.
  const beginCrossfade = useCallback(
    (commit: () => void) => {
      pendingCommitRef.current = commit;
      setSwitching(true);
      setCommitted(false);
      homeXfade.set(withTiming(0, { duration: XFADE_OUT_MS, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(runPendingCommit)();
      }));
    },
    [homeXfade, runPendingCommit],
  );
  // "The new bridge's home is ready to reveal": its content query has settled, or errored (so a
  // failed switch shows its Retry instead of stranding a blank home). Only consult `homeUpdating`
  // when the COMPOSED home actually drives the surface. A page-list bridge (home is a page-flagged
  // list, composedHome=false) has its home query DISABLED, and under keepPreviousData a disabled
  // query sits on the previous bridge's data as a permanent placeholder — so homeUpdating would be
  // stuck true forever and the crossfade would never fade back in, leaving the home invisible at
  // opacity 0 (a page-list bridge showed no home content). Such a home is ready on its grid alone.
  // `gridUpdating` is only meaningful when a grid actually backs the surface. A rails-only composed
  // home (no grid section) leaves the results query DISABLED, and under keepPreviousData a disabled
  // query that previously held results sits on them as a permanent placeholder — so `gridUpdating`
  // would be stuck true forever and the crossfade would only reveal via the cap (a ~1.8s invisible
  // hold), even with the home cached. Guard it the same way `homeUpdating` is guarded below.
  const gridActive = showResultsGrid || isHomeTerminal;
  const homeReady = isComical
    ? // Comical reveals as soon as it has ROWS (skeleton rows count — they fill in progressively), or
      // once the active surface has settled with none. Each Comical surface keys off its OWN hook:
      // Favorites and custom pages off theirs, the built-in featured home off the cross-bridge fan-out.
      activeFavoritesPage
      ? favoritesRows.rows.length > 0 || !favoritesRows.anyLoading
      : activeCustomPage
        ? customPageRows.rows.length > 0 || !customPageRows.anyLoading
        : comicalRails.rows.length > 0 || !comicalRails.anyLoading
    : !!homeError ||
      !!gridError ||
      ((gridActive ? !gridUpdating : true) && (composedHome ? !homeUpdating : true));
  useEffect(() => {
    // `committed` gates out the fade-out phase, when `homeReady` still reflects the outgoing bridge.
    if (!switching || !committed) return;
    const revealNow = () => {
      homeXfade.set(withTiming(1, { duration: XFADE_IN_MS, easing: Easing.out(Easing.quad) }));
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

  // Watchdog: the reveal above only fires once `committed` flips (in the fade-out's completion
  // callback). If that callback ever fails to fire — a cancelled/interrupted animation reporting
  // finished:false, a rapid re-select, a web reanimated hiccup — `committed` never becomes true, the
  // reveal effect returns early, and the home is stranded faded. This effect is NOT gated on
  // `committed`, so it force-completes the crossfade after the max wait: apply any pending commit and
  // fade back in. In normal operation the reveal clears `switching` in ~340ms, well before this fires.
  useEffect(() => {
    if (!switching) return;
    const t = setTimeout(() => {
      if (pendingCommitRef.current) runPendingCommit();
      homeXfade.set(withTiming(1, { duration: XFADE_IN_MS, easing: Easing.out(Easing.quad) }));
      setSwitching(false);
      setCommitted(false);
    }, XFADE_MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [switching, homeXfade, runPendingCommit]);

  // ── Within-page grid dim (a "See all" / list-scope refinement) ────────────
  // The kept grid eases to a dim while the new scope loads, then back to full — "refreshing", not
  // "swapping" (see useRevealDim, shared with the Search grid so the two can't drift). Suppressed
  // while `switching`: the full crossfade above owns a bridge/page change and this would fight it.
  // One shared animated style is reused across every grid cell (no per-cell hook — renderItem isn't
  // a component). Only the grid needs it: the composed-home rails are only ever placeholder-swapped
  // by a bridge change, which the crossfade already covers (homeUpdating ⇒ switching).
  // Gated by `gridActive` so a composed-home (rails) stale placeholder never dims — the per-cell
  // version only ever reached grid cells, which exist only when a grid backs the surface.
  const { value: revealDimSV } = useRevealDim(gridActive && gridUpdating && !switching);
  // Hoisted off the cells onto the list wrapper: ONE combined opacity instead of a Reanimated
  // Animated.View per card. homeXfade (bridge/page crossfade) and the reveal dim are mutually
  // exclusive, so multiply them into a single style (stacking two opacity styles would override).
  const listDimStyle = useAnimatedStyle(() => ({ opacity: homeXfade.value * revealDimSV.value }));

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
  // screen under the spinner (no skeleton). Passed to `usePullToRefresh` below, which holds it in a
  // ref — so this closure can freely change identity every render as the query objects do.
  const refreshCurrentView = () => {
    const jobs: Promise<unknown>[] = [];
    if (isComical) {
      jobs.push(
        activeFavoritesPage
          ? favoritesRows.refetch()
          : activeCustomPage
            ? customPageRows.refetch()
            : comicalRails.refetch(),
      );
    } else if (inResults) {
      if (resultsScope) jobs.push(resultsQuery.refetch());
    } else {
      jobs.push(homeQuery.refetch());
      if (isHomeTerminal) jobs.push(terminalQuery.refetch());
    }
    return Promise.all(jobs);
  };

  // Switching bridge or page is top-level navigation. A real bridge change runs through the
  // deferred-commit crossfade (see the crossfade block): fade the whole home out, commit (setBridge)
  // at opacity 0 so the swap is never seen, then fade the new bridge in. A no-op re-tap (or before
  // any bridge resolves) just commits immediately — nothing to dissolve.
  const selectBridge = (b: string) => {
    if (!currentBridge || b === currentBridge.id) {
      setBridge(b);
      return;
    }
    beginCrossfade(() => setBridge(b));
  };
  // A page switch is a top-level navigation too — a home↔page-list↔favorites swap of the whole
  // surface — so it runs the SAME crossfade as a bridge change (fade out, commit setPage at opacity
  // 0, fade the new page in) rather than the lighter grid dim. A no-op re-tap just commits immediately.
  const selectPage = (p: string) => {
    if (p === page) {
      setPage(p);
      return;
    }
    beginCrossfade(() => setPage(p));
  };

  // Hold the bridge icon to flip the session-only NSFW override: three haptic beats ramp up while
  // holding, then the flip commits (see useRampedHold) and a toast says what happened. A plain tap
  // still does nothing — the icon stays a passive identity mark otherwise.
  const nsfwHold = useRampedHold(() => {
    const result = toggleNsfwUntilRestart();
    showToast(
      result === 'enabled'
        ? 'NSFW enabled until the app is closed'
        : result === 'reverted'
          ? 'NSFW hidden again'
          : 'NSFW is already enabled in Settings',
    );
  });

  // Shared with the series-detail bar so both stay the same height.
  const barHeight = useTopBarHeight();
  // Match the bridge dropdown's thumbnail size so the bar reads at the same scale.
  const thumbSize = BridgeThumbSize;
  // Desktop shows an always-visible search pill in the top bar; mobile shows just a search icon.
  // Both open the pushed Search screen (search field in its own top bar, filters + results below).
  const isLargeScreen = useIsLargeScreen();
  const openSearch = () => router.push('/search');
  // Column count for the terminal-grid row chunking + skeletons (buildHomeRows). ContentFeed/SeriesGrid
  // derive their own full layout (incl. the rail viewport) from the same hook, so nothing can disagree.
  const { numColumns } = useGridLayout();
  // Logical scope string — drives ONLY the header/scroll reset effect below (not the list key), so
  // the collapsing top bar snaps back and the persisted list scrolls to top on a real scope change.
  const gridScope = [
    bridgeId ?? '',
    page,
    inResults ? 'r' : 'h',
    activeListId ?? '',
    isFavoritesPage ? 'fav' : '',
    isHomeTerminal ? 'term' : '',
  ].join('|');

  // Top bar: the bridge/page selectors sit in a fixed-height band (barHeight below
  // the safe-area inset), overlaid on the scrolling list. Unlike the old
  // expand-at-top/collapse-on-scroll animation, the bar itself never changes size —
  // instead it slides away as a whole (see `headerOffsetY` below), X/Twitter-style.
  const headerHeight = insets.top + barHeight;
  // The bridge/page bar slides away 1:1 with scroll (X/Twitter-style) via the shared `useSlidingBar`
  // helper — the same one the Search filter bar uses, so their motion can't drift. It's fed the
  // list's UI-thread scroll offset via `sharedValues` + the plain `onListScroll` (both wired on the
  // list below); a `gridScope` change snaps the bar back to visible and scrolls the list to the top.
  const { scrollY, maxScrollY, barStyle: headerStyle, sharedValues, onScroll: onListScroll } = useSlidingBar(
    headerHeight,
    { resetKey: gridScope, listRef },
  );
  // Bridge the same UI-thread offset back to JS for the mobile tab-bar auto-hide. `maxScrollY` rides
  // along so the tab bar can ignore the elastic bottom bounce, exactly as the top bar does — without
  // it, overscrolling the end of the grid slides the tab bar back in.
  const { reportOffset } = useHideTabBarOnScroll();
  useAnimatedReaction(
    () => scrollY.value,
    (y) => runOnJS(reportOffset)(y, maxScrollY.value),
    [reportOffset],
  );
  // The bar's bottom hairline fades in only once the list is scrolled: at the very top the bar reads
  // as part of the page (no divider), then the line appears to separate it from the content beneath.
  const headerBorderStyle = useAnimatedStyle(() => ({
    borderBottomColor: interpolateColor(scrollY.value, [0, 8], ['transparent', theme.hairline]),
  }));
  // Pull-to-refresh: gesture (per platform), spinner, min-visible window and content shift all live
  // in the shared hook — the same one the Search grid uses.
  const pull = usePullToRefresh(scrollY, refreshCurrentView);

  const topBar = (
    // BarSurface carries the frosted, full-bleed background + hairline shared by every bar in the
    // app (see bar-surface.tsx); the grid scrolls under it and shows through.
    <BarSurface style={[styles.topBar, { height: headerHeight }, headerStyle, headerBorderStyle]}>
      {/* Inner row capped to the content width so the selectors line up with the
          grid below, while the bar background stays full-bleed. */}
      {/* Cap+centre only on web; native fills the width so the bar aligns with the full-width grid. */}
      <View style={[styles.selectorRow, { height: barHeight, maxWidth: Platform.OS === 'web' ? MaxTopLevelWidth : undefined }]}>
        {currentBridge ? (
          <Pressable
            testID="browse.nsfw-hold"
            onPressIn={nsfwHold.onPressIn}
            onPressOut={nsfwHold.onPressOut}
            accessibilityRole="button"
            accessibilityLabel="Hold to show NSFW content until the app is closed"
            style={[styles.bridgeThumb, { width: thumbSize, height: thumbSize }]}>
            <BridgeThumb
              uri={currentBridge.thumbnail}
              source={isComical ? COMICAL_ICON : undefined}
              label={currentBridge.name}
              size={thumbSize}
              fill
            />
          </Pressable>
        ) : null}
        <Selector
          testID="browse.bridge-selector"
          title="Bridge"
          value={currentBridge?.id ?? ''}
          options={visibleBridges.map((b) => b.id)}
          onChange={selectBridge}
          size="subtitle"
          thumbnails={bridgeThumbnails}
          sources={COMICAL_SOURCES}
          labels={bridgeLabels}
        />
        <Selector testID="browse.page-selector" title="Page" value={page} options={pages} onChange={selectPage} size="subtitle" labels={pageLabels} />
        {isLargeScreen ? (
          // Desktop: an always-visible search pill in the middle of the bar. Pressing it opens the
          // (blank) Search screen — real typing happens there. `searchPillWrap`'s right margin
          // reserves room for the desktop tab-icon nav overlaid at the row's right edge (app-tabs).
          <View style={styles.searchPillWrap}>
            <Pressable
              testID="browse.search-pill"
              onPress={openSearch}
              accessibilityRole="button"
              accessibilityLabel="Search"
              style={styles.searchPill}>
              <ThemedView type="backgroundElement" style={styles.searchPillInner}>
                <SearchIcon color={theme.textSecondary} size={16} />
                <ThemedText type="small" themeColor="textSecondary">
                  Search…
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        ) : (
          // Mobile: just the lucide search icon, pushed to the trailing edge, until you're on the
          // Search screen (where the real field appears in its top bar).
          <Pressable
            testID="browse.search-icon"
            onPress={openSearch}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Search"
            style={styles.searchIconButton}>
            <SearchIcon color={theme.text} size={22} />
          </Pressable>
        )}
      </View>
    </BarSurface>
  );

  // Header for the flat results/favorites/page grid (SeriesGrid only): just a results error, if any.
  // A rail's "See all" now pushes the standalone /results page rather than an inline drill-down, so
  // there's no back banner here. The composed Home's rails/grid are virtualized rows of ContentFeed.
  const resultsHeader = gridError ? (
    <View style={styles.bleed}>
      <RetryBlock message={gridError} onRetry={() => resultsQuery.refetch()} />
    </View>
  ) : null;

  // The composed Home flattened into a typed row list for ContentFeed's virtualization. Same rail/grid
  // partition (and loading-skeleton shape) the old listHeader rendered inline, just as data. Only built
  // for the composed-Home surface; homeError shows a retry in the header instead (rows empty).
  const homeRows = useMemo(
    () =>
      isComical
        ? // Favorites and custom pages render their own composed rows; "Home" is the featured aggregate.
          activeFavoritesPage
          ? favoritesRows.rows
          : activeCustomPage
            ? customPageRows.rows
            : comicalRails.rows
        : inResults || homeError
          ? []
          : buildHomeRows({
              loading: homeLoading,
              numColumns,
              bridgeId: bridgeId ?? '',
              bridge: currentBridge?.name,
              direct: directBridge,
              sections,
              nonTerminalGridSections,
              terminalGridSection,
              gridItems,
              railListsPreview,
              nonTerminalGridListsPreview,
              terminalGridPreview,
            }),
    [
      isComical,
      activeFavoritesPage,
      favoritesRows.rows,
      activeCustomPage,
      customPageRows.rows,
      comicalRails.rows,
      inResults,
      homeError,
      homeLoading,
      numColumns,
      bridgeId,
      currentBridge?.name,
      directBridge,
      sections,
      nonTerminalGridSections,
      terminalGridSection,
      gridItems,
      railListsPreview,
      nonTerminalGridListsPreview,
      terminalGridPreview,
    ],
  );
  const homeHeader = homeError ? <RetryBlock message={homeError} onRetry={() => homeQuery.refetch()} /> : null;

  // No REAL bridges installed (a successful empty load — not an error). Comical is still shown (it's
  // always present), so instead of a full-screen takeover we render the "add a registry" onboarding as
  // the Comical home body, beneath the Comical selector bar. A failed load shows the retry instead.
  const noBridges = bridgesLoaded && !bridgesError && bridges.length === 0;
  const onboardingBody = (
    <View style={styles.noBridges}>
      <Image style={styles.noBridgesIcon} source={require('@/assets/images/comical-logo.png')} />
      <ThemedText type="subtitle" style={styles.noBridgesTitle}>
        Comical
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.noBridgesDetail}>
        Add a registry to install bridges and start browsing series.
      </ThemedText>
      <Pressable testID="browse.manage-registries" onPress={() => router.push('/registries')} hitSlop={8}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          Manage registries
        </ThemedText>
      </Pressable>
    </View>
  );

  // Bridges FAILED to load and we have none cached — a full-screen retry (Comical can't aggregate
  // anything, and there's no selector to show yet).
  if (bridgesError && bridges.length === 0) {
    return (
      <ThemedView style={[styles.container, styles.centerFill]}>
        <RetryBlock message={bridgesError} onRetry={refetchBridges} />
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={styles.container}
      // Touch-driven pull-to-refresh for web + Android. Catching the raw touch events here (rather
      // than needing LegendList to forward them from wherever the touch actually started) works
      // regardless of what's under the finger. Empty on iOS, which sources its pull from the bounce.
      {...pull.touchHandlers}>
      {/* The list frame spans the full screen, from behind the topBar — its `paddingTop` reserves the
          bar's resting height so content starts below it; as the bar slides away the content already
          sitting there is revealed. Composed Home renders through ContentFeed (rails + terminal grid all
          virtualized rows); every OTHER surface (results / favorites / page-flagged list) is a flat
          uniform grid and stays on SeriesGrid, unchanged. The two only swap on a page/See-all
          navigation — a page/bridge swap is hidden by the opacity-0 crossfade; a See-all/exit is the
          lighter within-surface transition (a brief remount + skeleton, acceptable for a drill-down).
          `!inResults` ⟺ composed Home with no See-all, so it's the ContentFeed gate. */}
      {noBridges ? (
        // No real bridges to aggregate — the "add a registry" onboarding, below the Comical bar.
        <View style={[styles.container, styles.centerFill, { paddingTop: headerHeight }]}>{onboardingBody}</View>
      ) : !inResults ? (
        <ContentFeed
          rows={homeRows}
          scopeKey={gridScope}
          listRef={listRef}
          header={homeHeader}
          // Terminal-grid first-load skeleton (footer). During homeLoading the terminal rows aren't
          // built yet; this fills that gap the way GridSkeleton did for the old shared list.
          terminalLoading={homeLoading && !!terminalGridPreview}
          paddingTop={headerHeight + BarContentGap}
          paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
          // Comical: no feed-level bridge — every rail carries its own BridgeScope so its cards open
          // the correct real bridge. A single-bridge home passes its one bridge as the fallback.
          bridge={isComical ? undefined : (currentBridge?.name ?? undefined)}
          bridgeId={isComical ? undefined : bridgeId}
          direct={isComical ? undefined : directBridge}
          originPage={page}
          crossfading={switching}
          sharedValues={sharedValues}
          onScroll={onListScroll}
          // Drives terminalQuery.fetchNextPage — `loadMore` self-guards to the terminal-home mode.
          onEndReached={loadMore}
          onScrollEndDrag={pull.onScrollEndDrag}
          // The pull-to-refresh content shift and the refinement dim both ride the list wrapper.
          wrapperStyle={[pull.listStyle, listDimStyle]}
        />
      ) : (
        <SeriesGrid
          items={gridItems}
          scopeKey={gridScope}
          listRef={listRef}
          header={resultsHeader}
          // No footer skeleton for infinite-scroll pagination (`loadingMore`) — unreliable on web. Only
          // the initial / scope-switch loading state still shows one.
          footer={gridLoading && gridItems.length === 0 ? <GridSkeleton numColumns={numColumns} rows={2} /> : null}
          paddingTop={headerHeight + BarContentGap}
          paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
          bridge={currentBridge?.name ?? undefined}
          bridgeId={bridgeId}
          direct={directBridge}
          originPage={page}
          crossfading={switching}
          sharedValues={sharedValues}
          onScroll={onListScroll}
          // `loadMore` self-guards to results/favorites modes, so it's wired unconditionally.
          onEndReached={loadMore}
          onScrollEndDrag={pull.onScrollEndDrag}
          // The pull-to-refresh content shift and the refinement dim both ride the list wrapper.
          wrapperStyle={[pull.listStyle, listDimStyle]}
        />
      )}
      {topBar}
      <PullIndicator {...pull.indicator} top={headerHeight} />
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
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    // The shared card-surface gutter, so the bridge thumb/selectors keep lining up with the grid's
    // left edge below.
    paddingHorizontal: TopLevelGutter,
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
  // Cancels the gutter of the list's contentContainer side padding for header/footer blocks, whose
  // own children already self-pad by TopLevelGutter — so they line up with the grid cells.
  bleed: {
    marginHorizontal: -TopLevelGutter,
  },
  row: {
    paddingHorizontal: TopLevelGutter,
  },
  // NO `flex: 1` — pinned to `cardWidth` at the call site, so a short last row ends rather than
  // stretching its cards (which is what the old spacer views existed to prevent).
  cell: {},
  // Desktop search pill: takes the middle of the selector row (flex), capped so it reads as a
  // search bar, with a right margin reserving space for the desktop tab-icon nav (app-tabs).
  searchPillWrap: {
    flex: 1,
    alignItems: 'center',
    marginRight: 200,
  },
  searchPill: {
    width: '100%',
    maxWidth: 420,
  },
  searchPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  // Mobile search icon: pushed to the trailing edge of the selector row.
  searchIconButton: {
    marginLeft: 'auto',
    padding: Spacing.one,
  },
});
