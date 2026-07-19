import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// Swipe-away dismissal for the full-screen reader (NATIVE only — on web the
// children render untouched). The gesture lives on the axis the reader does
// NOT scroll on — vertical for the horizontal paged reader, horizontal for the
// vertical webtoon — so it never competes with page turning: the pan only
// activates after a clear cross-axis drag and fails on a scroll-axis one, and
// a genuine tap never moves far enough to leave the tap zones. The current
// page follows the finger and fades as it travels; releasing past a quarter of
// the screen (or a fast flick) finishes the slide-out and closes the reader,
// anything less springs back into place.

const ACTIVATE_PX = 20; // cross-axis drag before the dismiss pan claims the touch
const FAIL_PX = 15; // scroll-axis drift that hands the touch back to the list
const DISMISS_FRACTION = 0.25; // released past this fraction of the screen → dismiss
const FLICK_VELOCITY = 900; // px/s — a fast flick dismisses regardless of distance

type Props = {
  /** The dismissal travel axis — always the opposite of the reader's scroll axis. */
  axis: 'vertical' | 'horizontal';
  width: number;
  height: number;
  /** Off while a page is zoomed — its own pan owns one-finger drags then. */
  enabled: boolean;
  onDismiss: () => void;
  children: ReactNode;
};

export function SwipeDismiss({ axis, width, height, enabled, onDismiss, children }: Props) {
  const vertical = axis === 'vertical';
  const span = vertical ? height : width;
  const offset = useSharedValue(0);
  const dismissing = useSharedValue(false);

  // Flipping reader mode swaps the axis mid-mount — drop any stale offset.
  useEffect(() => {
    offset.set(0);
    dismissing.set(false);
  }, [axis, offset, dismissing]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onUpdate((e) => {
      if (dismissing.value) return;
      offset.set(vertical ? e.translationY : e.translationX);
    })
    .onEnd((e) => {
      if (dismissing.value) return;
      const travelled = offset.value;
      const velocity = vertical ? e.velocityY : e.velocityX;
      const byFlick = Math.abs(velocity) > FLICK_VELOCITY;
      if (!byFlick && Math.abs(travelled) < span * DISMISS_FRACTION) {
        offset.set(withSpring(0, { damping: 18, stiffness: 220 }));
        return;
      }
      dismissing.set(true);
      const direction = byFlick ? Math.sign(velocity) : Math.sign(travelled) || 1;
      offset.set(
        withTiming(direction * span, { duration: 180 }, (finished) => {
          if (finished) runOnJS(onDismiss)();
        }),
      );
    });
  if (vertical) pan.activeOffsetY([-ACTIVATE_PX, ACTIVATE_PX]).failOffsetX([-FAIL_PX, FAIL_PX]);
  else pan.activeOffsetX([-ACTIVATE_PX, ACTIVATE_PX]).failOffsetY([-FAIL_PX, FAIL_PX]);

  // Fade tracks distance travelled: fully opaque at rest, fully gone only at a
  // full screen away — the release animation covers the tail, so the fade reads
  // as "mostly at the end" without a separate curve.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(offset.value), [0, span], [1, 0], Extrapolation.CLAMP),
    transform: vertical ? [{ translateY: offset.value }] : [{ translateX: offset.value }],
  }));

  // Web keeps its own input model (wheel/keyboard/click); no swipe-away there.
  if (Platform.OS === 'web') return <>{children}</>;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
