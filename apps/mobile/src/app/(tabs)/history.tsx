import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HistoryRow } from '@/components/history-row';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { historyQuery, queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { relTime } from '@/lib/rel-time';

export default function HistoryScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [hideNsfw] = useHideNsfw();
  const { byId, nameOf, directOf } = useBridgeMap();

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

  const openDetail = (h: HistoryEntry) =>
    router.push({
      pathname: '/series',
      params: {
        id: h.seriesId,
        title: h.title,
        bridge: nameOf(h.bridgeId),
        bridgeId: h.bridgeId,
        ...(directOf(h.bridgeId) ? { direct: '1' } : {}),
      },
    });

  const resume = (h: HistoryEntry) => {
    const isDirect = h.chapterId === DIRECT_CHAPTER_ID || !h.chapterId;
    router.push({
      pathname: '/reader',
      params: {
        seed: h.seriesId,
        title: h.title,
        bridgeId: h.bridgeId,
        start: String(h.lastPage ?? 0),
        ...(isDirect ? {} : { chapterId: h.chapterId!, chapterName: h.chapterName ?? '' }),
      },
    });
  };

  const body = () => {
    if (error) return <RetryBlock message={(error as Error).message || 'Failed to load history'} onRetry={refetch} />;
    if (isLoading || items === undefined) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
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
        <View style={[styles.centeredColumn, { paddingTop: headerHeight }]}>
          <View style={styles.centerFill}>{emptyBody}</View>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(h) => `${h.bridgeId}:${h.seriesId}`}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerHeight + Spacing.two, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
          ]}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.hairline }]} />}
          renderItem={({ item }) => (
            <HistoryRow
              thumbnailUrl={item.thumbnailUrl}
              title={item.title}
              sub={historySub(item)}
              onOpen={() => openDetail(item)}
              actions={[
                { label: 'Resume', onPress: () => resume(item) },
                { label: 'Remove', onPress: () => removeMutation.mutate(item), ghost: true },
              ]}
            />
          )}
          showsVerticalScrollIndicator={Platform.OS === 'web'}
        />
      )}

      <View
        pointerEvents="box-none"
        style={[
          styles.topBar,
          { paddingTop: insets.top, backgroundColor: theme.background, borderBottomColor: theme.hairline },
        ]}>
        <View style={[styles.titleRow, { height: barHeight }]}>
          <ThemedText numberOfLines={1} style={styles.title}>
            History
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

/** Build the row's secondary line: `chapter · page X / N · when`, omitting absent parts. */
function historySub(h: HistoryEntry): string {
  const isDirect = h.chapterId === DIRECT_CHAPTER_ID;
  const chapter = !isDirect && h.chapterName ? h.chapterName : '';
  const page =
    h.lastPage !== undefined ? (h.pageCount ? `page ${h.lastPage + 1} / ${h.pageCount}` : `page ${h.lastPage + 1}`) : '';
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
  listContent: {
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
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
});
