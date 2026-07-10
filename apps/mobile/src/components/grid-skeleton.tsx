/**
 * Loading skeletons for the series-card grids (Browse + Search): a single card
 * (cover + two title lines) and a block of skeleton rows shown while a grid's
 * first page loads. Extracted from the Browse screen so both grids show the same
 * "cards incoming" placeholder. Mirrors a real card's cell so it reads at the
 * same size and column offset as the cards that replace it.
 */
import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/skeleton';
import { Spacing } from '@/constants/theme';
import { GRID_COLUMN_GAP } from '@/hooks/use-grid-layout';

/** A single skeleton card (cover + two title lines) — one grid cell's worth. */
export function SkeletonCard() {
  // `gridCell` (not the bare cell) so this matches a real card's cell exactly — same flex plus the
  // same top/bottom padding as a real `gridCell`-wrapped SeriesCard.
  return (
    <View style={[styles.gridCell, styles.skelCell]}>
      <Skeleton style={styles.skelCover} />
      <Skeleton style={styles.skelLine} />
      <Skeleton style={[styles.skelLine, styles.skelLineShort]} />
    </View>
  );
}

/**
 * Skeleton rows shown while a grid's first page loads (scope switch, retry, etc.).
 * Infinite-scroll pagination itself shows no skeleton — only the initial load.
 */
export function GridSkeleton({ numColumns, rows }: { numColumns: number; rows: number }) {
  return (
    <View style={styles.skelFooter}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={[styles.row, styles.skelRow]}>
          {Array.from({ length: numColumns }).map((_, c) => (
            <SkeletonCard key={c} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gridCell: {
    flex: 1,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three - Spacing.one,
  },
  skelFooter: {
    // No top padding: the list's content gap already separates the footer from the last row.
    gap: Spacing.three,
    // Bleed the list's contentContainer horizontal padding back out — the rows self-pad via `row`.
    marginHorizontal: -Spacing.four,
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  // Same column gap as the real grid's columnWrapperStyle so skeleton columns sit at the same
  // x-offsets as the real cards that replace them.
  skelRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
  skelCell: {
    flex: 1,
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
