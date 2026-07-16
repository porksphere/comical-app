/**
 * A slim animated bar showing how much of the device's storage Comical occupies, laid out like a
 * device storage meter: a muted **other used** segment on the left, then Comical's own two segments —
 * the solid-accent **downloads** (durable, kept for offline) and the translucent-accent **cache**
 * (reclaimable images) — and the empty remainder for **free** on the right. The solid vs. translucent
 * accent reads as "kept" vs. "reclaimable" at a glance. On web (no real total-disk figure — see
 * `disk.ts`) the track is hidden and only the byte breakdown is shown.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { readDiskInfo } from '@/data/downloads/disk';
import { formatBytes } from '@/data/downloads/format';
import { useTheme } from '@/hooks/use-theme';

export function DiskSpaceBar({ downloadsBytes, cacheBytes = 0 }: { downloadsBytes: number; cacheBytes?: number }) {
  const theme = useTheme();
  const disk = readDiskInfo();

  const frac = (b: number) => (disk.usable && disk.total > 0 ? Math.min(1, b / disk.total) : 0);
  const downloadsFrac = frac(downloadsBytes);
  const cacheFrac = frac(cacheBytes);
  const usedFrac = disk.usable && disk.total > 0 ? Math.min(1, (disk.total - disk.available) / disk.total) : 0;
  const otherFrac = Math.max(0, usedFrac - downloadsFrac - cacheFrac); // space used by everything else

  // Animate Comical's two segments from 0 to their share on mount / when they change.
  const dl = useSharedValue(0);
  const ca = useSharedValue(0);
  useEffect(() => {
    dl.value = withTiming(downloadsFrac, { duration: 650 });
    ca.value = withTiming(cacheFrac, { duration: 650 });
  }, [downloadsFrac, cacheFrac, dl, ca]);
  const dlStyle = useAnimatedStyle(() => ({ width: `${dl.value * 100}%` }));
  const caStyle = useAnimatedStyle(() => ({ width: `${ca.value * 100}%` }));

  return (
    <View style={styles.wrap}>
      {disk.usable && (
        <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
          {/* Other apps' usage on the left … */}
          <View style={[styles.seg, { width: `${otherFrac * 100}%`, backgroundColor: theme.textSecondary, opacity: 0.3 }]} />
          {/* … Comical's durable downloads — the standout solid accent … */}
          <Animated.View style={[styles.seg, dlStyle, { backgroundColor: theme.accent }]} />
          {/* … its reclaimable image cache — a lighter accent, reading as "can be freed" … */}
          <Animated.View style={[styles.seg, caStyle, { backgroundColor: theme.accent, opacity: 0.45 }]} />
          {/* … and free space is the empty remainder on the right. */}
        </View>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {disk.usable
          ? `${formatBytes(downloadsBytes)} downloads · ${formatBytes(cacheBytes)} cache · ${formatBytes(disk.available)} free`
          : `${formatBytes(downloadsBytes)} downloads · ${formatBytes(cacheBytes)} cache`}
      </ThemedText>
    </View>
  );
}

const BAR_HEIGHT = 8;

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
    paddingVertical: Spacing.one,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  seg: {
    height: BAR_HEIGHT,
  },
});
