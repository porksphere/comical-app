import { Image } from 'expo-image';
import { useState } from 'react';
import { ImageStyle, StyleProp, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

/** A bridge's thumbnail: the image if `uri` is set and loads, otherwise a
 *  fallback of the bridge name's first letter — so every bridge reads
 *  consistently (dropdown rows, the browse top bar, …) whether or not it has
 *  art, and a broken/unreachable thumbnail URL degrades the same way as
 *  having none.
 *
 *  `size` sets the box's width/height (and scales the fallback letter). Pass
 *  `fill` instead when the box's size is already controlled by an external
 *  (possibly animated) wrapper — e.g. the browse top bar sizes its thumbnail
 *  wrapper via a reanimated style, and an explicit width/height here would
 *  fight that: `StyleSheet.absoluteFill` has no width/height keys to
 *  override ours with, so both would apply at once, pinning the image at a
 *  fixed size anchored top-left inside the (larger) animated box instead of
 *  stretching to fill it. `size` still drives the fallback letter's scale. */
export function BridgeThumb({
  uri,
  label,
  size,
  fill,
  style,
}: {
  uri?: string;
  label: string;
  size: number;
  fill?: boolean;
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const boxStyle = fill ? StyleSheet.absoluteFill : { width: size, height: size };
  if (!uri || failed) {
    const letter = label.trim().charAt(0).toUpperCase() || '?';
    return (
      <ThemedView type="backgroundSelected" style={[boxStyle, styles.fallback, style]}>
        <ThemedText style={{ fontSize: size * 0.46, fontWeight: '700' }}>{letter}</ThemedText>
      </ThemedView>
    );
  }
  return <Image source={{ uri }} style={[boxStyle, style]} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
