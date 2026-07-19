import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// Swipe-away dismissal for the full-screen reader (NATIVE only — on web the
// children render untouched). The gesture ACTIVATES on the axis the reader does
// NOT scroll on — vertical for the horizontal paged reader, horizontal for the
// vertical webtoon — so it never competes with page turning: the pan only claims
// the touch after a clear cross-axis drag and fails on a scroll-axis one. Once
// active the page follows the finger in BOTH axes, fading with distance
// travelled, and the caller's `progress` value fades its backdrop/chrome in
// lockstep (revealing the screen behind — the reader route is a transparent
// modal). Releasing past a quarter of the screen (or a fast flick) flings the
// page out along the gesture's own direction and closes the reader; anything
// less springs back.
//
// Everything runs on the UI thread: gesture updates write shared values,
// the styles are transform/opacity only, and the backdrop/chrome fade derives
// via useAnimatedReaction — no React re-renders during the gesture.

const ACTIVATE_PX = 20; // cross-axis drag before the dismiss pan claims the touch
const FAIL_PX = 15; // scroll-axis drift that hands the touch back to the list
const DISMISS_FRACTION = 0.25; // released past this fraction of the screen → dismiss
const FLICK_VELOCITY = 900; // px/s on the cross axis — a fast flick dismisses regardless of distance
const EXIT_MS = 180;

type Props = {
  /** The activation axis — always the opposite of the reader's scroll axis. */
  axis: 'vertical' | 'horizontal';
  width: number;
  height: number;
  /** Off while a page is zoomed — its own pan owns one-finger drags then. */
  enabled: boolean;
  onDismiss: () => void;
  /** Mirrors dismissal progress (0 at rest → 1 fully swiped away), written on the
   *  UI thread — the reader fades its backdrop and chrome from it. */
  progress?: SharedValue<number>;
  children: ReactNode;
};

export function SwipeDismiss({ axis, width, height, enabled, onDismiss, progress, children }: Props) {
  const vertical = axis === 'vertical';
  const span = vertical ? height : width;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dismissing = useSharedValue(false);

  // Flipping reader mode swaps the axis mid-mount — drop any stale offset.
  useEffect(() => {
    tx.set(0);
    ty.set(0);
    dismissing.set(false);
  }, [axis, tx, ty, dismissing]);

  // Progress is DERIVED from the live offsets (not written imperatively), so the
  // drag, the spring-back, and the exit fling all drive the caller's backdrop
  // fade automatically, entirely on the UI thread.
  useAnimatedReaction(
    () => Math.min(1, Math.hypot(tx.value, ty.value) / span),
    (p) => progress?.set(p),
  );

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onUpdate((e) => {
      if (dismissing.value) return;
      tx.set(e.translationX);
      ty.set(e.translationY);
    })
    .onEnd((e) => {
      if (dismissing.value) return;
      // The dismiss DECISION stays on the activation axis (predictable), even
      // though the page visually follows the finger in both.
      const cross = vertical ? ty.value : tx.value;
      const crossVelocity = vertical ? e.velocityY : e.velocityX;
      const byFlick = Math.abs(crossVelocity) > FLICK_VELOCITY;
      if (!byFlick && Math.abs(cross) < span * DISMISS_FRACTION) {
        tx.set(withSpring(0, { damping: 18, stiffness: 220 }));
        ty.set(withSpring(0, { damping: 18, stiffness: 220 }));
        return;
      }
      dismissing.set(true);
      // Fling out along the gesture's own direction — the release velocity when
      // it was a flick, the accumulated travel otherwise — never a fixed
      // axis-aligned path. One extra span of travel puts the distance-driven
      // opacity at 0 with the page well offscreen.
      let dirX = byFlick ? e.velocityX : tx.value;
      let dirY = byFlick ? e.velocityY : ty.value;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;
      tx.set(withTiming(tx.value + dirX * span, { duration: EXIT_MS }));
      ty.set(
        withTiming(ty.value + dirY * span, { duration: EXIT_MS }, (finished) => {
          if (finished) runOnJS(onDismiss)();
        }),
      );
    });
  if (vertical) pan.activeOffsetY([-ACTIVATE_PX, ACTIVATE_PX]).failOffsetX([-FAIL_PX, FAIL_PX]);
  else pan.activeOffsetX([-ACTIVATE_PX, ACTIVATE_PX]).failOffsetY([-FAIL_PX, FAIL_PX]);

  // Fade tracks distance travelled: fully opaque at rest, fully gone a whole
  // span away — the exit fling covers the tail, so the fade reads as "mostly at
  // the end" without a separate curve.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.hypot(tx.value, ty.value), [0, span], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
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
