import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RetryBlock } from '@/components/retry-block';
import { SearchField } from '@/components/search-field';
import { Selector } from '@/components/selector';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { type LibrarySort } from '@/data/api';
import { libraryQuery } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import type { Bridge, LibraryItem, SeriesEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

const GRID_COLUMN_GAP = Spacing.two;

// Sort options shown in the header selector, mapped to the `/library?sort=` param.
const SORT_LABELS: Record<LibrarySort, string> = {
  added: 'Recently added',
  lastRead: 'Last read',
  title: 'Title',
  unread: 'Unread',
};
const SORT_ORDER: LibrarySort[] = ['added', 'lastRead', 'title', 'unread'];
const labelToSort = (label: string): LibrarySort => SORT_ORDER.find((s) => SORT_LABELS[s] === label) ?? 'added';

type GridItem = (SeriesEntry & { bridgeId?: string; bridge?: string; direct?: boolean }) & { spacer?: boolean };

export default function LibraryScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const hideNsfw = useHideNsfw();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('library', listRef);
  const { onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the (non-recycled) card grid — until
  // this flips, the list holds empty data and the header shows a skeleton.
  const ready = useDeferredMount();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('added');

  // Bridges resolve each entry's display name + direct-ness (each library card
  // carries its own bridge, unlike the Browse grid's single-bridge view).
  const { byId: bridgeById } = useBridgeMap();

  const { data: items = undefined, error, isLoading, refetch } = useQuery(libraryQuery(ds, mock, query, sort));

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
  const numColumns = width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));
  // Center the grid inside a full-width scroller (so the scrollbar sits at the window edge, not the
  // content edge) by padding the sides symmetrically instead of capping+centering the list itself.
  // LegendList drops `paddingHorizontal` and ignores `alignSelf`/`marginHorizontal:auto` on its
  // content container, but honors explicit paddingLeft/Right — so this is the reliable lever.
  const sidePad = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;
  // Feeds LegendList's `estimatedItemSize` below — see the identical calc/comment in Browse's
  // `index.tsx`.
  const gridContentWidth = width - sidePad * 2;
  const cardWidth = (gridContentWidth - (numColumns - 1) * GRID_COLUMN_GAP) / numColumns;

  const cards = useMemo<GridItem[]>(() => {
    if (!items) return [];
    const visible = hideNsfw ? items.filter((e) => !bridgeById.get(e.bridgeId)?.nsfw) : items;
    return visible.map((e) => toCard(e, bridgeById.get(e.bridgeId)));
  }, [items, hideNsfw, bridgeById]);

  // Pad the final row with invisible spacers so cards keep their column width.
  const gridData = useMemo<GridItem[]>(() => {
    const remainder = cards.length % numColumns;
    if (remainder === 0) return cards;
    const spacers: GridItem[] = Array.from({ length: numColumns - remainder }, (_, i) => ({
      id: `spacer-${i}`,
      title: '',
      cover: '',
      spacer: true,
    }));
    return [...cards, ...spacers];
  }, [cards, numColumns]);

  // Held empty until `ready` so the tab switch isn't blocked mounting the grid.
  const listData = ready ? gridData : [];

  const listHeader = (
    <View style={styles.controls}>
      <View style={styles.controlsRow}>
        <View style={styles.searchWrap}>
          <SearchField
            value={query}
            onSubmit={(q) => setQuery(q.trim())}
            onClear={() => setQuery('')}
            placeholder="Search library…"
          />
        </View>
        <Selector
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
      return query.trim() ? (
        <EmptyState title="No matches" detail="No series in your library match your search." />
      ) : (
        <EmptyState title="Your library is empty" detail="Open a series and tap “＋ Library” to add it here." />
      );
    }
    return null;
  }

  return (
    <ThemedView style={styles.container}>
      <LegendList
        ref={listRef}
        // LegendList's web build resets its render state *during render* on an empty→non-empty data
        // swap after it has held data ("Cannot update a component while rendering a different
        // component"). Changing query/sort starts a fresh react-query (data → undefined → repopulate)
        // and a tab-focus refetch can too, so fold the empty↔populated boundary into the key: a 0→N
        // fill is then always a FRESH mount's initial render, which skips the reset path. query/sort
        // stay in the key so a search/sort switch (a scroll-to-top moment) also remounts cleanly.
        key={`${numColumns}|${query}|${sort}|${listData.length > 0 ? 'full' : 'empty'}`}
        // Cap + center on the scroll host itself, and flex it to fill height. LegendList's web
        // content-container sits inside a plain (non-flex) block scroller, so `alignSelf:'center'`
        // on contentContainerStyle is a no-op (left-pinned) and the host won't grow — unlike
        // FlatList. Doing it here fixes both the off-center grid and the short scrollbar.
        style={styles.list}
        data={listData}
        estimatedItemSize={estimatedCardHeight(cardWidth)}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        // Recycle card instances instead of remounting on every reuse: SeriesCard now resets its
        // per-item state (cover aspect, loaded, truncated, held) synchronously on entry change
        // (see its render-phase reset), so reuse is safe and far cheaper than mounting a fresh heavy
        // card per scroll row.
        recycleItems
        ListHeaderComponent={listHeader}
        columnWrapperStyle={numColumns > 1 ? { gap: GRID_COLUMN_GAP } : undefined}
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
          paddingLeft: sidePad,
          paddingRight: sidePad,
        }}
        renderItem={({ item }) => {
          if (item.spacer) return <View style={styles.cell} />;
          return (
            <View style={styles.cell}>
              <SeriesCard entry={item} bridge={item.bridge} bridgeId={item.bridgeId} direct={item.direct} />
            </View>
          );
        }}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        onScroll={onScroll}
      />

      {/* Static title band overlaid on top (matches Browse's top-bar height/inset). */}
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top,
            backgroundColor: theme.background,
            borderBottomColor: theme.hairline,
            pointerEvents: 'box-none',
          },
        ]}>
        <View style={[styles.titleRow, { height: barHeight }]}>
          <ThemedText numberOfLines={1} style={styles.title}>
            Library
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

function toCard(e: LibraryItem, bridge?: Bridge): GridItem {
  return {
    id: e.seriesId,
    title: e.title,
    cover: e.thumbnailUrl ?? '',
    sub: bridge?.name ?? e.bridgeId,
    ...(e.unread > 0 && { unread: e.unread }),
    bridgeId: e.bridgeId,
    ...(bridge?.name && { bridge: bridge.name }),
    direct: bridge?.capabilities.includes('direct') ?? false,
  };
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  controls: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
