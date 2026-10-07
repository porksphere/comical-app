import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';

import { useRouter } from '@/lib/nav';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LibraryCollectionSelector } from '@/components/library-collection-selector';
import { LibrarySortButton, SHOW_LABELS } from '@/components/library-sort-button';
import { RetryBlock } from '@/components/retry-block';
import { TabFilterField, TabFilterTrigger, useTabFilter } from '@/components/tab-filter';
import { TabTitleBar } from '@/components/tab-title-bar';
import { CollectedItemsGrid } from '@/components/collections/collected-items-grid';
import { CollectedSortButton } from '@/components/collections/collected-sort-button';
import { CollectionThumb } from '@/components/collections/collection-thumb';
import { BridgeThumbRadius, BridgeThumbSize } from '@/components/selector';
import { coverStyles } from '@/components/series-card';
import { SeriesGrid } from '@/components/series-grid';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, Spacing } from '@/constants/theme';
import { useCollectedView } from '@/data/collected-view';
import { collectionItemsQuery, libraryQuery } from '@/data/queries';
import { setSelectedCollection, useSelectedCollectionId } from '@/data/selected-collection';
import { toLibraryCard, type LibraryGridItem } from '@/data/library-card';
import { useWarmChapterPages, useWarmSeriesDetail } from '@/data/prefetch';
import { DIRECT_CHAPTER_ID, type ReadState } from '@/data/types';
import { encodeSeriesParam } from '@/lib/series-nav';
import { useDataSource, useMockActive } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useHasSidebar } from '@/hooks/use-content-width';
import { useCollections } from '@/hooks/use-collections';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { libraryGroupOf } from '@/data/library-grouping';
import { useLibraryGrouping, useLibraryShow, useLibrarySort } from '@/hooks/use-library-sort';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useGridLayout } from '@/hooks/use-grid-layout';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useIsDesktop, useTopBarHeight } from '@/hooks/use-responsive';
import { useVisibleByBridge } from '@/hooks/use-visible-by-bridge';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';

// What an empty grid says under each "Show" choice — the filter emptied it, not the library.
const SHOW_EMPTY: Record<ReadState, [title: string, detail: string]> = {
  unstarted: ['Everything’s been started', 'Every series in your library has a chapter read.'],
  behind: ['You’re all caught up', 'No series in your library has unread chapters.'],
  'caught-up': ['Nothing caught up', 'No series in your library is read up to its latest chapter.'],
  finished: ['Nothing finished', 'No completed series in your library is read to the end.'],
};

export default function LibraryScreen() {
  // Collections tiles warm what a tap will need — see the grid's `onWarm` below. (The series GRID's
  // own cards warm themselves, inside SeriesCard.)
  const warmDetail = useWarmSeriesDetail();
  const warmPages = useWarmChapterPages();
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('library', listRef);
  // UI-thread scroll offset for the tab bar's slide — `sharedValues` feeds it, `onScroll` only
  // keeps the bottom-bounce measurement in sync. See use-hide-tab-bar-on-scroll.
  const { sharedValues, onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the (non-recycled) card grid — until
  // this flips, the list holds empty data and the header shows a skeleton.
  const ready = useDeferredMount();

  // What the tab is showing: `null` = the library's series grid; a collection id = that
  // collection's CONTENTS — its series, chapters and saved pages, mixed. One axis, deliberately:
  // an earlier version split "collection" and "saved pages" into two selector sections, which read
  // as two competing lists of the same names.
  // Shared, not local: the sidebar's Collections group moves this too (see `selected-collection.ts`).
  const collectionFilter = useSelectedCollectionId();
  const setCollectionFilter = setSelectedCollection;
  const showingCollected = collectionFilter !== null;
  // Asked of the layout, not derived from width — see `useHasSidebar`.
  const railNav = useHasSidebar();
  // The library grid's sort + grouping (they only apply there; a collection view has its own axes
  // below). Grouping is client-side sectioning over the server-sorted list.
  const [sort, setSort] = useLibrarySort(null);
  const [grouping, setGrouping] = useLibraryGrouping();
  const [show, setShow] = useLibraryShow();
  const readState = show === 'all' ? null : show;
  // Sort/dir/grouping for a collection's contents view — remembered PER COLLECTION (see the
  // store's doc), so each one restores its own last-used axes.
  const [collectedView, setCollectedView] = useCollectedView(collectionFilter);

  // What's typed folds straight into the same grid query, debounced since each term is a fetch.
  const filter = useTabFilter();
  const term = useDebouncedValue(filter.query.trim(), 200);

  // Bridges resolve each entry's display name + direct-ness (each library card
  // carries its own bridge, unlike the Browse grid's single-bridge view).
  const { byId: bridgeById } = useBridgeMap();
  const { collections } = useCollections();
  // What the bar calls the current view: a collection by its name, the library grid by the tab's.
  const viewName = collectionFilter ? (collections.find((c) => c.id === collectionFilter)?.name ?? 'Library') : 'Library';

  // Search + sort both fold into this one query and re-render the grid in place.
  const { data: items = undefined, error, isLoading, refetch } = useQuery({
    // Collections no longer FILTER the series grid — they have their own contents view — so the
    // library query is always unscoped.
    ...libraryQuery(ds, mock, term, sort, null, readState),
    enabled: !showingCollected,
    placeholderData: keepPreviousData,
  });

  // Saved pages. `type: 'page'` is NOT optional — a bare collected query returns the mixed
  // series/chapter/page union, and a grid that forgets it renders the wrong things silently.
  const collected = useQuery({
    ...collectionItemsQuery(ds, mock, {
      // The collection's WHOLE contents — no type filter. Hiding two of the three kinds would make
      // a collection look emptier than it is.
      collection: collectionFilter ?? '',
      sort: collectedView.sort,
      dir: collectedView.dir,
      ...(term ? { q: term } : {}),
    }),
    enabled: showingCollected,
    // Held across a refined filter, not across a switch of collection — that would show the last
    // collection's contents under the new one's name.
    placeholderData: (prev, prevQuery) =>
      (prevQuery?.queryKey[2] as { collection?: string } | undefined)?.collection === (collectionFilter ?? '')
        ? prev
        : undefined,
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

  const visibleItems = useVisibleByBridge(items ?? undefined);
  const cards = useMemo<LibraryGridItem[]>(
    () => visibleItems.map((e) => toLibraryCard(e, bridgeById.get(e.bridgeId))),
    [visibleItems, bridgeById],
  );
  // The SAME rule for a collection's contents. It didn't have it, which is the bug: with NSFW off
  // the library grid hid those series and the collection listing them showed them anyway.
  const visibleCollected = useVisibleByBridge(collected.data ?? undefined);

  // A pinned section heading sits flush under the bar and draws its own rule, so the bar YIELDS its
  // own while one is up — see the same wiring on Browse. A shared value rather than React state so
  // the two rules trade on the same frame instead of the bar's leaving a frame or two late.
  const stickyPinned = useSharedValue(0);
  const barRuleStyle = useAnimatedStyle(
    () => ({ borderBottomColor: stickyPinned.value ? 'transparent' : theme.barHairline }),
    [theme.barHairline],
  );

  // Memoized so the grid's grouped-rows memo keys off a stable function per grouping choice.
  const groupOf = useMemo(() => libraryGroupOf(grouping) ?? undefined, [grouping]);

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
    if (visibleCollected.length === 0) {
      if (term) {
        return <EmptyState title="No matches" detail="Nothing in this collection matches your filter." />;
      }
      return (
        <EmptyState
          title="This collection is empty"
          detail="Save a series, chapter, or page into it — while reading, tap the bookmark in the top bar."
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
      if (term) {
        return <EmptyState title="No matches" detail="No series in your library match your filter." />;
      }
      if (readState) {
        const [title, detail] = SHOW_EMPTY[readState];
        return <EmptyState title={title} detail={`${detail} Showing “${SHOW_LABELS[readState]}” — change that from the sort menu.`} />;
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
          items={ready ? visibleCollected : []}
          grouping={collectedView.grouping}
          // Every axis is in the key: a sort/dir/grouping switch is a scroll-to-top moment and must
          // reset recycled rows, exactly as a search or collection switch does.
          scopeKey={`collected|${term}|${collectionFilter}|${collectedView.sort}|${collectedView.dir}|${collectedView.grouping}`}
          listRef={listRef}
          header={renderCollectedEmpty()}
          paddingTop={headerHeight + BarContentGap}
          paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
          // Flush to the bar's bottom edge — NOT the viewport top, which is behind the bar
          // (content scrolls under it).
          stickyHeaderTop={headerHeight}
          stickyPinned={stickyPinned}
          sharedValues={sharedValues}
          onScroll={onScroll}
          // Mirrors the branch below: a series warms its detail, a chapter the pages it reads from.
          // A saved page opens in SEQUENCE mode, where the sequence IS the page list — no query to
          // warm, and its image is the one this very tile is already showing.
          onWarm={(item) => {
            if (item.type === 'series') {
              // No `bridge` param below, so the destination resolves the name to 'Library' — match
              // it, or this warm caches a detail carrying a different one (see useWarmSeriesDetail).
              warmDetail(item.bridgeId, item.seriesId, {
                bridgeName: 'Library',
                title: item.seriesTitle,
                cover: item.thumbnailUrl,
              });
              return;
            }
            if (item.type === 'chapter') {
              const direct = item.chapterId === DIRECT_CHAPTER_ID;
              warmPages(item.bridgeId, item.seriesId, direct ? undefined : item.chapterId);
            }
          }}
          onOpen={(item) => {
            // A series opens its details; a chapter or a saved page opens THE reader — the same
            // series screen History rows push into, not a viewer of its own. That screen already
            // owns everything a reading surface needs (the reveal to details with its own lazy
            // loading and skeletons, the collapse dismissal, the settings sheet, the save button in
            // its toolbar), so a saved page inherits all of it and any change there applies here.
            if (item.type === 'series') {
              router.push({
                pathname: '/series',
                params: {
                  id: item.seriesId,
                  bridgeId: item.bridgeId,
                  title: item.seriesTitle,
                  // The cover URL rides along for the zoom's flying copy (and the details
                  // placeholder), exactly as a series card forwards it.
                  ...(item.thumbnailUrl ? { cover: encodeSeriesParam(item.thumbnailUrl) } : {}),
                },
              });
              return;
            }
            if (item.type === 'page') {
              // A saved page opens the reader in SEQUENCE mode: the pager runs over this view's
              // saved pages — same collection, search, sort and direction, so the album order IS
              // the grid order — and paging past a page crosses into the next saved page, whatever
              // series it belongs to (use-reader-sequence.ts re-resolves from the same query key,
              // so a warm cache opens instantly).
              router.push({
                pathname: '/series',
                params: {
                  seq: '1',
                  seqCollection: collectionFilter ?? '',
                  seqSort: collectedView.sort,
                  seqDir: collectedView.dir,
                  ...(term ? { seqQ: term } : {}),
                  seqStart: item.id,
                },
              });
              return;
            }
            const direct = item.chapterId === DIRECT_CHAPTER_ID;
            router.push({
              pathname: '/series',
              params: {
                id: item.seriesId,
                title: item.seriesTitle,
                bridge: encodeSeriesParam(bridgeById.get(item.bridgeId)?.name ?? item.bridgeId),
                bridgeId: item.bridgeId,
                reader: '1',
                // A saved chapter reads normally, from its first page.
                start: '0',
                ...(direct
                  ? { direct: '1' }
                  : { chapterId: item.chapterId, chapterName: item.chapterName ?? '' }),
              },
            });
          }}
        />
      ) : (
        <SeriesGrid
          items={listData}
          scopeKey={`${term}|${sort}|${grouping}|${show}|${collectionFilter ?? ''}`}
          listRef={listRef}
          header={renderEmpty()}
          // Library cards carry an app-made sub (the bridge name), regardless of any bridge flag.
          hasSub
          // The one grid that re-sorts under an open page: closing a series moves its card to the
          // front of a last-read sort, and an unfollow closes a gap under any sort.
          animateReorder
          paddingTop={headerHeight + BarContentGap}
          paddingBottom={BottomTabInset + insets.bottom + Spacing.five}
          // Flush to the bar's bottom edge, as on Browse — the pinned heading's material meets
          // the bar rather than floating below it.
          groupOf={groupOf}
          stickyHeaderTop={headerHeight}
          stickyPinned={stickyPinned}
          sharedValues={sharedValues}
          onScroll={onScroll}
        />
      )}

      {/* The sort button lives in the bar's trailing slot in BOTH states, so it stays put and visible
          while filtering. Filtering only swaps the LEADING content — the list selector becomes a back
          button + field in place — and collapses the filter trigger (now redundant) beside sort. */}
      <TabTitleBar
        barStyle={barRuleStyle}
        leading={
          filter.open ? undefined : (
            <CollectionThumb
              name={collectionFilter === null ? null : viewName}
              size={BridgeThumbSize}
              style={styles.barThumb}
            />
          )
        }
        titleSlot={
          filter.open ? (
            <TabFilterField filter={filter} testID="library.search" placeholder="Filter library…" />
          ) : (
            // The rail lists the collections when it's showing, so the selector would be a second
            // control for one selection. Unlike Browse — whose `Home` selector is a different axis
            // and stays — this one IS the screen's heading, so it degrades to a plain title rather
            // than leaving the bar with nothing in it.
            railNav ? (
              <ThemedText numberOfLines={1} style={styles.railTitle}>
                {viewName}
              </ThemedText>
            ) : (
              <LibraryCollectionSelector
                value={collectionFilter}
                collections={collections}
                onChange={setCollectionFilter}
              />
            )
          )
        }
        right={
          <>
            <TabFilterTrigger filter={filter} testID="library.search" placeholder="Filter library…" />
            {/* Sort applies to the library grid only. The saved-pages view has its own sort/dir
                axes (Phase 3); showing this control there would be a lever that does nothing. */}
            {showingCollected ? (
              <CollectedSortButton value={collectedView} onChange={setCollectedView} />
            ) : (
              <LibrarySortButton
                value={sort}
                onChange={setSort}
                grouping={grouping}
                onGroupingChange={setGrouping}
                show={show}
                onShowChange={setShow}
              />
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
  const { columnGap } = useGridLayout();
  const desktop = useIsDesktop();
  return (
    <View style={styles.skelWrap}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={[styles.skelRow, { gap: columnGap }]}>
          {Array.from({ length: numColumns }).map((_, c) => (
            <View key={c} style={[styles.cell, styles.skelCell]}>
              <Skeleton style={[styles.skelCover, coverStyles.corner, desktop && coverStyles.cornerDesktop]} />
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
  // The type the collection selector's own trigger uses, so swapping one for the other doesn't
  // change the bar's height or the title's weight.
  railTitle: {
    flexShrink: 1,
    minWidth: 0,
    // The selector's own inset, so the title stands the same step off the tile either way.
    paddingHorizontal: Spacing.one,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  barThumb: {
    borderRadius: BridgeThumbRadius,
  },
  container: {
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
  },
  skelCell: {
    gap: Spacing.one,
  },
  skelCover: {
    width: '100%',
    aspectRatio: 2 / 3,
  },
  skelLine: {
    height: 12,
    borderRadius: 4,
  },
  skelLineShort: {
    width: '60%',
  },
});
