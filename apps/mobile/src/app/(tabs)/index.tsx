import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar } from '@/components/filters/filter-demo';
import { ClearIcon, SearchIcon } from '@/components/icons/ui-icons';
import { Rail } from '@/components/rail';
import { Selector } from '@/components/selector';
import { SeriesCard } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { mockGrid, mockHomeSections, type RailSection, type SeriesEntry } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

const BRIDGES = ['MangaDex', 'comick', 'Batoto', 'WeebCentral', 'asura'];
const PAGES = ['home', 'popular', 'favorites'];

type GridItem = SeriesEntry & { spacer?: boolean };

export default function BrowseScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [bridge, setBridge] = useState(BRIDGES[0]);
  const [page, setPage] = useState(PAGES[0]);

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

  const gridData = useMemo<GridItem[]>(() => {
    const remainder = results.length % numColumns;
    if (remainder === 0) return results;
    const spacers: GridItem[] = Array.from({ length: numColumns - remainder }, (_, i) => ({
      id: `spacer-${i}`,
      title: '',
      cover: '',
      spacer: true,
    }));
    return [...results, ...spacers];
  }, [results, numColumns]);

  const controls = (
    <View style={styles.controls}>
      <View style={styles.selectors}>
        <Selector title="Bridge" value={bridge} options={BRIDGES} onChange={setBridge} size="subtitle" />
        <Selector title="Page" value={page} options={PAGES} onChange={setPage} size="subtitle" />
      </View>
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

  return (
    <ThemedView style={styles.container}>
      <View style={{ paddingTop: insets.top + Spacing.three }} />
      {inResults ? (
        <FlatList
          key={numColumns}
          data={gridData}
          keyExtractor={(item) => String(item.id)}
          numColumns={numColumns}
          ListHeaderComponent={controls}
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
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: BottomTabInset + insets.bottom + Spacing.five }}
          showsVerticalScrollIndicator={false}>
          {controls}
          <View style={styles.rails}>
            {sections.map((s) => (
              <Rail key={s.id} section={s} onSeeAll={setSeeAll} />
            ))}
          </View>
        </ScrollView>
      )}
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
        placeholder="Search… (press Enter)"
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
  controls: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  selectors: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
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
