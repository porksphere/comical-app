import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openConfirm } from '@/components/confirm-popup';
import { TabTitleBar } from '@/components/tab-title-bar';
import { HistoryRow } from '@/components/history-row';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { BarContentGap, BottomTabInset, MaxTopLevelWidth, Spacing, topLevelCenterInset } from '@/constants/theme';
import { markActivitySeen } from '@/data/activity/seen';
import { activityQuery, queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import type { ActivityEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { relTime } from '@/lib/rel-time';

/** The feed flattened for the list: day-section headers interleaved with item rows. */
type FeedRow = { kind: 'header'; label: string } | { kind: 'item'; item: ActivityEntry };

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
      // Looking at the tab resets the badge watermark — the pip counts "new since last looked".
      markActivitySeen();
      if (focusedOnce) void refetch();
      else setFocusedOnce(true);
    }, [focusedOnce, refetch]),
  );

  const invalidateFeed = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.activityCountPrefix(mock) });
  }, [queryClient, mock]);

  // "Check for updates" (button + pull-to-refresh): re-scan every library entry, then refresh the
  // feed. `force` bypasses the host's staleness window — this is the deliberate user action.
  const syncMutation = useMutation({
    mutationFn: () => ds.checkForUpdates({ force: true }),
    onSuccess: (res) => {
      invalidateFeed();
      showToast(
        res.newChapters > 0
          ? `${res.newChapters} new chapter${res.newChapters === 1 ? '' : 's'} found`
          : "You're up to date",
      );
    },
    onError: () => showToast('Update check failed'),
  });

  const clearMutation = useMutation({
    mutationFn: () => ds.clearActivity(),
    onSuccess: invalidateFeed,
  });

  const confirmClear = () =>
    openConfirm({
      message: 'Clear all new-chapter entries from the feed?',
      confirmLabel: 'Clear Feed',
      pendingLabel: 'Clearing…',
      onConfirm: async () => {
        await clearMutation.mutateAsync();
      },
    });

  const visible = items && hideNsfw ? items.filter((a) => !byId.get(a.bridgeId)?.nsfw) : items;

  // Day sections (Today / Yesterday / date), newest first — the feed is already sorted desc.
  const rows = useMemo<FeedRow[]>(() => {
    if (!visible) return [];
    const out: FeedRow[] = [];
    let currentLabel: string | undefined;
    for (const item of visible) {
      const label = dayLabel(item.detectedAt);
      if (label !== currentLabel) {
        currentLabel = label;
        out.push({ kind: 'header', label });
      }
      out.push({ kind: 'item', item });
    }
    return out;
  }, [visible]);

  const barHeight = useTopBarHeight();
  const headerHeight = insets.top + barHeight;
  // Center the rows in a full-width scroller (scrollbar at the window edge) via symmetric side
  // padding — LegendList drops paddingHorizontal / ignores alignSelf on its content container, so
  // explicit paddingLeft/Right is the reliable lever. See library.tsx.
  // Only the centring inset (web) — the row owns its own horizontal gutter (see history-row).
  const sidePad = topLevelCenterInset(width);

  const openDetail = (a: ActivityEntry) =>
    router.push({
      pathname: '/series',
      params: {
        id: a.seriesId,
        title: a.title,
        bridge: nameOf(a.bridgeId),
        bridgeId: a.bridgeId,
        ...(directOf(a.bridgeId) ? { direct: '1' } : {}),
      },
    });

  const read = (a: ActivityEntry) =>
    router.push({
      pathname: '/reader',
      params: {
        seed: a.seriesId,
        title: a.title,
        bridgeId: a.bridgeId,
        chapterId: a.chapterId,
        chapterName: a.chapterName ?? '',
        start: '0',
      },
    });

  const syncButton = (
    <Pressable
      testID="activity.check-updates"
      onPress={() => syncMutation.mutate()}
      disabled={syncMutation.isPending}
      accessibilityRole="button"
      style={({ pressed }) => [styles.syncBtn, pressed && styles.pressed]}>
      <ThemedView type="backgroundElement" style={styles.syncFill}>
        {syncMutation.isPending ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <ThemedText type="small" style={styles.syncLabel}>
            Check for updates
          </ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );

  const clearButton =
    visible && visible.length > 0 ? (
      <Pressable
        testID="activity.clear"
        onPress={confirmClear}
        disabled={clearMutation.isPending}
        accessibilityRole="button"
        style={({ pressed }) => [styles.syncBtn, pressed && styles.pressed]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.clearLabel}>
          Clear
        </ThemedText>
      </Pressable>
    ) : null;

  const listHeader = (
    <View style={styles.controls}>
      <View style={styles.controlsRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.controlsText}>
          New chapters across your library
        </ThemedText>
        {clearButton}
        {syncButton}
      </View>
    </View>
  );

  const body = () => {
    if (error) return <RetryBlock message={(error as Error).message || 'Failed to load activity'} onRetry={refetch} />;
    if (!ready || isLoading || items === undefined) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
    if (!visible || visible.length === 0) {
      return (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          New chapters in your library appear here automatically.{' '}
          {Platform.OS === 'web' ? 'Tap “Check for updates” to scan now.' : 'Pull down to check now.'}
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
          {listHeader}
          <View style={styles.centerFill}>{emptyBody}</View>
        </View>
      ) : (
        <LegendList
          ref={listRef}
          // Full-width scroller so the scrollbar sits at the window edge; rows centered via sidePad.
          style={styles.list}
          data={rows}
          keyExtractor={(row) =>
            row.kind === 'header' ? `h:${row.label}` : `${row.item.bridgeId}:${row.item.seriesId}:${row.item.chapterId}`
          }
          recycleItems={false}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{
            // Fill the viewport even with few rows, so the empty space below them is still part of
            // the scroller and a drag can be started there (see SeriesGrid's note).
            flexGrow: 1,
            paddingTop: headerHeight + BarContentGap,
            paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
            paddingLeft: sidePad,
            paddingRight: sidePad,
          }}
          renderItem={({ item: row }) =>
            row.kind === 'header' ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                {row.label}
              </ThemedText>
            ) : (
              <HistoryRow
                thumbnailUrl={row.item.thumbnailUrl}
                title={row.item.title}
                sub={activitySub(row.item)}
                dimmed={row.item.read}
                unread={!row.item.read}
                onPress={() => openDetail(row.item)}
                actions={[{ label: row.item.read ? 'Read again' : 'Read', onPress: () => read(row.item) }]}
              />
            )
          }
          showsVerticalScrollIndicator={Platform.OS === 'web'}
          onScroll={onScroll}
          // Pull-to-refresh = the same forced scan as the button. Native only — RN-web has no
          // pull gesture; the button covers it there.
          {...(Platform.OS !== 'web'
            ? {
                refreshing: syncMutation.isPending,
                onRefresh: () => {
                  if (!syncMutation.isPending) syncMutation.mutate();
                },
                progressViewOffset: headerHeight + BarContentGap,
              }
            : {})}
        />
      )}

      <TabTitleBar title="Activity" />
    </ThemedView>
  );
}

/** Row secondary line: `chapter · when` (falls back to "Chapter N" / "New chapter"). */
function activitySub(a: ActivityEntry): string {
  const chapter = a.chapterName ?? (a.number !== undefined ? `Chapter ${a.number}` : 'New chapter');
  return `${chapter}  ·  ${relTime(a.detectedAt)}`;
}

/** Section label for a detection time: Today / Yesterday / a localized date. */
function dayLabel(ts: number): string {
  const day = new Date(ts);
  const today = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(day)) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return day.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
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
  controls: {
    // No leading padding — the list's own `BarContentGap` is the bar->content gap (see theme.ts).
    paddingBottom: Spacing.three,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  // Without this, RN's default `flexShrink: 0` on Text keeps it at its full
  // natural width, leaving no room for the (non-shrinking) sync button —
  // which then overflows the row and gets clipped at the screen edge.
  controlsText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  sectionLabel: {
    fontWeight: '600',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.one,
  },
  syncBtn: {
    borderRadius: 999,
    overflow: 'hidden',
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  syncFill: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncLabel: {
    fontWeight: '600',
  },
  clearLabel: {
    fontWeight: '600',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
});
