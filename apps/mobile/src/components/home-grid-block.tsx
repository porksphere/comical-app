import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SectionHead } from '@/components/rail';
import { SeriesCard } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchBrowseScope, queryKeys } from '@/data/queries';
import { useDedupedPages } from '@/data/grid-pages';
import { useDataSource, useMockActive } from '@/data/source';
import type { GridPage, HomeGridSection, SeriesEntry } from '@/data/types';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';

/**
 * A non-terminal home grid section: its own heading, grid, and "Load more"
 * button — independent pagination from the main list's infinite scroll,
 * matching the reference's `attachLoadMore` for every grid list but the last.
 *
 * Self-contained (owns its `useInfiniteQuery`) so it can be dropped in as one
 * virtualized row of `ContentFeed` and unmount when scrolled off — its expanded
 * "Load more" pages survive the unmount because they live in the react-query
 * cache (keyed `browseGrid(homeGrid, listId)`), re-seeded from `initialData` on
 * remount.
 */
export function HomeGridBlock({
  bridgeId,
  section,
  bridge,
  direct,
  numColumns,
  headless,
}: {
  bridgeId?: string;
  section: HomeGridSection;
  bridge?: string;
  direct: boolean;
  /** Same column count as the main grid, so cards read at one consistent size. */
  numColumns: number;
  /** Suppress the block's own `SectionHead` — ContentFeed renders it as a separate shared `sectionHead`
   *  row above the block. Default keeps the head so the component stays usable standalone. */
  headless?: boolean;
}) {
  const { cardWidth } = useGridLayout();
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  // Same infinite-query pipeline as the main grid (`homeGrid` scope keyed on this section's list
  // id). Page 1 is seeded from the section itself via `initialData`, so no extra request fires on
  // Home; "Load more" pulls pages 2+.
  const query = useInfiniteQuery({
    queryKey: queryKeys.browseGrid(mock, bridgeId ?? '', { kind: 'homeGrid', listId: section.id }),
    queryFn: ({ pageParam, signal }) =>
      fetchBrowseScope(ds, bridgeId ?? '', { kind: 'homeGrid', listId: section.id }, pageParam, signal),
    enabled: !!bridgeId,
    initialPageParam: 1,
    getNextPageParam: (last: GridPage, _all: GridPage[], lastParam: number) =>
      last.hasNextPage ? lastParam + 1 : undefined,
    initialData: { pages: [{ items: section.items, hasNextPage: section.hasNextPage }], pageParams: [1] },
  });
  // When the underlying section changes (a Home refetch / pull-to-refresh brought fresh page-1
  // content), reset this block's cache to that fresh page 1 — matching the old reset-on-prop-change,
  // discarding any expanded "Load more" pages so the block never shows stale content after a refresh.
  useEffect(() => {
    queryClient.setQueryData(queryKeys.browseGrid(mock, bridgeId ?? '', { kind: 'homeGrid', listId: section.id }), {
      pages: [{ items: section.items, hasNextPage: section.hasNextPage }],
      pageParams: [1],
    });
  }, [section, mock, bridgeId, queryClient]);

  const flat = useDedupedPages(query.data);
  const items = query.data ? flat : section.items;
  const hasNextPage = !!query.hasNextPage;
  const loading = query.isFetchingNextPage;
  const loadMore = () => {
    if (!query.hasNextPage || query.isFetchingNextPage || !bridgeId) return;
    void query.fetchNextPage();
  };

  // Chunk into fixed-column rows, matching the main grid's own `numColumns` + `cardWidth` cell
  // layout exactly (same `row`/`cell` styles) so cards read at the same size everywhere, not a
  // separately-sized wrap grid.
  const rows: SeriesEntry[][] = [];
  for (let i = 0; i < items.length; i += numColumns) rows.push(items.slice(i, i + numColumns));

  return (
    // When headless, drop the block's own top padding too — the shared sectionHead row above it
    // already supplies the heading→body gap (see ContentFeed's HEADING_GAP).
    <View style={[styles.homeGridBlock, headless && styles.homeGridBlockHeadless]}>
      {!headless && <SectionHead title={section.title} />}
      <View style={styles.homeGridRows}>
        {rows.map((row, r) => (
          <View key={r} style={[styles.row, styles.gridRow]}>
            {row.map((item) => (
              // Pinned to `cardWidth`, like SeriesGrid's cells. A short last row just ends — this
              // block used to append invisible spacer views to stop a `flex: 1` cell stretching.
              <View key={item.id} style={[styles.cell, { width: cardWidth }]}>
                <SeriesCard entry={item} bridge={bridge} bridgeId={bridgeId} direct={direct} />
              </View>
            ))}
          </View>
        ))}
      </View>
      {hasNextPage && (
        <Pressable onPress={loadMore} disabled={loading} style={styles.loadMoreButton}>
          <ThemedView type="backgroundElement" style={styles.loadMoreInner}>
            <ThemedText type="smallBold">{loading ? 'Loading…' : 'Load more'}</ThemedText>
          </ThemedView>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  homeGridBlock: {
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  homeGridBlockHeadless: {
    paddingTop: 0,
  },
  homeGridRows: {
    gap: Spacing.three,
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  // Same shape as the main list's `columnWrapperStyle` (`row` + this gap), so a non-terminal home
  // grid's rows lay out identically to the main grid.
  gridRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
  // NO `flex: 1` — pinned to `cardWidth` at the call site, so a short last row ends rather than
  // stretching its cards (which is what the old spacer views existed to prevent).
  cell: {},
  loadMoreButton: {
    alignSelf: 'center',
  },
  loadMoreInner: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
  },
});
