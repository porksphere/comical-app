import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HistoryRow } from '@/components/history-row';
import { useSeriesReaderPage } from '@/lib/experimental-flags';
import { setZoomOrigin, useIsZoomingSeries } from '@/lib/series-zoom';
import { CheckIcon, TrashIcon } from '@/components/icons/ui-icons';
import { PullIndicator } from '@/components/pull-indicator';
import { RetryBlock } from '@/components/retry-block';
import { SeriesCardMenu } from '@/components/series-card-menu';
import { SwipeableRow } from '@/components/settings/swipeable-row';
import { TabTitleBar } from '@/components/tab-title-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { BarContentGap, BottomTabInset, listPaddingTop, MaxTopLevelWidth, Spacing, topLevelCenterInset } from '@/constants/theme';
import { activityQuery, queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import type { ActivityEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';
import { relTime } from '@/lib/rel-time';
import { notifyScrollBeginDrag, notifyScrollEndDrag, notifyScrollRest } from '@/lib/scroll-release';

/**
 * One coalesced feed row: a single library series with its newly-detected chapters folded together
 * (so three new chapters read as one "3 new chapters" row, not three), sorted by the most recent of
 * those detections. Mirrors a History row's shape and interactions — tap reads, 3-dot opens the
 * series, long-press opens the quick-actions popup, swipe-left clears the series from the feed.
 */
type SeriesActivity = {
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  /** Newest detection across the group — the sort key and the row's "when". */
  latestAt: number;
  /** How many of the group's new chapters are still unread — the "N new chapters" count. */
  newCount: number;
  /** Any unread chapter in the group (drives the accent dot; all-read rows dim). */
  hasUnread: boolean;
  /** The chapter a tap reads: the newest unread one, else the newest overall. */
  chapterId: string;
  chapterName?: string;
  number?: number;
};

export default function ActivityScreen() {
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
  useScrollToTopOnReselect('activity', listRef);
  const { onScroll } = useHideTabBarOnScroll();
  // Let the tab swap paint before mounting the row list (see use-deferred-mount).
  const ready = useDeferredMount();

  const { data: items = undefined, error, isLoading, refetch } = useQuery(activityQuery(ds, mock));

  const [focusedOnce, setFocusedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      // Refresh the feed on re-focus so read-state changes made elsewhere (the reader, another
      // device) show up. Deliberately does NOT touch the badge count — merely looking at the tab
      // clears nothing; only reading, the row's "Mark read" swipe, or clearing the row drains it.
      if (focusedOnce) void refetch();
      else setFocusedOnce(true);
    }, [focusedOnce, refetch]),
  );

  const invalidateFeed = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
  }, [queryClient, mock]);

  // Pull-to-refresh = a forced re-scan of the whole library, then a feed refresh. The app's shared
  // custom overlay spinner (no native RefreshControl — see usePullToRefresh) sources the gesture; the
  // list's live scroll offset feeds it via `sharedValues` below.
  const scrollY = useSharedValue(0);
  const refresh = useCallback(async () => {
    try {
      const res = await ds.checkForUpdates({ force: true });
      invalidateFeed();
      showToast(
        res.newChapters > 0
          ? `${res.newChapters} new chapter${res.newChapters === 1 ? '' : 's'} found`
          : "You're up to date",
      );
    } catch {
      showToast('Update check failed');
    }
  }, [ds, invalidateFeed]);
  const pull = usePullToRefresh(scrollY, refresh);

  // Swipe-away clears a whole series' feed entries at once (they're coalesced into one row). Optimistic:
  // drop the row immediately, roll back on error, refresh the badge count when settled.
  const removeMutation = useMutation({
    mutationFn: (g: SeriesActivity) => ds.removeActivityEntry(g.bridgeId, g.seriesId),
    onMutate: async (g: SeriesActivity) => {
      const key = queryKeys.activity(mock);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ActivityEntry[]>(key);
      queryClient.setQueryData<ActivityEntry[]>(key, (cur) =>
        (cur ?? []).filter((x) => !(x.bridgeId === g.bridgeId && x.seriesId === g.seriesId)),
      );
      return { prev };
    },
    onError: (_e, _g, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.activity(mock), ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) }),
  });

  // Swipe "Mark read" acknowledges a series' new chapters without opening them — with the badge no
  // longer clearing on tab focus, this (or actually reading) is how a row's count is dismissed.
  // Optimistic like the clear: flip the group's entries to read at once, roll back on error.
  const markReadMutation = useMutation({
    mutationFn: (g: SeriesActivity) => ds.markActivityRead(g.bridgeId, g.seriesId),
    onMutate: async (g: SeriesActivity) => {
      const key = queryKeys.activity(mock);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ActivityEntry[]>(key);
      queryClient.setQueryData<ActivityEntry[]>(key, (cur) =>
        (cur ?? []).map((x) => (x.bridgeId === g.bridgeId && x.seriesId === g.seriesId ? { ...x, read: true } : x)),
      );
      return { prev };
    },
    onError: (_e, _g, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.activity(mock), ctx.prev);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) }),
  });

  const visible = items && hideNsfw ? items.filter((a) => !byId.get(a.bridgeId)?.nsfw) : items;

  // Coalesce the flat per-chapter feed into one row per series. `visible` is already newest-first, so a
  // series' first appearance is its newest detection (the row's snapshot + sort position), and the
  // first unread entry we see is its newest unread (the tap's read target).
  const rows = useMemo<SeriesActivity[]>(() => {
    if (!visible) return [];
    const groups = new Map<string, { head: ActivityEntry; entries: ActivityEntry[] }>();
    for (const a of visible) {
      const key = `${a.bridgeId}:${a.seriesId}`;
      const g = groups.get(key);
      if (g) g.entries.push(a);
      else groups.set(key, { head: a, entries: [a] });
    }
    const out: SeriesActivity[] = [];
    for (const { head, entries } of groups.values()) {
      const unread = entries.filter((e) => !e.read);
      const rep = unread[0] ?? entries[0]!; // newest unread, else newest
      out.push({
        bridgeId: head.bridgeId,
        seriesId: head.seriesId,
        title: head.title,
        thumbnailUrl: head.thumbnailUrl,
        latestAt: head.detectedAt,
        newCount: unread.length,
        hasUnread: unread.length > 0,
        chapterId: rep.chapterId,
        chapterName: rep.chapterName,
        number: rep.number,
      });
    }
    // Newest update first. (Insertion order is already close to this, but ties/interleaving make the
    // explicit sort the source of truth.)
    out.sort((a, b) => b.latestAt - a.latestAt);
    return out;
  }, [visible]);

  const barHeight = useTopBarHeight();
  const headerHeight = insets.top + barHeight;
  // Center the rows in a full-width scroller (scrollbar at the window edge) via symmetric side
  // padding — LegendList drops paddingHorizontal / ignores alignSelf on its content container, so
  // explicit paddingLeft/Right is the reliable lever. Only the centring inset (web); the row owns its
  // own horizontal gutter so the swipe-to-clear reaches the edge (see history-row / history).
  const sidePad = topLevelCenterInset(width);

  // EXPERIMENTAL (Settings → General): with the series-reader page on, a row opens that combined
  // screen straight into the reader instead of the standalone /reader — see `resume`/`read` below.
  const seriesReaderPage = useSeriesReaderPage();

  const openDetail = (g: SeriesActivity) =>
    router.push({
      pathname: '/series',
      params: {
        id: g.seriesId,
        title: g.title,
        bridge: nameOf(g.bridgeId),
        bridgeId: g.bridgeId,
        ...(directOf(g.bridgeId) ? { direct: '1' } : {}),
      },
    });

  const read = (g: SeriesActivity) => {
    // See history.tsx's `resume` — same experiment, same reasoning.
    if (seriesReaderPage) {
      const enc = (v: string) => encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29');
      router.push({
        pathname: '/series-reader',
        params: {
          id: g.seriesId,
          title: g.title,
          bridge: enc(nameOf(g.bridgeId)),
          bridgeId: g.bridgeId,
          reader: '1',
          chapterId: g.chapterId,
          chapterName: g.chapterName ?? '',
          start: '0',
          ...(directOf(g.bridgeId) ? { direct: '1' } : {}),
          ...(g.thumbnailUrl ? { cover: enc(g.thumbnailUrl) } : {}),
        },
      });
      return;
    }
    router.push({
      pathname: '/reader',
      params: {
        seed: g.seriesId,
        title: g.title,
        bridgeId: g.bridgeId,
        chapterId: g.chapterId,
        chapterName: g.chapterName ?? '',
        start: '0',
      },
    });
  };

  const body = () => {
    if (error) return <RetryBlock message={(error as Error).message || 'Failed to load activity'} onRetry={refetch} />;
    if (!ready || isLoading || items === undefined) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
    if (!visible || visible.length === 0) {
      return (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          New chapters in your library appear here automatically.
        </ThemedText>
      );
    }
    return null;
  };

  const emptyBody = body();

  return (
    <ThemedView style={styles.container} {...pull.touchHandlers}>
      {emptyBody ? (
        <View style={[styles.centeredColumn, { paddingTop: headerHeight + BarContentGap }]}>
          <View style={styles.centerFill}>{emptyBody}</View>
        </View>
      ) : (
        <Animated.View style={[styles.list, pull.listStyle]}>
          <AnimatedLegendList
            ref={listRef}
            // Full-width scroller so the scrollbar sits at the window edge; rows centered via sidePad.
            style={styles.list}
            data={rows}
            keyExtractor={(g) => `${g.bridgeId}:${g.seriesId}`}
            recycleItems={false}
            // Don't retro-correct offsets from measurements — a visible jitter while flinging otherwise.
            maintainVisibleContentPosition={{ data: false, size: false }}
            // Live UI-thread scroll offset the pull-to-refresh reads (top-of-list check + iOS bounce).
            sharedValues={{ scrollOffset: scrollY }}
            // WEB ONLY: routes the reanimated scroll bridge through scrollEventThrottle:1 so onScroll
            // fires mid-drag (see recycler-list.tsx for the full root-cause note).
            renderScrollComponent={Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined}
            contentContainerStyle={{
              // Fill the viewport even with few rows, so the empty space below them is still part of
              // the scroller and a drag (pull-to-refresh) can be started there.
              flexGrow: 1,
              // Start flush under the top bar (like History / a settings list): the first row begins at
              // the bar's bottom edge and its own top padding is all the separation it needs.
              paddingTop: listPaddingTop(headerHeight),
              paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
              paddingLeft: sidePad,
              paddingRight: sidePad,
            }}
            ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.hairline }]} />}
            renderItem={({ item }) => (
              <ActivityItem
                item={item}
                onRead={() => read(item)}
                onOpenDetail={() => openDetail(item)}
                onMarkRead={() => markReadMutation.mutate(item)}
                onRemove={() => removeMutation.mutate(item)}
                bridge={nameOf(item.bridgeId)}
                direct={directOf(item.bridgeId)}
              />
            )}
            showsVerticalScrollIndicator={Platform.OS === 'web'}
            // Suppress Android's edge glow so it doesn't fight the custom pull; iOS keeps its bounce
            // (that's what sources the pull there) and fires the refresh via onScrollEndDrag.
            overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
            onScroll={onScroll}
            // Gesture phases for the tab bar (it commits to shown/hidden on release). Composed by
            // hand rather than spreading `scrollPhaseHandlers`: pull-to-refresh already owns
            // `onScrollEndDrag`, and that's the release signal.
            onScrollBeginDrag={notifyScrollBeginDrag}
            onMomentumScrollEnd={notifyScrollRest}
            onScrollEndDrag={() => {
              notifyScrollEndDrag();
              pull.onScrollEndDrag?.();
            }}
          />
        </Animated.View>
      )}

      <PullIndicator {...pull.indicator} top={headerHeight} />
      <TabTitleBar title="Activity" />
    </ThemedView>
  );
}

/**
 * One coalesced activity row. A component (not inline in `renderItem`) so it can own the thumbnail ref
 * the native long-press preview lifts FROM — the small portrait rect makes the flying cover match
 * Browse/Library/History rather than starting huge from the wide row. Tap reads; 3-dot opens the
 * series page; long-press (native) opens the shared quick-actions popup; swipe-left offers
 * "Mark read" (while the row has unread chapters) and "Clear" (removes the series from the feed).
 */
function ActivityItem({
  item,
  onRead,
  onOpenDetail,
  onMarkRead,
  onRemove,
  bridge,
  direct,
}: {
  item: SeriesActivity;
  onRead: () => void;
  onOpenDetail: () => void;
  onMarkRead: () => void;
  onRemove: () => void;
  bridge: string;
  direct: boolean;
}) {
  const thumbRef = useRef<View>(null);
  // EXPERIMENTAL (series-reader page): the row's thumbnail is the zoom transition's source rect,
  // captured on press-IN because `measureInWindow` answers asynchronously — measuring at press
  // would put a native round trip in front of the navigation. And while its copy is in the air the
  // original blanks, reusing `coverHidden` — the same slot, and the same reason, as the long-press
  // preview's lifted copy.
  const seriesReaderPage = useSeriesReaderPage();
  const zoomFlying = useIsZoomingSeries(item.seriesId);
  const captureZoomOrigin = () => {
    if (!seriesReaderPage) return;
    thumbRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) setZoomOrigin(item.seriesId, { x, y, width: w, height: h });
    });
  };
  const renderRow = (coverHidden: boolean) => (
    <HistoryRow
      thumbnailUrl={item.thumbnailUrl}
      title={item.title}
      sub={activitySub(item)}
      dimmed={!item.hasUnread}
      unread={item.hasUnread}
      onPress={onRead}
      onPressIn={captureZoomOrigin}
      onMore={onOpenDetail}
      actions={[]}
      thumbRef={thumbRef}
      coverHidden={coverHidden || zoomFlying}
    />
  );
  return (
    <SwipeableRow
      name={item.title}
      // Actions lay out left→right, so the LAST sits at the screen edge — revealed by the
      // smallest swipe and the easiest to tap. Put the destructive Clear FIRST (the inner
      // slot, reached only by swiping further) and Mark read at the edge, so the safe action
      // is the easy one and a delete takes a deliberate, longer swipe. All-read rows have
      // nothing to mark, so they offer Clear alone (which then becomes full-swipeable).
      actions={[
        { label: 'Clear', icon: TrashIcon, destructive: true, onPress: onRemove },
        ...(item.hasUnread ? [{ label: 'Mark read', icon: CheckIcon, onPress: onMarkRead }] : []),
      ]}>
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

/** Row secondary line: `N new chapters · when` when several coalesce, else `chapter · when`. */
function activitySub(g: SeriesActivity): string {
  const chapter =
    g.newCount > 1
      ? `${g.newCount} new chapters`
      : (g.chapterName ?? (g.number !== undefined ? `Chapter ${g.number}` : 'New chapter'));
  return `${chapter}  ·  ${relTime(g.latestAt)}`;
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
