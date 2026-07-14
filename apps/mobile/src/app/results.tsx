import type { LegendListRef } from '@legendapp/list/react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GridSkeleton } from '@/components/grid-skeleton';
import { RetryBlock } from '@/components/retry-block';
import { SeriesGrid } from '@/components/series-grid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, Spacing } from '@/constants/theme';
import { useDedupedPages } from '@/data/grid-pages';
import { fetchBrowseScope, queryKeys, type BrowseScope } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { GridPage } from '@/data/types';
import { friendlyError } from '@/lib/friendly-error';
import { useGridLayout } from '@/hooks/use-grid-layout';

const getNextPageParam = (last: GridPage, _all: GridPage[], lastParam: number) =>
  last.hasNextPage ? lastParam + 1 : undefined;

/**
 * A rail's "See all" destination — a single bridge's infinite-scroll results, with NO search bar.
 * Pushed from any `ContentFeed` rail (Browse home rails, the Comical aggregate, and cross-bridge
 * search rails). Uses the shared `TopBar` like every other pushed screen; the title is a breadcrumb
 * "{bridge} › {title}" (e.g. "Example › Featured"). Params (all strings — expo-router): `bridgeId`,
 * `title`, `bridge`? (name), `direct`? ('1'), and EITHER `listId` (a list drill → that list's items)
 * OR `query` (a search drill → that bridge's search). Back returns cleanly.
 */
export default function ResultsScreen() {
  const ds = useDataSource();
  const mock = useMockActive();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
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
  const direct = params.direct === '1';
  // Breadcrumb: "{bridge} › {section}" — the bridge, then the rail/list/query it drilled into.
  const headerTitle = params.bridge ? `${params.bridge}  ›  ${params.title ?? ''}` : (params.title ?? '');

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

  const loadMore = () => {
    if (!resultsQuery.hasNextPage || resultsQuery.isFetchingNextPage) return;
    void resultsQuery.fetchNextPage();
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
      <SeriesGrid
        items={gridItems}
        scopeKey={`${bridgeId}|${params.listId ?? params.query ?? ''}`}
        listRef={listRef}
        header={emptyBody}
        // The TopBar overlays the list, so reserve its height (content scrolls under its frost).
        paddingTop={topBarInset + BarContentGap}
        paddingBottom={insets.bottom + Spacing.five}
        bridge={params.bridge}
        bridgeId={bridgeId}
        direct={direct}
        onEndReached={loadMore}
      />
      <TopBar title={headerTitle} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hint: {
    alignItems: 'center',
    paddingTop: Spacing.six,
  },
});
