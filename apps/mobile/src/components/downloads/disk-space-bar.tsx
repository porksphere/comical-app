/**
 * A slim animated bar showing how much of the device's storage the downloads occupy. Three adjacent
 * segments make Comical's share unmistakable, laid out like a device storage meter: a muted segment
 * for **other used** space on the left, the accent **Comical downloads** segment in the middle, and
 * the empty remainder for **free** on the right. On web (no real total-disk figure — see `disk.ts`)
 * the bar is hidden and only the downloaded size is shown.
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
  const otherFrac = Math.max(0, usedFrac - downloadsFrac); // space used by everything else

  // Animate Comical's accent segment from 0 to its share on mount / when it changes.
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(downloadsFrac, { duration: 650 });
  }, [downloadsFrac, fill]);
  const dlStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  const pct = downloadsFrac > 0 && downloadsFrac < 0.001 ? '<0.1' : (downloadsFrac * 100).toFixed(1);

  return (
    <View style={styles.wrap}>
      {disk.usable && (
        <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
          {/* Other apps' usage on the left … */}
          <View style={[styles.seg, { width: `${otherFrac * 100}%`, backgroundColor: theme.textSecondary, opacity: 0.35 }]} />
          {/* … Comical's downloads in the middle — the standout accent segment … */}
          <Animated.View style={[styles.seg, dlStyle, { backgroundColor: theme.accent }]} />
          {/* … and free space is the empty remainder on the right. */}
        </View>
      )}
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
    flexDirection: 'row',
  },
  seg: {
    height: BAR_HEIGHT,
  },
});
