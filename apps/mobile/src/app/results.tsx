import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarSurface } from '@/components/bar-surface';
import { GridSkeleton } from '@/components/grid-skeleton';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { RetryBlock } from '@/components/retry-block';
import { SeriesGrid } from '@/components/series-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarContentGap, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useDedupedPages } from '@/data/grid-pages';
import { fetchBrowseScope, queryKeys, type BrowseScope } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { GridPage } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { hapticImpactLight } from '@/lib/haptics';
import { useGridLayout } from '@/hooks/use-grid-layout';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

const getNextPageParam = (last: GridPage, _all: GridPage[], lastParam: number) =>
  last.hasNextPage ? lastParam + 1 : undefined;

/**
 * A rail's "See all" destination — a single bridge's infinite-scroll results, with NO search bar.
 * Pushed from any `ContentFeed` rail (Browse home rails, the Comical aggregate, and cross-bridge
 * search rails). Params (all strings — expo-router): `bridgeId`, `title` (the header), `bridge`?
 * (name), `direct`? ('1'), and EITHER `listId` (a list drill → that list's items) OR `query`
 * (a search drill → that bridge's search). Back returns cleanly to wherever it was pushed from.
 */
export default function ResultsScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const listRef = useRef<LegendListRef>(null);
  const { numColumns } = useGridLayout();

  const params = useLocalSearchParams<{
    bridgeId: string;
    title?: string;
    bridge?: string;
    direct?: string;
    listId?: string;
    query?: string;
  }>();
  const bridgeId = params.bridgeId;
  const title = params.title ?? '';
  const direct = params.direct === '1';

  // A search drill (query set) vs a list drill (listId set). `seeAll` is the page-only list scope,
  // matching a Browse rail's "See all" semantics.
  const scope: BrowseScope | null = params.query
    ? { kind: 'search', query: params.query }
    : params.listId
      ? { kind: 'seeAll', listId: params.listId }
      : null;

  const resultsQuery = useInfiniteQuery({
    queryKey: scope ? queryKeys.browseGrid(mock, bridgeId ?? '', scope) : ['browseGrid', 'disabled', 'results'],
    queryFn: ({ pageParam, signal }) => fetchBrowseScope(ds, bridgeId ?? '', scope!, pageParam, signal),
    enabled: !!scope && !!bridgeId,
    initialPageParam: 1,
    getNextPageParam,
    placeholderData: keepPreviousData,
  });

  const gridItems = useDedupedPages(resultsQuery.data);
  const gridError =
    scope && resultsQuery.isError && !resultsQuery.data
      ? friendlyError(resultsQuery.error, "Couldn't load results. Try again.")
      : null;

  const topBarTotal = insets.top + barHeight;
  const loadMore = () => {
    if (!resultsQuery.hasNextPage || resultsQuery.isFetchingNextPage) return;
    void resultsQuery.fetchNextPage();
  };
  const goBack = () => {
    hapticImpactLight();
    router.back();
  };

  // Loading / error / empty, folded into the list header like the other grids.
  const emptyBody =
    gridItems.length > 0 ? null : gridError ? (
      <RetryBlock message={gridError} onRetry={() => resultsQuery.refetch()} />
    ) : resultsQuery.isLoading ? (
      <GridSkeleton numColumns={numColumns} rows={3} />
    ) : (
      <View style={styles.hint}>
        <ThemedText type="small" themeColor="textSecondary">
          No results
        </ThemedText>
      </View>
    );

  return (
    <ThemedView style={styles.container}>
      {/* Fixed top bar: back + the rail's title. No search field, no filters — this is a read-only
          drill-down into one bridge's results. The grid scrolls under the frosted bar. */}
      <BarSurface style={styles.topBar}>
        <View style={[styles.topBarRow, { height: barHeight }]}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            android_ripple={{ color: theme.backgroundSelected, borderless: true }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}>
            <ChevronLeftIcon color={theme.text} />
          </Pressable>
          <ThemedText type="subtitle" numberOfLines={1} style={styles.title}>
            {title}
          </ThemedText>
        </View>
      </BarSurface>

      <SeriesGrid
        items={gridItems}
        scopeKey={`${bridgeId}|${params.listId ?? params.query ?? ''}`}
        listRef={listRef}
        header={emptyBody}
        paddingTop={topBarTotal + BarContentGap}
        paddingBottom={insets.bottom + Spacing.five}
        bridge={params.bridge}
        bridgeId={bridgeId}
        direct={direct}
        onEndReached={loadMore}
      />
    </ThemedView>
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
    zIndex: 20,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    width: '100%',
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  hint: {
    alignItems: 'center',
    paddingTop: Spacing.six,
  },
});
