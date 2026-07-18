import type { LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarSurface } from '@/components/bar-surface';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { GridSkeleton } from '@/components/grid-skeleton';
import { SearchField } from '@/components/search-field';
import { SeriesGrid } from '@/components/series-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { libraryQuery } from '@/data/queries';
import { toLibraryCard, type LibraryGridItem } from '@/data/library-card';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useGridLayout } from '@/hooks/use-grid-layout';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/**
 * The dedicated Library search screen, pushed over the tabs from the Library tab's top-bar search
 * icon (mirrors Browse's `/search`). Unlike Browse search this is a CROSS-BRIDGE, server-side text
 * filter over the user's own library — so there's no bridge selector or filter bar, just the search
 * field over the same `SeriesGrid` the Library tab renders. Commit-on-submit (same as the tab's old
 * inline field); the library is always sorted by "recently added" here.
 */
export default function LibrarySearchScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hideNsfw = useHideNsfw();
  const barHeight = useTopBarHeight();
  const listRef = useRef<LegendListRef>(null);
  const ready = useDeferredMount();

  const [query, setQuery] = useState('');
  const { byId: bridgeById } = useBridgeMap();
  const { numColumns } = useGridLayout();

  const { data: items = undefined, isLoading } = useQuery(libraryQuery(ds, mock, query, 'added'));

  const cards = useMemo<LibraryGridItem[]>(() => {
    if (!items) return [];
    const visible = hideNsfw ? items.filter((e) => !bridgeById.get(e.bridgeId)?.nsfw) : items;
    return visible.map((e) => toLibraryCard(e, bridgeById.get(e.bridgeId)));
  }, [items, hideNsfw, bridgeById]);

  const topBarTotal = insets.top + barHeight;

  // Empty / loading messaging folded into the grid header, matching the Library tab.
  const emptyBody =
    !ready || isLoading || items === undefined ? (
      <GridSkeleton numColumns={numColumns} rows={2} />
    ) : cards.length === 0 ? (
      <View style={styles.hint}>
        <ThemedText style={styles.emptyTitle}>{query.trim() ? 'No matches' : 'Your library is empty'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDetail}>
          {query.trim() ? 'No series in your library match your search.' : 'Add series to your library to find them here.'}
        </ThemedText>
      </View>
    ) : null;

  const goBack = () => {
    hapticImpactLight();
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <BarSurface style={styles.topBar}>
        <View style={[styles.topBarRow, { height: barHeight }]}>
          <Pressable
            testID="library-search.back"
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
              testID="library-search.field"
              value={query}
              onSubmit={(q) => setQuery(q.trim())}
              onClear={() => setQuery('')}
              placeholder="Search library…"
              autoFocus
            />
          </View>
        </View>
      </BarSurface>

      {ready && (
        <SeriesGrid
          items={cards}
          scopeKey={query}
          listRef={listRef}
          header={emptyBody}
          paddingTop={topBarTotal + BarContentGap}
          paddingBottom={insets.bottom + Spacing.five}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  hint: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.six,
  },
  emptyTitle: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyDetail: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
