import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar } from '@/components/filters/filter-demo';
import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { Rail, SectionHead } from '@/components/rail';
import { Selector } from '@/components/selector';
import { SeriesCard } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing, TopBarHeight } from '@/constants/theme';
import { getBridges, getBridgeLists, isAbort, pageOptions, type Bridge } from '@/data/api';
import { mockGrid, mockHomeSections, PAGE_LOAD_DELAY_MS, type RailSection, type SeriesEntry } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

// Fallback selector contents used until the API responds (or if it's
// unreachable, e.g. SSO/CORS on the web preview) so the screen always renders.
const BRIDGES = ['MangaDex', 'comick', 'Batoto', 'WeebCentral', 'asura'];
const PAGES = ['home', 'popular', 'favorites'];

// Bridges that serve "direct" series (a single work of page images — thumbnails
// + read, no chapter list). Real bridges report this via capabilities; this set
// designates one in the offline mock fallback so the view is reachable in the
// web preview where the API is unreachable.
const DIRECT_BRIDGES = new Set(['asura']);

// Breathing room above the bridge/page selectors at rest. It collapses into the
// compact fixed bar as the page scrolls (mirrors the reference's ~2rem of space
// above #app-header before it sticks).
const HEADER_EXTRA = Spacing.five;

type GridItem = SeriesEntry & { spacer?: boolean };

export default function BrowseScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // Bridges fetched from the backend; falls back to BRIDGES until/unless loaded.
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [bridge, setBridge] = useState(BRIDGES[0]);
  const [pages, setPages] = useState<string[]>(PAGES);
  const [page, setPage] = useState(PAGES[0]);

  const bridgeOptions = bridges.length ? bridges.map((b) => b.name) : BRIDGES;
  // Direct = the selected bridge serves page-thumbnail series instead of
  // chapters. Prefer the live bridge's capabilities; fall back to the mock set.
  const currentBridge = bridges.find((b) => b.name === bridge);
  const directBridge = currentBridge
    ? currentBridge.capabilities.includes('direct')
    : DIRECT_BRIDGES.has(bridge);

  // Load the bridge list once; keep the fallback on any failure.
  useEffect(() => {
    const ctrl = new AbortController();
    getBridges(ctrl.signal)
      .then((bs) => {
        if (bs.length) {
          setBridges(bs);
          setBridge(bs[0].name);
        }
      })
      .catch((e) => {
        if (!isAbort(e)) console.warn('getBridges failed; using fallback:', e.message);
      });
    return () => ctrl.abort();
  }, []);

  // Populate the page selector from the selected bridge's lists.
  useEffect(() => {
    const b = bridges.find((x) => x.name === bridge);
    if (!b) {
      setPages(PAGES);
      return;
    }
    const ctrl = new AbortController();
    getBridgeLists(b.id, ctrl.signal)
      .then((lists) => {
        const opts = pageOptions(lists, b.capabilities);
        setPages(opts);
        setPage(opts[0]);
      })
      .catch((e) => {
        if (!isAbort(e)) {
          console.warn('getBridgeLists failed; using fallback:', e.message);
          setPages(PAGES);
        }
      });
    return () => ctrl.abort();
  }, [bridge, bridges]);

  // Committed search query (set on submit) and the active "See all" rail, if any.
  const [query, setQuery] = useState('');
  const [seeAll, setSeeAll] = useState<RailSection | null>(null);

  // Only a search or a rail's "See all" drops to the flat results grid (with a
  // back-to-home affordance). Every top-level page — home included — is its own
  // full page of rails + grid, switched via the Page selector, so changing page
  // never shows a back button.
  const inResults = !!query || !!seeAll;

  const sections = useMemo(() => mockHomeSections(page), [page]);
  const results = useMemo<SeriesEntry[]>(() => {
    if (seeAll) return seeAll.items;
    return mockGrid(query || page);
  }, [seeAll, query, page]);
  const resultsLabel = seeAll ? seeAll.title : query ? `Results for “${query}”` : page;

  // Infinite "Browse all" grid shown under the home rails. We reuse one page of
  // mock data and repeat it on each load (only the ids are re-keyed), per the
  // brief — a stand-in for paginated bridge results.
  const homeBase = useMemo(() => mockGrid(page, 24), [page]);
  const [homePages, setHomePages] = useState(1);
  // Each page is its own surface: restart the infinite "Browse all" depth when
  // the page changes so a new page doesn't inherit the previous one's depth.
  useEffect(() => setHomePages(1), [page]);
  const [loadingMore, setLoadingMore] = useState(false);
  const homeGrid = useMemo<SeriesEntry[]>(
    () =>
      Array.from({ length: homePages }).flatMap((_, p) =>
        homeBase.map((e) => ({ ...e, id: `${e.id}-p${p}` })),
      ),
    [homeBase, homePages],
  );

  // Load the next page after a simulated delay so the loading footer is visible.
  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setHomePages((p) => p + 1);
      setLoadingMore(false);
    }, PAGE_LOAD_DELAY_MS);
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
  const numColumns =
    !hydrated || width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));
  // Single hydration-safe viewport width for the rails: a deterministic mobile
  // fallback during prerender/first paint, the real width once mounted.
  const railViewport = hydrated ? width : 390;

  // Home shows the infinite "Browse all" grid under the rails; results mode
  // shows the (finite) search / "See all" / page grid.
  const baseGrid = inResults ? results : homeGrid;
  const gridData = useMemo<GridItem[]>(() => {
    const remainder = baseGrid.length % numColumns;
    if (remainder === 0) return baseGrid;
    const spacers: GridItem[] = Array.from({ length: numColumns - remainder }, (_, i) => ({
      id: `spacer-${i}`,
      title: '',
      cover: '',
      spacer: true,
    }));
    return [...baseGrid, ...spacers];
  }, [baseGrid, numColumns]);

  // Collapsing top bar. At rest the bridge/page selectors sit below a band of
  // breathing room (HEADER_EXTRA); as the page scrolls that band collapses into
  // the compact fixed bar — selectors centred in a TopBarHeight band below the
  // safe-area inset — and a divider fades in. Driven on the UI thread so it
  // tracks the scroll without per-frame re-renders.
  const headerMin = insets.top + TopBarHeight;
  const headerMax = headerMin + HEADER_EXTRA;
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // Collapse the breathing room by sliding the bar up (a compositor transform)
  // rather than animating its height, which would force a layout reflow every
  // frame and judder — especially on web. The bar keeps its full (expanded)
  // height; translating it up by HEADER_EXTRA leaves the compact bar pinned.
  const headerCollapseStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(Math.max(scrollY.value, 0), HEADER_EXTRA) }],
  }));
  const hairline = theme.hairline;
  const headerDividerStyle = useAnimatedStyle(() => ({
    borderBottomColor: interpolateColor(scrollY.value, [0, HEADER_EXTRA], ['rgba(0,0,0,0)', hairline]),
  }));

  const topBar = (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.topBar,
        { height: headerMax, paddingTop: insets.top, backgroundColor: theme.background },
        headerCollapseStyle,
        headerDividerStyle,
      ]}>
      <View pointerEvents="box-none" style={styles.selectorRow}>
        <Selector title="Bridge" value={bridge} options={bridgeOptions} onChange={selectBridge} size="subtitle" />
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
      <FilterBar />
      {inResults && (
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

  // The list header holds the controls, and — on home — the rails followed by
  // the "Browse all" section heading. The grid (results or infinite home) then
  // renders beneath it, so everything scrolls as one surface.
  const listHeader = (
    <View>
      {controls}
      {!inResults && (
        <>
          <View style={styles.rails}>
            {sections.map((s) => (
              <Rail
                key={s.id}
                section={s}
                viewportWidth={railViewport}
                onSeeAll={setSeeAll}
                bridge={bridge}
                direct={directBridge}
              />
            ))}
          </View>
          <View style={styles.browseAllHead}>
            <SectionHead title="Browse all" />
          </View>
        </>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      {/* The list fills the screen (behind the header overlay); its top padding
          clears the expanded header so the first content sits just below it. */}
      <Animated.FlatList
        key={numColumns}
        data={gridData}
        keyExtractor={(item: GridItem) => String(item.id)}
        numColumns={numColumns}
        ListHeaderComponent={listHeader}
        columnWrapperStyle={[styles.row, { gap: Spacing.three }]}
        contentContainerStyle={[
          styles.gridContent,
          { paddingTop: headerMax, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}
        renderItem={({ item }: { item: GridItem }) =>
          item.spacer ? <View style={styles.cell} /> : (
            <View style={styles.cell}>
              <SeriesCard entry={item} bridge={bridge} direct={directBridge} />
            </View>
          )
        }
        ListFooterComponent={
          !inResults && loadingMore ? <GridSkeleton numColumns={numColumns} rows={2} /> : null
        }
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onEndReachedThreshold={0.6}
        onEndReached={inResults ? undefined : loadMore}
        showsVerticalScrollIndicator={false}
      />
      {topBar}
    </ThemedView>
  );
}

function SearchField({
  value,
  onSubmit,
  onClear,
}: {
  value: string;
  onSubmit: (q: string) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value);
  // Keep the field in sync when the committed query is cleared elsewhere (Home).
  useEffect(() => setText(value), [value]);
  return (
    <ThemedView type="backgroundElement" style={styles.search}>
      <SearchIcon color={theme.textSecondary} size={16} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSubmit(text)}
        placeholder="Search…"
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.searchInput, { color: theme.text }]}
      />
      {text.length > 0 && (
        <Pressable
          onPress={() => {
            setText('');
            onClear();
          }}
          hitSlop={8}
          accessibilityLabel="Clear search">
          <ClearIcon color={theme.textSecondary} size={14} />
        </Pressable>
      )}
    </ThemedView>
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
            <View key={c} style={[styles.cell, styles.skelCell]}>
              <Skeleton style={styles.skelCover} />
              <Skeleton style={styles.skelLine} />
              <Skeleton style={[styles.skelLine, styles.skelLineShort]} />
            </View>
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
    height: TopBarHeight,
  },
  controls: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
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
    gap: Spacing.five,
  },
  browseAllHead: {
    paddingTop: Spacing.five,
    paddingBottom: Spacing.two,
  },
  gridContent: {
    gap: Spacing.three,
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  cell: {
    flex: 1,
  },
  skelFooter: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
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
