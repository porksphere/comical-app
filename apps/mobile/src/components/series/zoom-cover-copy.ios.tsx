import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedTransitionProgress } from 'react-native-screens/reanimated';

import { ZOOM_THUMB_FADE_CLOSE_READER, ZOOM_THUMB_FADE_OPEN } from '@/components/series/page-motion';

/** How long the cover takes to give way to pages that turn up after the zoom has landed. */
const HOLD_RELEASE_MS = 200;

/**
 * iOS: the cover a History or Activity row zooms the reader out of, drawn over the rect the zoom
 * lands on. UIKit zooms the whole reader page out of the row's thumbnail, and that page starts out
 * as its dark surface, so on its own the zoom opens a black window the page then fades into. The
 * drawn zoom this stands in for flew a copy of the cover the same way, and these are its fades:
 * the cover gives way to the page in the second half of the way in, and comes back over it in
 * the last stretch of the way out, so what lands in the row is its own thumbnail.
 *
 * The clock is the screen's own transition progress, which react-native-screens samples off
 * UIKit's transition coordinator: the zoom's timing exactly, and scrubbed by the interactive
 * swipe down. That needs the ReanimatedScreenProvider TabStack puts around each tab's stack.
 *
 * It shows on the way in, and after that for as long as the reader is still `loading` (a page
 * list that arrives late fades in under it, not out of black), and on the way out by a pop.
 * Never while the reader goes under another push or comes back out from under one.
 */
export function ZoomCoverCopy({ uri, loading }: { uri: string; loading: boolean }) {
  const { progress, closing, goingForward } = useReanimatedTransitionProgress();
  const landed = useSharedValue(0);
  const held = useSharedValue(loading ? 1 : 0);
  useEffect(() => {
    if (!loading) held.set(withTiming(0, { duration: HOLD_RELEASE_MS }));
  }, [loading, held]);
  useAnimatedReaction(
    () => !closing.value && progress.value >= 1,
    (done) => {
      if (done) landed.set(1);
    },
  );
  const style = useAnimatedStyle(() => {
    if (closing.value) {
      if (goingForward.value) return { opacity: 0 };
      return { opacity: interpolate(1 - progress.value, ZOOM_THUMB_FADE_CLOSE_READER, [1, 0], Extrapolation.CLAMP) };
    }
    const into = landed.value ? 0 : interpolate(progress.value, ZOOM_THUMB_FADE_OPEN, [1, 0], Extrapolation.CLAMP);
    return { opacity: Math.max(into, held.value) };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
    </Animated.View>
  );
}
