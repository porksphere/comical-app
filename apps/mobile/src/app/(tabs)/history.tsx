import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TrashIcon } from '@/components/icons/ui-icons';
import { TabTitleBar } from '@/components/tab-title-bar';
import { HistoryRow } from '@/components/history-row';
import { setZoomOrigin, useIsZoomingSeries } from '@/lib/series-zoom';
import { RetryBlock } from '@/components/retry-block';
import { SeriesCardMenu } from '@/components/series-card-menu';
import { SwipeableRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, BottomTabInset, listPaddingTop, MaxTopLevelWidth, Spacing, topLevelCenterInset } from '@/constants/theme';
import { historyQuery, queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';
import { relTime } from '@/lib/rel-time';
import { scrollPhaseHandlers } from '@/lib/scroll-release';

export default function HistoryScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const hideNsfw = useHideNsfw();
  const { byId, nameOf, directOf } = useBridgeMap();
  const listRef = useRef<LegendListRef>(null);
  useScrollToTopOnReselect('history', listRef);
  const { onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the row list (see use-deferred-mount).
  const ready = useDeferredMount();

  const { data: items = undefined, error, isLoading, refetch } = useQuery(historyQuery(ds, mock));

  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce) void refetch();
      else setFocusedOnce(true);
    }, [focusedOnce, refetch]),
  );

  // Optimistic remove: drop the row immediately, roll back on error.
  const removeMutation = useMutation({
    mutationFn: (h: HistoryEntry) => ds.removeHistoryEntry(h.bridgeId, h.seriesId),
    onMutate: async (h: HistoryEntry) => {
      const key = queryKeys.history(mock);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<HistoryEntry[]>(key);
      queryClient.setQueryData<HistoryEntry[]>(key, (cur) =>
        (cur ?? []).filter((x) => !(x.bridgeId === h.bridgeId && x.seriesId === h.seriesId)),
      );
      return { prev };
    },
    onError: (_e, _h, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.history(mock), ctx.prev);
    },
  });

  const visible = items && hideNsfw ? items.filter((h) => !byId.get(h.bridgeId)?.nsfw) : items;

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
    const enc = (v: string) => encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29');
    router.push({
      pathname: '/series',
      params: {
        id: h.seriesId,
        title: h.title,
        bridge: enc(nameOf(h.bridgeId)),
        bridgeId: h.bridgeId,
        ...(h.thumbnailUrl ? { cover: enc(h.thumbnailUrl) } : {}),
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
    const enc = (v: string) => encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29');
    router.push({
      pathname: '/series',
      params: {
        id: h.seriesId,
        title: h.title,
        bridge: enc(nameOf(h.bridgeId)),
        bridgeId: h.bridgeId,
        reader: '1',
        start: String(h.lastPage ?? 0),
        ...(h.thumbnailUrl ? { cover: enc(h.thumbnailUrl) } : {}),
        ...(isDirect ? { direct: '1' } : { chapterId: h.chapterId!, chapterName: h.chapterName ?? '' }),
      },
    });
  };

  const body = () => {
    if (error) return <RetryBlock message={(error as Error).message || 'Failed to load history'} onRetry={refetch} />;
    if (!ready || isLoading || items === undefined) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
    if (!visible || visible.length === 0) {
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
    <ThemedView style={styles.container}>
      {emptyBody ? (
        <View style={[styles.centeredColumn, { paddingTop: headerHeight + BarContentGap }]}>
          <View style={styles.centerFill}>{emptyBody}</View>
        </View>
      ) : (
        <LegendList
          ref={listRef}
          // Full-width scroller so the scrollbar sits at the window edge; rows centered via sidePad.
          style={styles.list}
          data={visible}
          keyExtractor={(h) => `${h.bridgeId}:${h.seriesId}`}
          recycleItems={false}
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
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.hairline }]} />}
          renderItem={({ item }) => (
            <HistoryItem
              item={item}
              onResume={() => resume(item)}
              onOpenDetail={() => openDetail(item)}
              onRemove={() => removeMutation.mutate(item)}
              bridge={nameOf(item.bridgeId)}
              direct={directOf(item.bridgeId)}
            />
          )}
          showsVerticalScrollIndicator={Platform.OS === 'web'}
          onScroll={onScroll}
          // Gesture phases for the tab bar, which commits to shown/hidden on release — this screen
          // owns its list rather than going through RecyclerList, which reports them itself.
          {...scrollPhaseHandlers}
        />
      )}

      <TabTitleBar title="History" />
    </ThemedView>
  );
}

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
}: {
  item: HistoryEntry;
  onResume: () => void;
  onOpenDetail: () => void;
  onRemove: () => void;
  bridge: string;
  direct: boolean;
}) {
  const thumbRef = useRef<View>(null);
  // The row's thumbnail is the zoom transition's source rect,
  // captured on press-IN because `measureInWindow` answers asynchronously — measuring at press
  // would put a native round trip in front of the navigation. And while its copy is in the air the
  // original blanks, reusing `coverHidden` — the same slot, and the same reason, as the long-press
  // preview's lifted copy.
  const zoomFlying = useIsZoomingSeries(item.seriesId);
  const captureZoomOrigin = () => {
    thumbRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) setZoomOrigin(item.seriesId, { x, y, width: w, height: h });
    });
  };
  const renderRow = (coverHidden: boolean) => (
    <HistoryRow
      thumbnailUrl={item.thumbnailUrl}
      title={item.title}
      sub={historySub(item)}
      onPress={onResume}
      onPressIn={captureZoomOrigin}
      onMore={onOpenDetail}
      onMorePressIn={captureZoomOrigin}
      actions={[]}
      thumbRef={thumbRef}
      coverHidden={coverHidden || zoomFlying}
    />
  );
  return (
    <SwipeableRow name={item.title} actions={[{ label: 'Remove', icon: TrashIcon, destructive: true, onPress: onRemove }]}>
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
          measureRef={thumbRef}>
          {({ hidden }) => renderRow(hidden)}
        </SeriesCardMenu>
      )}
    </SwipeableRow>
  );
}

/** Build the row's secondary line: `chapter · X / N · when`, omitting absent parts. */
function historySub(h: HistoryEntry): string {
  const isDirect = h.chapterId === DIRECT_CHAPTER_ID;
  const chapter = !isDirect && h.chapterName ? h.chapterName : '';
  const page =
    h.lastPage !== undefined ? (h.pageCount ? `${h.lastPage + 1} / ${h.pageCount}` : `${h.lastPage + 1}`) : '';
  return [chapter, page, relTime(h.lastReadAt)].filter(Boolean).join('  ·  ');
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
  sep: {
    height: StyleSheet.hairlineWidth,
  },
});
