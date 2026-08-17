import type { LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';

import { useRouter } from '@/lib/nav';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { SearchIcon } from '@/components/icons/ui-icons';
import { LibraryCollectionSelector } from '@/components/library-collection-selector';
import { LibrarySortButton } from '@/components/library-sort-button';
import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { TabTitleBar } from '@/components/tab-title-bar';
import { CollectedItemsGrid } from '@/components/collections/collected-items-grid';
import { CollectedSortButton } from '@/components/collections/collected-sort-button';
import { SeriesGrid } from '@/components/series-grid';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, Spacing } from '@/constants/theme';
import { useCollectedView } from '@/data/collected-view';
import { collectionItemsQuery, libraryQuery, type LibraryView } from '@/data/queries';
import { toLibraryCard, type LibraryGridItem } from '@/data/library-card';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useCollections } from '@/hooks/use-collections';
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
  const router = useRouter();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('library', listRef);
  // UI-thread scroll offset for the tab bar's slide — `sharedValues` feeds it, `onScroll` only
  // keeps the bottom-bounce measurement in sync. See use-hide-tab-bar-on-scroll.
  const { sharedValues, onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the (non-recycled) card grid — until
  // this flips, the list holds empty data and the header shows a skeleton.
  const ready = useDeferredMount();

  // What the tab is showing: library series, or saved pages — each optionally scoped to one
  // collection. See LibraryView.
  const [view, setView] = useState<LibraryView>({ kind: 'series', collection: null });
  const collectionFilter = view.collection;
  // Sort is remembered per collection (persisted) — switching restores that view's last ordering.
  const [sort, setSort] = useLibrarySort(collectionFilter);
  const showingCollected = view.kind === 'collected';
  // Sort/dir/grouping for the saved-pages view — one persisted preference for the whole view, not
  // per collection (see the store's doc).
  const [collectedView, setCollectedView] = useCollectedView();

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
  const { collections } = useCollections();

  // Search + sort both fold into this one query and re-render the grid in place.
  const { data: items = undefined, error, isLoading, refetch } = useQuery({
    ...libraryQuery(ds, mock, query, sort, collectionFilter),
    enabled: !showingCollected,
  });

  // Saved pages. `type: 'page'` is NOT optional — a bare collected query returns the mixed
  // series/chapter/page union, and a grid that forgets it renders the wrong things silently.
  const collected = useQuery({
    ...collectionItemsQuery(ds, mock, {
      type: 'page',
      sort: collectedView.sort,
      dir: collectedView.dir,
      ...(view.collection ? { collection: view.collection } : {}),
      ...(query ? { q: query } : {}),
    }),
    enabled: showingCollected,
  });

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
  function renderCollectedEmpty() {
    if (collected.error) {
      return (
        <View style={styles.stateBlock}>
          <RetryBlock
            message={(collected.error as Error).message || 'Failed to load saved pages'}
            onRetry={collected.refetch}
          />
        </View>
      );
    }
    if (!ready || collected.isLoading || collected.data === undefined) {
      return <GridSkeleton numColumns={numColumns} rows={3} />;
    }
    if (collected.data === null) {
      return (
        <EmptyState
          title="Collections aren’t available here"
          detail="This server has no library. Switch to the remote server, or run bridges on this device, to save pages."
        />
      );
    }
    if (collected.data.length === 0) {
      if (query.trim()) {
        return <EmptyState title="No matches" detail="No saved pages match your search." />;
      }
      return (
        <EmptyState
          title="No saved pages yet"
          detail="While reading, tap the bookmark in the top bar to save a page to a collection."
        />
      );
    }
    return null;
  }

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
      if (collectionFilter) {
        return (
          <EmptyState
            title="This collection is empty"
            detail="Add series to this collection from a series page or a card’s long-press menu."
          />
        );
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
      {showingCollected ? (
        <CollectedItemsGrid
          items={ready ? (collected.data ?? []) : []}
          grouping={collectedView.grouping}
          // Every axis is in the key: a sort/dir/grouping switch is a scroll-to-top moment and must
          // reset recycled rows, exactly as a search or collection switch does.
          scopeKey={`pages|${query}|${view.collection ?? ''}|${collectedView.sort}|${collectedView.dir}|${collectedView.grouping}`}
          listRef={listRef}
          header={renderCollectedEmpty()}
          paddingTop={headerHeight + BarContentGap}
          paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
          sharedValues={sharedValues}
          onScroll={onScroll}
          onOpen={(item) =>
            // Straight back into the reader at that page — the series modal already accepts every
            // coordinate a saved page carries, so this needs no reader machinery of its own.
            router.push({
              pathname: '/series',
              params: {
                id: item.seriesId,
                bridgeId: item.bridgeId,
                reader: '1',
                chapterId: item.chapterId,
                start: String(item.pageIndex),
                title: item.seriesTitle,
              },
            })
          }
        />
      ) : (
        <SeriesGrid
          items={listData}
          scopeKey={`${query}|${sort}|${collectionFilter ?? ''}`}
          listRef={listRef}
          header={renderEmpty()}
          // Library cards carry an app-made sub (the bridge name), regardless of any bridge flag.
          hasSub
          paddingTop={headerHeight + BarContentGap}
          paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
          sharedValues={sharedValues}
          onScroll={onScroll}
        />
      )}

      {/* The sort button lives in the bar's trailing slot in BOTH states, so it stays put and visible
          while searching. Searching only swaps the LEADING content — the list selector becomes a back
          button + search field in place — and collapses the search icon (now redundant) beside sort. */}
      <TabTitleBar
        titleSlot={
          searching ? (
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
                  immediateFocus
                />
              </View>
            </View>
          ) : (
            <LibraryCollectionSelector value={view} collections={collections} onChange={setView} />
          )
        }
        right={
          <>
            {!searching && (
              <Pressable
                testID="library.search-icon"
                onPress={() => setSearching(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Search library"
                style={styles.searchIconButton}>
                <SearchIcon color={theme.text} size={22} />
              </Pressable>
            )}
            {/* Sort applies to the library grid only. The saved-pages view has its own sort/dir
                axes (Phase 3); showing this control there would be a lever that does nothing. */}
            {showingCollected ? (
              <CollectedSortButton value={collectedView} onChange={setCollectedView} />
            ) : (
              <LibrarySortButton value={sort} onChange={setSort} />
            )}
          </>
        }
      />
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
