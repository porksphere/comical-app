import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

import { useActiveColorScheme } from '@/hooks/use-theme';

// How frosted the top/bottom bars are (0–100). High enough that content scrolling under the bar
// doesn't fight the bar's own text/controls, while still reading as translucent.
const BAR_BLUR_INTENSITY = 60;

/**
 * Frosted background for the app's top and bottom bars — an absolute-fill layer placed BEHIND a
 * bar's own content (so drop the bar's solid `backgroundColor` and render this first). Matches iOS's
 * translucent bars: content scrolls under and shows through the blur.
 *
 * iOS + web get a real blur (iOS via the native `UIVisualEffectView`, which is what the OS uses for
 * its own bars — cheap even over a scrolling list; web via `backdrop-filter`). Android falls back to
 * a solid fill: its blur is the experimental Dimezis path, which is costly to recompute every frame
 * under a fast-scrolling grid and would reintroduce scroll jank on the always-present bars.
 */
export function BarBlur({ fallback }: { fallback: string }) {
  const scheme = useActiveColorScheme();
  if (Platform.OS === 'android') {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fallback }]} />;
  }
  return (
    <BlurView
      pointerEvents="none"
      tint={scheme === 'dark' ? 'dark' : 'light'}
      intensity={BAR_BLUR_INTENSITY}
      style={StyleSheet.absoluteFill}
    />
  );
}
