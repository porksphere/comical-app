/**
 * The Downloads page storage breakdown: a big total-downloaded figure over a single segmented bar that
 * shows how that space splits ACROSS series — each series a distinct colour, sized to its share — with
 * a compact colour key beneath. Only the largest `MAX_SERIES` get their own segment/colour; everything
 * smaller is folded into one muted "Other" segment so the bar and key stay readable and compact (this
 * sits above the download-management list, which should stay the focus). Distinct from the Storage
 * page's `DiskSpaceBar`, which splits DEVICE space into downloads vs. cache vs. free.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatBytes } from '@/data/downloads/format';
import { useTheme } from '@/hooks/use-theme';
import type { StorageUsageSeries } from '@comical/downloads';

/** How many series get their own colour/segment before the rest fold into "Other". */
const MAX_SERIES = 10;

/** A fixed data-viz palette — distinct hues that read on both light and dark backgrounds. Assigned to
 *  the largest series first, so the bar runs biggest→smallest left→right. */
const PALETTE = [
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
];

interface Segment {
  key: string;
  label: string;
  bytes: number;
  color: string;
}

export function SeriesStorageBar({ bySeries, totalBytes }: { bySeries: StorageUsageSeries[]; totalBytes: number }) {
  const theme = useTheme();

  const sorted = bySeries.filter((s) => s.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const segments: Segment[] = sorted
    .slice(0, MAX_SERIES)
    .map((s, i) => ({ key: `${s.bridgeId}:${s.seriesId}`, label: s.title, bytes: s.bytes, color: PALETTE[i % PALETTE.length] }));
  const rest = sorted.slice(MAX_SERIES);
  if (rest.length > 0) {
    const bytes = rest.reduce((n, s) => n + s.bytes, 0);
    segments.push({ key: '__other', label: `Other (${rest.length})`, bytes, color: theme.textSecondary });
  }

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
            <ThemedText type="small" themeColor="textSecondary">
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
  // A wrapping flow of compact chips — packs biggest→smallest, staying short on a phone.
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
    rowGap: Spacing.one,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    maxWidth: 130, // truncate long titles so a chip stays chip-sized
  },
});
