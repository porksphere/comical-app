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
      <FlatList
        key={numColumns}
        data={data}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        ListHeaderComponent={
          <Header
            bridge={bridge}
            onBridgeChange={setBridge}
            page={page}
            onPageChange={setPage}
          />
        }
        columnWrapperStyle={[styles.row, { gap: Spacing.three }]}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.three, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}
        renderItem={({ item }) => <BookCard book={item} />}
        showsVerticalScrollIndicator={false}
      />
    </ThemedView>
  );
}

type HeaderProps = {
  bridge: string;
  onBridgeChange: (v: string) => void;
  page: string;
  onPageChange: (v: string) => void;
};

function Header({ bridge, onBridgeChange, page, onPageChange }: HeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.selectors}>
        <Selector title="Bridge" value={bridge} options={BRIDGES} onChange={onBridgeChange} size="subtitle" />
        <Selector title="Page" value={page} options={PAGES} onChange={onPageChange} size="subtitle" />
      </View>
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
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  selectors: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
