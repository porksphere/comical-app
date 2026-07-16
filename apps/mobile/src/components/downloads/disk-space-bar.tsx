/**
 * A slim animated bar showing how much of the device's storage the downloads occupy. The accent fill
 * is downloads-as-a-fraction-of-total-disk (the headline the Downloads screen wants); a fainter fill
 * behind it shows total device usage for context, so the accent reads as "downloads within everything
 * else used." On web (no real total-disk figure — see `disk.ts`) it degrades to just the downloaded
 * size with no ratio.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { readDiskInfo } from '@/data/downloads/disk';
import { formatBytes } from '@/data/downloads/format';
import { useTheme } from '@/hooks/use-theme';

export function DiskSpaceBar({ downloadsBytes }: { downloadsBytes: number }) {
  const theme = useTheme();
  const disk = readDiskInfo();

  const downloadsFrac = disk.usable && disk.total > 0 ? Math.min(1, downloadsBytes / disk.total) : 0;
  const usedFrac = disk.usable && disk.total > 0 ? Math.min(1, (disk.total - disk.available) / disk.total) : 0;

  // Animate the accent (downloads) fill from 0 to its value on mount / when it changes.
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(downloadsFrac, { duration: 650 });
  }, [downloadsFrac, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  const pct = downloadsFrac > 0 && downloadsFrac < 0.001 ? '<0.1' : (downloadsFrac * 100).toFixed(1);

  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        {/* Total device usage (context), behind the accent. */}
        {disk.usable && (
          <View style={[styles.otherFill, { width: `${usedFrac * 100}%`, backgroundColor: theme.hairline }]} />
        )}
        {/* Downloads' share, animated. */}
        <Animated.View style={[styles.dlFill, fillStyle, { backgroundColor: theme.accent }]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {disk.usable
          ? `${formatBytes(downloadsBytes)} · ${pct}% of ${formatBytes(disk.total)} · ${formatBytes(disk.available)} free`
          : `${formatBytes(downloadsBytes)} downloaded`}
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
  },
  otherFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: BAR_HEIGHT / 2,
  },
  dlFill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
  },
});
