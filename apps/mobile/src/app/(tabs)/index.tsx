import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar } from '@/components/filters/filter-demo';
import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { Rail, SectionHead } from '@/components/rail';
import { Selector } from '@/components/selector';
import { SeriesCard } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing, TopBarHeight } from '@/constants/theme';
import { getBridges, getBridgeLists, isAbort, pageOptions, type Bridge } from '@/data/api';
import { mockGrid, mockHomeSections, type RailSection, type SeriesEntry } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

// Fallback selector contents used until the API responds (or if it's
// unreachable, e.g. SSO/CORS on the web preview) so the screen always renders.
const BRIDGES = ['MangaDex', 'comick', 'Batoto', 'WeebCentral', 'asura'];
const PAGES = ['home', 'popular', 'favorites'];

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

  // Home shows the rails; anything else (a search, a non-home page, or a rail's
  // "See all") drops to the flat results grid — mirrors the reference's
  // browse-view ⇄ results-pane toggle.
  const inResults = !!query || page !== 'home' || !!seeAll;

  const sections = useMemo(() => mockHomeSections(), []);
  const results = useMemo<SeriesEntry[]>(() => {
    if (seeAll) return seeAll.items;
    return mockGrid(query || page);
  }, [seeAll, query, page]);
  const resultsLabel = seeAll ? seeAll.title : query ? `Results for “${query}”` : page;

  // Infinite "Browse all" grid shown under the home rails. We reuse one page of
  // mock data and repeat it on each load (only the ids are re-keyed), per the
  // brief — a stand-in for paginated bridge results.
  const homeBase = useMemo(() => mockGrid('home', 24), []);
  const [homePages, setHomePages] = useState(1);
  const homeGrid = useMemo<SeriesEntry[]>(
    () =>
      Array.from({ length: homePages }).flatMap((_, p) =>
        homeBase.map((e) => ({ ...e, id: `${e.id}-p${p}` })),
      ),
    [homeBase, homePages],
  );

  const backToHome = () => {
    setQuery('');
    setSeeAll(null);
    setPage('home');
  };

  // See plan: hold the server's column count until mount to avoid a hydration
  // mismatch on the static web export (no viewport → width 0 → 3 columns).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const numColumns =
    !hydrated || width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));

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

  // Pinned bar: the bridge/page selectors stay at the top while content scrolls.
  const topBar = (
    <View
      style={[
        styles.topBar,
        { paddingTop: insets.top, minHeight: insets.top + TopBarHeight, borderBottomColor: theme.hairline },
      ]}>
      <Selector title="Bridge" value={bridge} options={bridgeOptions} onChange={setBridge} size="subtitle" />
      <Selector title="Page" value={page} options={pages} onChange={setPage} size="subtitle" />
    </View>
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
              <Rail key={s.id} section={s} onSeeAll={setSeeAll} />
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
      {topBar}
      <FlatList
        key={numColumns}
        data={gridData}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        ListHeaderComponent={listHeader}
        columnWrapperStyle={[styles.row, { gap: Spacing.three }]}
        contentContainerStyle={[
          styles.gridContent,
          { paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}
        renderItem={({ item }) =>
          item.spacer ? <View style={styles.cell} /> : (
            <View style={styles.cell}>
              <SeriesCard entry={item} />
            </View>
          )
        }
        onEndReachedThreshold={0.6}
        onEndReached={inResults ? undefined : () => setHomePages((p) => p + 1)}
        showsVerticalScrollIndicator={false}
      />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  cell: {
    flex: 1,
  },
});
