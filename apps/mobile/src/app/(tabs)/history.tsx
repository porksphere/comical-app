import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrashIcon } from '@/components/icons/ui-icons';
import { TabFilterField, TabFilterTrigger, useTabFilter } from '@/components/tab-filter';
import { TabTitleBar } from '@/components/tab-title-bar';
import { HistoryRow } from '@/components/history-row';
import {
  useIsZoomingSeries,
  useZoomOriginSource,
  useZoomSourceKey,
  useZoomSurfaceKey,
  ZoomSurfaceContext,
} from '@/lib/series-zoom';
import { encodeSeriesParam } from '@/lib/series-nav';
import { useWarmChapterPages, useWarmSeriesDetail } from '@/data/prefetch';
import { RetryBlock } from '@/components/retry-block';
import { RowHairline } from '@/components/row-hairline';
import { SeriesCardMenu } from '@/components/series-card-menu';
import { SwipeableRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, listPaddingTop, MaxTopLevelWidth, Spacing, topLevelCenterInset } from '@/constants/theme';
import { historyQuery, libraryQuery, queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useContentWidth } from '@/hooks/use-content-width';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useRouter } from '@/lib/nav';
import { relTime } from '@/lib/rel-time';
import { useZoomSurfaceList } from '@/lib/zoom-surface-list';
import { ROW_REORDER_TRANSITION } from '@/lib/row-motion';
import { scrollPhaseHandlers } from '@/lib/scroll-release';
import { scrollbarInset } from '@/lib/scrollbar-inset';

export default function HistoryScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The content column, not the window — the sidebar's inset is already out of it.
  const width = useContentWidth();
  const filter = useTabFilter();
  const query = filter.query;
  const queryClient = useQueryClient();
  const hideNsfw = useHideNsfw();
  const { byId, nameOf, directOf } = useBridgeMap();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('history', listRef);

  // This list as a zoom surface — see AGENTS.md → Zoom transitions.
  const zoomSurface = useZoomSurfaceKey('history');
  // UI-thread scroll offset for the tab bar's slide — `sharedValues` feeds it (hence the
  // AnimatedLegendList below), `onScroll` only keeps the bottom-bounce measurement in sync.
  const { sharedValues, onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the row list (see use-deferred-mount).
  const ready = useDeferredMount();

  const { data: items = undefined, error, isLoading, refetch } = useQuery(historyQuery(ds, mock));
  // History rows for collected series say where the reader stands in the series (chapters read of
  // those known). The counts come from the library listing (one query, already cached by the
  // Library tab) rather than a request per row.
  const { data: collected } = useQuery(libraryQuery(ds, mock, '', 'lastRead'));
  const chaptersOf = useMemo(() => {
    const map = new Map<string, { read: number; known: number }>();
    for (const e of collected ?? []) {
      if (e.known > 0) map.set(`${e.bridgeId}:${e.seriesId}`, { read: Math.max(0, e.known - e.unread), known: e.known });
    }
    return map;
  }, [collected]);

  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce) void refetch();
      else setFocusedOnce(true);
    }, [focusedOnce, refetch]),
  );

  // Optimistic remove: hide the row immediately, roll back on error. Hidden rather than dropped from
  // the cache, since it may still be the series' resume point.
  const removeMutation = useMutation({
    mutationFn: (h: HistoryEntry) => ds.removeHistoryEntry(h.bridgeId, h.seriesId),
    onMutate: async (h: HistoryEntry) => {
      const key = queryKeys.history(mock);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<HistoryEntry[]>(key);
      queryClient.setQueryData<HistoryEntry[]>(key, (cur) =>
        (cur ?? []).map((x) => (x.bridgeId === h.bridgeId && x.seriesId === h.seriesId ? { ...x, hidden: true } : x)),
      );
      return { prev };
    },
    onError: (_e, _h, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.history(mock), ctx.prev);
    },
  });

  // Memoized so the identity only changes when the ORDER can have: a fresh array every render
  // would tell every collapse in flight that the list moved (see the notice below).
  const visible = useMemo(() => {
    const shown = items?.filter((h) => !h.hidden && !(hideNsfw && byId.get(h.bridgeId)?.nsfw));
    // A filter over rows already loaded, not a query: this list is fetched whole, so narrowing it
    // costs nothing and needs no server support.
    const q = query.trim().toLowerCase();
    return q && shown ? shown.filter((h) => h.title.toLowerCase().includes(q)) : shown;
  }, [byId, hideNsfw, items, query]);

  // Reading reorders this list, so a series opened from partway down can end up above the viewport
  // by the time the page closes — see useZoomSurfaceList.
  useZoomSurfaceList(zoomSurface, visible, historySeriesId, listRef);

  const barHeight = useTopBarHeight();
  const headerHeight = insets.top + barHeight;
  // Center the rows in a full-width scroller (scrollbar at the window edge) via symmetric side
  // padding — LegendList drops paddingHorizontal / ignores alignSelf on its content container, so
  // explicit paddingLeft/Right is the reliable lever. See library.tsx.
  // Only the centring inset (web) — the row owns its own horizontal gutter, so it spans the full
  // content width and the swipe-to-delete reaches the edge instead of being cut off inside a side inset.
  const sidePad = topLevelCenterInset(width);

  // The 3-dot opens the SERIES side of that same page — no `reader` param, so it lands on
  // the details with the reader as the strip, which is exactly a browse open. Same zoom off this
  // row's thumbnail; the only difference from `resume` below is which side it opens on.
  const openDetail = (h: HistoryEntry) => {
    router.push({
      pathname: '/series',
      params: {
        id: h.seriesId,
        title: h.title,
        bridge: encodeSeriesParam(nameOf(h.bridgeId)),
        bridgeId: h.bridgeId,
        ...(h.thumbnailUrl ? { cover: encodeSeriesParam(h.thumbnailUrl) } : {}),
        ...(directOf(h.bridgeId) ? { direct: '1' } : {}),
      },
    });
  };

  const resume = (h: HistoryEntry) => {
    const isDirect = h.chapterId === DIRECT_CHAPTER_ID || !h.chapterId;
    // A row is a "carry on reading" action, so it opens the series page straight into the READER
    // — a swipe up brings the details in, and the whole thing collapses back into this row's
    // thumbnail. The read position is passed explicitly (this row already knows it), which is also
    // what lets that screen request the page ahead of the series detail.
    router.push({
      pathname: '/series',
      params: {
        id: h.seriesId,
        title: h.title,
        bridge: encodeSeriesParam(nameOf(h.bridgeId)),
        bridgeId: h.bridgeId,
        reader: '1',
        start: String(h.lastPage ?? 0),
        ...(h.thumbnailUrl ? { cover: encodeSeriesParam(h.thumbnailUrl) } : {}),
        ...(isDirect ? { direct: '1' } : { chapterId: h.chapterId!, chapterName: h.chapterName ?? '' }),
      },
    });
  };

  const body = () => {
    if (error) return <RetryBlock message={(error as Error).message || 'Failed to load history'} onRetry={refetch} />;
    if (!ready || isLoading || items === undefined) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
    if (!visible || visible.length === 0) {
      if (query.trim()) return <ThemedText themeColor="textSecondary">No matches</ThemedText>;
      return (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          No reading history yet. Open a series and start reading — it’ll show up here.
        </ThemedText>
      );
    }
    return null;
  };

  const emptyBody = body();

  return (
    // Rows and list must share one surface key, or each row falls back to a key of its own.
    <ZoomSurfaceContext.Provider value={zoomSurface}>
      <ThemedView style={styles.container}>
      {emptyBody ? (
        <View style={[styles.centeredColumn, { paddingTop: headerHeight + BarContentGap }]}>
          <View style={styles.centerFill}>{emptyBody}</View>
        </View>
      ) : (
        <AnimatedLegendList
          ref={listRef}
          // Full-width scroller so the scrollbar sits at the window edge; rows centered via sidePad.
          style={[styles.list, scrollbarInset(listPaddingTop(headerHeight))]}
          data={visible}
          keyExtractor={(h) => `${h.bridgeId}:${h.seriesId}`}
          recycleItems={false}
          itemLayoutAnimation={ROW_REORDER_TRANSITION}
          contentContainerStyle={{
            // Fill the viewport even with few rows, so the empty space below them is still part of
            // the scroller and a drag can be started there (see SeriesGrid's note).
            flexGrow: 1,
            // Start flush under the top bar (like a settings list): the first row begins at the bar's
            // bottom edge and its own top padding is all the separation it needs.
            paddingTop: listPaddingTop(headerHeight),
            paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
            paddingLeft: sidePad,
            paddingRight: sidePad,
          }}
          renderItem={({ item }) => (
            <HistoryItem
              item={item}
              onResume={() => resume(item)}
              onOpenDetail={() => openDetail(item)}
              onRemove={() => removeMutation.mutate(item)}
              bridge={nameOf(item.bridgeId)}
              direct={directOf(item.bridgeId)}
              chapters={chaptersOf.get(`${item.bridgeId}:${item.seriesId}`)}
            />
          )}
          showsVerticalScrollIndicator={Platform.OS === 'web'}
          sharedValues={sharedValues}
          onScroll={onScroll}
          // Gesture phases for the tab bar, which commits to shown/hidden on release — this screen
          // owns its list rather than going through RecyclerList, which reports them itself.
          {...scrollPhaseHandlers}
        />
      )}

      <TabTitleBar
        title="History"
        titleSlot={
          filter.open ? (
            <TabFilterField filter={filter} testID="history.search" placeholder="Filter history…" />
          ) : undefined
        }
        right={<TabFilterTrigger filter={filter} testID="history.search" placeholder="Filter history…" />}
      />
    </ThemedView>
    </ZoomSurfaceContext.Provider>
  );
}

/** Stable, so the zoom surface registers once rather than every render — see useZoomSurfaceList. */
const historySeriesId = (item: HistoryEntry) => item.seriesId;

/**
 * One History entry. A component (not inline in `renderItem`) so it can own the thumbnail ref that the
 * native long-press preview lifts FROM — passing the row's own (wide) rect makes the flying cover start
 * huge, whereas the small portrait thumbnail rect matches Browse/Library. Tap resumes; 3-dot opens the
 * series page; long-press (native) opens the shared quick-actions popup; swipe-left reveals Delete.
 */
function HistoryItem({
  item,
  onResume,
  onOpenDetail,
  onRemove,
  bridge,
  direct,
  chapters,
}: {
  item: HistoryEntry;
  onResume: () => void;
  onOpenDetail: () => void;
  onRemove: () => void;
  bridge: string;
  direct: boolean;
  /** Chapters read of those known; undefined for a series not in the library. */
  chapters?: { read: number; known: number };
}) {
  // The row's bar: pages seen of the chapter being read. A page count the reader hasn't learned
  // yet (or a direct read, which has no chapter) leaves it off.
  const progress = item.lastPage !== undefined && item.pageCount ? (item.lastPage + 1) / item.pageCount : undefined;
  // The series standing takes the time with it onto a second line; without one the time stays on
  // the first, as it always has.
  const standing = chapters ? `${chapters.read} of ${chapters.known} chapters` : undefined;
  const sub = historySub(item, !standing);
  const detail = standing ? [standing, relTime(item.lastReadAt)].join('  ·  ') : undefined;
  const thumbRef = useRef<View>(null);
  // The row's thumbnail is the zoom transition's source rect,
  // captured on press-IN because `measureInWindow` answers asynchronously — measuring at press
  // would put a native round trip in front of the navigation. And while its copy is in the air the
  // original blanks, reusing `coverHidden` — the same slot, and the same reason, as the long-press
  // preview's lifted copy.
  // Keyed to this row's LIST, not to the series — see useZoomSourceKey (another copy of the same
  // series elsewhere on screen is not what the page collapses into, and must keep its thumbnail;
  // per list rather than per row because the list recycles row instances).
  const zoomSource = useZoomSourceKey();
  const zoomFlying = useIsZoomingSeries(item.seriesId, zoomSource);
  // Radius 6 — the row thumbnail's corner, not the grid card's 10.
  const captureZoomOrigin = useZoomOriginSource(item.seriesId, zoomSource, thumbRef, 6);
  // Press-in already measures; it now also starts the fetch the tap is about to need (see
  // data/prefetch). The row resumes reading and the 3-dot opens the details, so they warm
  // different things — each mirroring the params its own handler pushes.
  const warmPages = useWarmChapterPages();
  const warmDetail = useWarmSeriesDetail();
  const resumeIsDirect = item.chapterId === DIRECT_CHAPTER_ID || !item.chapterId;
  const onRowPressIn = () => {
    captureZoomOrigin();
    warmPages(item.bridgeId, item.seriesId, resumeIsDirect ? undefined : item.chapterId, item.lastPage ?? 0);
  };
  const onMorePressIn = () => {
    captureZoomOrigin();
    warmDetail(item.bridgeId, item.seriesId, {
      direct,
      bridgeName: bridge,
      title: item.title,
      cover: item.thumbnailUrl,
    });
  };
  const renderRow = (coverHidden: boolean) => (
    <HistoryRow
      thumbnailUrl={item.thumbnailUrl}
      title={item.title}
      sub={sub}
      detail={detail}
      onPress={onResume}
      onPressIn={onRowPressIn}
      onMore={onOpenDetail}
      onMorePressIn={onMorePressIn}
      actions={[]}
      progress={progress}
      thumbRef={thumbRef}
      coverHidden={coverHidden || zoomFlying}
    />
  );
  return (
    <>
      <SwipeableRow
        name={item.title}
        // `collapses`: the remove is optimistic (see the mutation above), so the row folds shut and
        // the ones below it come up, instead of the list re-laying out around a row that vanished.
        actions={[{ label: 'Remove', icon: TrashIcon, destructive: true, collapses: true, onPress: onRemove }]}>
        {Platform.OS === 'web' ? (
          renderRow(false)
        ) : (
          <SeriesCardMenu
            enabled={!!item.bridgeId}
            bridgeId={item.bridgeId}
            bridge={bridge}
            entry={{ id: item.seriesId, title: item.title, cover: item.thumbnailUrl ?? '' }}
            direct={direct}
            coverAspect={2 / 3}
            startRadius={6} // matches HistoryRow's thumbnail corner
            zoomSource={zoomSource}
            measureRef={thumbRef}>
            {({ hidden }) => renderRow(hidden)}
          </SeriesCardMenu>
        )}
      </SwipeableRow>
      <RowHairline />
    </>
  );
}

/** Build the row's secondary line: `chapter · X / N · when`, omitting absent parts. */
function historySub(h: HistoryEntry, withTime: boolean): string {
  const isDirect = h.chapterId === DIRECT_CHAPTER_ID;
  const chapter = !isDirect && h.chapterName ? h.chapterName : '';
  const page =
    h.lastPage !== undefined ? (h.pageCount ? `${h.lastPage + 1} / ${h.pageCount}` : `${h.lastPage + 1}`) : '';
  return [chapter, page, withTime ? relTime(h.lastReadAt) : ''].filter(Boolean).join('  ·  ');
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredColumn: {
    flex: 1,
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 340,
  },
  list: {
    flex: 1,
  },
});
