/**
 * A cumulative download radial with an optional centred percentage — the big one atop the Downloads
 * page and (label off) the small one on the Settings › Downloads row. Always drawn in the
 * `downloading` tone; callers render it only while downloads are actually in progress.
 */
import { StyleSheet, View } from 'react-native';

import { DownloadRadial } from '@/components/downloads/download-radial';
import { ThemedText } from '@/components/themed-text';

export function CumulativeDownloadRadial({
  fraction,
  size = 64,
  strokeWidth = 5,
  showLabel = false,
}: {
  fraction: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <DownloadRadial fraction={fraction} state="downloading" size={size} strokeWidth={strokeWidth} />
      {showLabel && (
        <View style={styles.label} pointerEvents="none">
          <ThemedText type="smallBold">{pct}%</ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
