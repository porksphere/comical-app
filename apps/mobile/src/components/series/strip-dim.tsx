import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { FADE_WINDOW } from '@/components/series/split-handoff';
import { useTheme } from '@/hooks/use-theme';

/**
 * What dims the reader as it becomes the details' strip: a light tint early in the travel, then
 * the strip's heavy fade toward the THEME background (not black), so the strip reads as a
 * faded-out image and the title over the seam stays legible in both themes.
 *
 * Over the PAGES but UNDER the bottom chrome: ReaderPane renders it between the readers and the
 * navigator, so a handoff part way never washes out the scrubber and skip buttons.
 */
export function StripDim({ progress }: { progress: SharedValue<number> }) {
  const theme = useTheme();
  const tintStyle = useAnimatedStyle(() => ({ opacity: 0.18 * Math.min(1, progress.value / FADE_WINDOW) }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: 0.55 * progress.value }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tint, tintStyle]} />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, fadeStyle]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  tint: {
    backgroundColor: '#000',
  },
});
