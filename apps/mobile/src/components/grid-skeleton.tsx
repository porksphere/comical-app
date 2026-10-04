/**
 * Loading skeletons for the series-card grids (Browse + Search): a single card
 * (cover + two title lines) and a block of skeleton rows shown while a grid's
 * first page loads. Extracted from the Browse screen so both grids show the same
 * "cards incoming" placeholder. Mirrors a real card's cell so it reads at the
 * same size and column offset as the cards that replace it.
 */
import { StyleSheet, View } from 'react-native';

import { coverStyles } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { Spacing, TopLevelGutter } from '@/constants/theme';
import { useGridLayout } from '@/hooks/use-grid-layout';
import { useIsDesktop } from '@/hooks/use-responsive';

/** A single skeleton card (cover + two title lines) — one grid cell's worth. */
export function SkeletonCard() {
  const desktop = useIsDesktop();
  // `gridCell` (not the bare cell) so this matches a real card's cell exactly — same flex plus the
  // same top/bottom padding as a real `gridCell`-wrapped SeriesCard.
  return (
    <View style={[styles.gridCell, styles.skelCell]}>
      <Skeleton style={[styles.skelCover, coverStyles.corner, desktop && coverStyles.cornerDesktop]} />
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
  const { columnGap } = useGridLayout();
  return (
    <View style={styles.skelFooter}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={[styles.row, styles.skelRow, { gap: columnGap }]}>
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
    // Mirrors series-grid.tsx's CELL_PAD_TOP/BOTTOM (2px each) so the skeleton reads at the same
    // row rhythm as the cards that replace it.
    paddingTop: Spacing.half,
    paddingBottom: Spacing.half,
  },
  skelFooter: {
    // No top padding: the list's content gap already separates the footer from the last row.
    gap: Spacing.three,
    // Bleed the list's contentContainer horizontal padding back out — the rows self-pad via `row`.
    marginHorizontal: -TopLevelGutter,
  },
  row: {
    paddingHorizontal: TopLevelGutter,
  },
  // Takes the real grid's column gap at the call site, so skeleton columns sit at the same
  // x-offsets as the real cards that replace them.
  skelRow: {
    flexDirection: 'row',
  },
  skelCell: {
    flex: 1,
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
