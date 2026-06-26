import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterBar } from '@/components/filters/filter-demo';
import { Selector } from '@/components/selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';

// Placeholder data sources. Bridges are intentionally mixed-case.
const BRIDGES = ['MangaDex', 'comick', 'Batoto', 'WeebCentral', 'asura'];
const PAGES = ['home', 'popular', 'favorites'];

const TITLES = [
  'The Silent Sea',
  'Crimson Harbor',
  'Paper Moons',
  'A Study in Ash',
  'Northern Lights',
  'The Glass Garden',
  'Echoes of Tomorrow',
  'Saltwater Hymns',
  'The Last Cartographer',
  'Velvet Machine',
  'Whisper of Pines',
  'Iron & Ink',
];

type Book = { id: number; title: string; spacer?: boolean };

const BOOKS: Book[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  title: TITLES[i % TITLES.length],
}));

export default function BrowseScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [bridge, setBridge] = useState(BRIDGES[0]);
  const [page, setPage] = useState(PAGES[0]);
  const numColumns = width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));

  // Pad to a full last row so flex:1 cards don't stretch on a partial row.
  const data = useMemo(() => {
    const remainder = BOOKS.length % numColumns;
    if (remainder === 0) return BOOKS;
    const spacers: Book[] = Array.from({ length: numColumns - remainder }, (_, i) => ({
      id: -1 - i,
      title: '',
      spacer: true,
    }));
    return [...BOOKS, ...spacers];
  }, [numColumns]);

  return (
    <ThemedView style={styles.container}>
      {/* Fixed header: bridge/page selectors stay pinned while the grid scrolls. */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.three }]}>
        <View style={styles.selectors}>
          <Selector title="Bridge" value={bridge} options={BRIDGES} onChange={setBridge} size="subtitle" />
          <Selector title="Page" value={page} options={PAGES} onChange={setPage} size="subtitle" />
        </View>
      </View>

      <FlatList
        key={numColumns}
        data={data}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        ListHeaderComponent={<ListHeader />}
        columnWrapperStyle={[styles.row, { gap: Spacing.three }]}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}
        renderItem={({ item }) => <BookCard book={item} />}
        showsVerticalScrollIndicator={false}
      />
    </ThemedView>
  );
}

function ListHeader() {
  return (
    <View style={styles.listHeader}>
      <ThemedView type="backgroundElement" style={styles.search}>
        <ThemedText themeColor="textSecondary">Search…</ThemedText>
      </ThemedView>
      <FilterBar />
    </View>
  );
}

function BookCard({ book }: { book: Book }) {
  if (book.spacer) return <View style={styles.card} />;
  return (
    <View style={styles.card}>
      <Image
        source={{ uri: `https://picsum.photos/seed/comical-${book.id}/300/450` }}
        style={styles.cover}
        contentFit="cover"
        transition={200}
      />
      <ThemedText type="small" numberOfLines={2} style={styles.title}>
        {book.title}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  selectors: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  listHeader: {
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  search: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  row: {
    // gap supplied inline so columns are evenly spaced
  },
  card: {
    flex: 1,
    gap: Spacing.two,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 12,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  title: {
    lineHeight: 18,
  },
});
