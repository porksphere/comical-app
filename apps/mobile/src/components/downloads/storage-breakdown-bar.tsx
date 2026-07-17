/**
 * The shared storage-breakdown widget: a big total figure over a single segmented bar — each segment
 * a distinct colour sized to its share — with a compact colour-key legend beneath (label + size per
 * segment, in a fixed two-column grid so ticking numbers never re-flow their neighbours). The
 * Downloads page feeds it per-series segments (`SeriesStorageBar`); the Storage page feeds it the
 * downloads / library / cache split.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatBytes } from '@/data/downloads/format';
import { useTheme } from '@/hooks/use-theme';

/** A fixed data-viz palette — distinct hues that read on both light and dark backgrounds. */
export const STORAGE_PALETTE = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#10B981', // green
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#84CC16', // lime
] as const;

export interface StorageSegment {
  key: string;
  label: string;
  bytes: number;
  color: string;
}

export function StorageBreakdownBar({ segments, totalBytes }: { segments: StorageSegment[]; totalBytes: number }) {
  const theme = useTheme();
  // Guard the divisor; fall back to the summed segment bytes if the rollup total is somehow 0.
  const total = totalBytes || segments.reduce((n, s) => n + s.bytes, 0) || 1;

  return (
    <View style={styles.wrap}>
      <ThemedText type="title">{formatBytes(totalBytes)}</ThemedText>

      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        {segments.map((seg) => (
          <View key={seg.key} style={{ width: `${(seg.bytes / total) * 100}%`, backgroundColor: seg.color }} />
        ))}
      </View>

      <View style={styles.legend}>
        {segments.map((seg) => (
          <View key={seg.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: seg.color }]} />
            <ThemedText type="small" numberOfLines={1} style={styles.legendLabel}>
              {seg.label}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {formatBytes(seg.bytes)}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const BAR_HEIGHT = 10;

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  // A FIXED two-column grid, not a content-width wrap: each item owns exactly half the width, so a
  // size number changing (during a download) never re-flows or shuffles the other labels — it just
  // updates in its own cell. `paddingRight` on each cell is the inter-column gap.
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.one,
  },
  legendItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingRight: Spacing.two,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // Absorbs the row's slack (and truncates a long title) so the trailing size sits at a stable spot and
  // the label re-truncates in place rather than pushing anything.
  legendLabel: {
    flex: 1,
    minWidth: 0,
  },
});
