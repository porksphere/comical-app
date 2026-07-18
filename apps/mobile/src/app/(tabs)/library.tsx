import type { LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SearchIcon } from '@/components/icons/ui-icons';
import { LibraryListSelector } from '@/components/library-list-selector';
import { RetryBlock } from '@/components/retry-block';
import { Selector } from '@/components/selector';
import { TabTitleBar } from '@/components/tab-title-bar';
import { SeriesGrid } from '@/components/series-grid';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, Spacing } from '@/constants/theme';
import { type LibrarySort } from '@/data/api';
import { libraryQuery, type LibraryListFilter } from '@/data/queries';
import { toLibraryCard, type LibraryGridItem } from '@/data/library-card';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useLibraryLists } from '@/hooks/use-library-lists';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

// Sort options shown in the header selector, mapped to the `/library?sort=` param.
const SORT_LABELS: Record<LibrarySort, string> = {
  added: 'Recently added',
  lastRead: 'Last read',
  title: 'Title',
  unread: 'Unread',
};
const SORT_ORDER: LibrarySort[] = ['added', 'lastRead', 'title', 'unread'];
const labelToSort = (label: string): LibrarySort => SORT_ORDER.find((s) => SORT_LABELS[s] === label) ?? 'added';

export default function LibraryScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const hideNsfw = useHideNsfw();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('library', listRef);
  const { onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the (non-recycled) card grid — until
  // this flips, the list holds empty data and the header shows a skeleton.
  const ready = useDeferredMount();

  const [sort, setSort] = useState<LibrarySort>('added');
  // Which custom list the grid is scoped to (null = all, 'unlisted', or a list id).
  const [listFilter, setListFilter] = useState<LibraryListFilter>(null);

  // Bridges resolve each entry's display name + direct-ness (each library card
  // carries its own bridge, unlike the Browse grid's single-bridge view).
  const { byId: bridgeById } = useBridgeMap();
  const { lists } = useLibraryLists();

  // Text search lives on its own pushed screen now (the top-bar search icon), so the tab always
  // shows the whole library (no `q`); it owns the sort + the selected custom-list filter.
  const { data: items = undefined, error, isLoading, refetch } = useQuery(
    libraryQuery(ds, mock, '', sort, listFilter),
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

  const listHeader = (
    <View style={styles.controls}>
      <View style={styles.controlsRow}>
        <Selector
          testID="library.sort"
          title="Sort by"
          value={SORT_LABELS[sort]}
          options={SORT_ORDER.map((s) => SORT_LABELS[s])}
          onChange={(label) => setSort(labelToSort(label))}
          size="small"
        />
      </View>
      {renderEmpty()}
    </View>
  );

  // Empty / degraded / loading messaging lives inside the (always-present)
  // header so the search + sort controls stay usable in every state.
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
      if (listFilter === 'unlisted') {
        return <EmptyState title="Nothing unlisted" detail="Every series in your library is in at least one list." />;
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
        scopeKey={`${sort}|${listFilter ?? ''}`}
        listRef={listRef}
        header={listHeader}
        // Library cards carry an app-made sub (the bridge name), regardless of any bridge flag.
        hasSub
        paddingTop={headerHeight + BarContentGap}
        paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
        onScroll={onScroll}
      />

      <TabTitleBar
        titleSlot={<LibraryListSelector value={listFilter} lists={lists} onChange={setListFilter} />}
        right={
          <Pressable
            testID="library.search-icon"
            onPress={() => router.push('/library-search')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Search library"
            style={styles.searchIconButton}>
            <SearchIcon color={theme.text} size={22} />
          </Pressable>
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
  controls: {
    // No leading padding: the grid's own `BarContentGap` is the bar->content gap now (it used to be
    // paid here instead, which is why adding the shared gap on top would have double-padded it).
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  searchIconButton: {
    padding: Spacing.one,
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
