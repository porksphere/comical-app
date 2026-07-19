import type { LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { SearchIcon } from '@/components/icons/ui-icons';
import { LibraryListSelector } from '@/components/library-list-selector';
import { LibrarySortButton } from '@/components/library-sort-button';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { TabTitleBar } from '@/components/tab-title-bar';
import { SeriesGrid } from '@/components/series-grid';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, Spacing } from '@/constants/theme';
import { libraryQuery, type LibraryListFilter } from '@/data/queries';
import { toLibraryCard, type LibraryGridItem } from '@/data/library-card';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useLibraryLists } from '@/hooks/use-library-lists';
import { useLibrarySort } from '@/hooks/use-library-sort';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

export default function LibraryScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const hideNsfw = useHideNsfw();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('library', listRef);
  const { onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the (non-recycled) card grid — until
  // this flips, the list holds empty data and the header shows a skeleton.
  const ready = useDeferredMount();

  // Which custom list the grid is scoped to (null = all, or a list id).
  const [listFilter, setListFilter] = useState<LibraryListFilter>(null);
  // Sort is remembered per list (persisted) — switching lists restores that list's last ordering.
  const [sort, setSort] = useLibrarySort(listFilter);

  // In-place search: the top-bar search icon swaps the bar's leading content for a search field
  // (no pushed screen). `query` is committed on submit and folds straight into the same grid query.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  // Bridges resolve each entry's display name + direct-ness (each library card
  // carries its own bridge, unlike the Browse grid's single-bridge view).
  const { byId: bridgeById } = useBridgeMap();
  const { lists } = useLibraryLists();

  // Search + sort both fold into this one query and re-render the grid in place.
  const { data: items = undefined, error, isLoading, refetch } = useQuery(
    libraryQuery(ds, mock, query, sort, listFilter),
  );

  // Reflect adds/removes made on the series detail (or a mode switch) when the
  // tab regains focus. Skips the very first focus (the query already fetched).
  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce) void refetch();
      else setFocusedOnce(true);
    }, [focusedOnce, refetch]),
  );

  const barHeight = useTopBarHeight();
  const headerHeight = insets.top + barHeight;
  // Column count for the skeleton only — SeriesGrid derives its own layout from the same hook.
  const { numColumns } = useGridLayout();

  const cards = useMemo<LibraryGridItem[]>(() => {
    if (!items) return [];
    const visible = hideNsfw ? items.filter((e) => !bridgeById.get(e.bridgeId)?.nsfw) : items;
    return visible.map((e) => toLibraryCard(e, bridgeById.get(e.bridgeId)));
  }, [items, hideNsfw, bridgeById]);

  // Held empty until `ready` so the tab switch isn't blocked mounting the grid.
  const listData = ready ? cards : [];

  // Empty / degraded / loading messaging lives in the grid header (the sort + search controls moved
  // up into the top bar), so it stays visible in every state.
  function renderEmpty() {
    if (error) {
      return (
        <View style={styles.stateBlock}>
          <RetryBlock message={(error as Error).message || 'Failed to load library'} onRetry={refetch} />
        </View>
      );
    }
    if (!ready || isLoading || items === undefined) return <GridSkeleton numColumns={numColumns} rows={3} />;
    if (items === null) {
      return (
        <EmptyState
          title="Library isn’t available here"
          detail="This server has no library. Switch to the remote server, or run bridges on this device, to keep a library."
        />
      );
    }
    if (cards.length === 0) {
      if (query.trim()) {
        return <EmptyState title="No matches" detail="No series in your library match your search." />;
      }
      if (listFilter) {
        return <EmptyState title="This list is empty" detail="Add series to this list from a series page or a card’s long-press menu." />;
      }
      return <EmptyState title="Your library is empty" detail="Open a series and tap “＋ Library” to add it here." />;
    }
    return null;
  }

  return (
    <ThemedView style={styles.container}>
      {/* The same grid Browse and Search render — every list-level concern (recycling, the web scroll
          bridge, the fling-jitter guard, cells, layout) lives in SeriesGrid, so the Library
          inherits all of it and configures none of it. `scopeKey` carries query/sort, which is what
          remounts the list on a search/sort switch (a scroll-to-top moment) and resets recycled cards. */}
      <SeriesGrid
        items={listData}
        scopeKey={`${query}|${sort}|${listFilter ?? ''}`}
        listRef={listRef}
        header={renderEmpty()}
        // Library cards carry an app-made sub (the bridge name), regardless of any bridge flag.
        hasSub
        paddingTop={headerHeight + BarContentGap}
        paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
        onScroll={onScroll}
      />

      {/* Searching swaps the bar's leading content (the list selector) for a back button + search
          field in place; the trailing icons collapse. Otherwise: list selector on the left, search +
          sort icons on the right (sort to the right of search). */}
      {searching ? (
        <TabTitleBar
          titleSlot={
            <View style={styles.searchRow}>
              <Pressable
                testID="library.search-close"
                onPress={closeSearch}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close search"
                style={styles.searchCloseButton}>
                <ChevronLeftIcon color={theme.text} />
              </Pressable>
              <View style={styles.searchWrap}>
                <SearchField
                  testID="library.search"
                  value={query}
                  onSubmit={(q) => setQuery(q.trim())}
                  onClear={() => setQuery('')}
                  placeholder="Search library…"
                  autoFocus
                />
              </View>
            </View>
          }
        />
      ) : (
        <TabTitleBar
          titleSlot={<LibraryListSelector value={listFilter} lists={lists} onChange={setListFilter} />}
          right={
            <>
              <Pressable
                testID="library.search-icon"
                onPress={() => setSearching(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Search library"
                style={styles.searchIconButton}>
                <SearchIcon color={theme.text} size={22} />
              </Pressable>
              <LibrarySortButton value={sort} onChange={setSort} />
            </>
          }
        />
      )}
    </ThemedView>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.empty}>
      <ThemedText style={styles.emptyTitle}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDetail}>
        {detail}
      </ThemedText>
    </View>
  );
}

function GridSkeleton({ numColumns, rows }: { numColumns: number; rows: number }) {
  return (
    <View style={styles.skelWrap}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={styles.skelRow}>
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
  searchIconButton: {
    padding: Spacing.one,
  },
  // Fills the bar's leading slot while searching: back button + a flexed search field.
  searchRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  searchCloseButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchWrap: {
    flex: 1,
  },
  cell: {
    flex: 1,
    // Row gap lives here: LegendList ignores contentContainerStyle `gap` vertically (items are
    // absolutely positioned), so each cell reserves the inter-row space itself. It's split across
    // top+bottom (4 + 12 = the same 16 between rows) rather than all on the bottom, because
    // LegendList's web row container is `contain: paint` — a card flush to the row's top edge has
    // its highlight ring's top stroke clipped, so paddingTop gives that stroke room.
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three - Spacing.one,
  },
  stateBlock: {
    paddingTop: Spacing.five,
  },
  empty: {
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
  skelWrap: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  skelRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
  skelCell: {
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
