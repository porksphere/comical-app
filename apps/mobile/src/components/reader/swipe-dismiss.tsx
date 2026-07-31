import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
// active the page follows the finger in BOTH axes, shrinking but staying fully
// opaque, while the backdrop — a STATIC full-screen dim layer behind it — fades
// out in place with distance travelled (the X media-viewer treatment: the page
// slides over the screen behind, it doesn't drag a black rectangle along;
// the reader route is a transparent modal, so the screen underneath shows
// through the thinning dim). The caller's `progress` value fades its chrome in
// lockstep. Releasing past a quarter of the screen (or a fast flick) flings the
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
const MIN_SCALE = 0.45; // the page shrinks to this, reached at SCALE_SPAN_FRACTION of a span
const SCALE_SPAN_FRACTION = 0.7; // scale bottoms out before a full span, so it shrinks noticeably early
// Clean, non-bouncy spring-back — critically damped so the page returns without the wobble.
const SPRING_BACK = { duration: 300, dampingRatio: 1 } as const;

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
  /** Fired when the dismiss pan ACTIVATES / settles (JS thread). The reader uses
   *  this to suppress its tap zones for the gesture's lifetime: a plain RN
   *  Pressable doesn't see the moves the pan consumes, so on release it would
   *  otherwise fire a stray page-turn / chrome-toggle tap. */
  onSwipeStart?: () => void;
  onSwipeEnd?: () => void;
  /** Fired on raw touch-down, before any activation threshold — a plain tap
   *  reaches this too. Distinct from `onSwipeStart`: this is a "the user is
   *  touching the reader" signal (e.g. for keeping auto-hiding chrome alive
   *  through a touch that never ends up dragging far enough to activate the
   *  pan at all), not a "the dismiss gesture is active" one. */
  onTouchBegin?: () => void;
  /** Painted as a STATIC absolute-fill layer BEHIND the transformed page. It
   *  never moves with the drag; its opacity fades from full to nothing over a
   *  span of travel, so swiping reads as the page pulling away over the screen
   *  behind while the dim dissolves in place (see the call site). */
  backdropColor?: string;
  children: ReactNode;
};

export function SwipeDismiss({
  axis,
  width,
  height,
  enabled,
  onDismiss,
  progress,
  onSwipeStart,
  onSwipeEnd,
  onTouchBegin,
  backdropColor,
  children,
}: Props) {
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
    .onBegin(() => {
      // Fires on raw touch-down, before the activeOffset threshold — unlike
      // onStart, this reaches a plain tap or a drag too small to activate.
      if (onTouchBegin) runOnJS(onTouchBegin)();
    })
    .onStart(() => {
      // Fires on ACTIVATION (after the activeOffset threshold) — a pure tap never
      // gets here, so the reader's tap zones stay live for real taps.
      if (onSwipeStart) runOnJS(onSwipeStart)();
    })
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
        tx.set(withSpring(0, SPRING_BACK));
        ty.set(withSpring(0, SPRING_BACK));
        return;
      }
      dismissing.set(true);
      // Fling out along the gesture's own direction — the release velocity when
      // it was a flick, the accumulated travel otherwise — never a fixed
      // axis-aligned path. The page stays opaque, so the travel must clear the
      // screen geometrically: a full screen DIAGONAL covers the worst case (a
      // near-diagonal fling released close to the origin), where one span would
      // leave a corner of the scaled page peeking in. The backdrop's
      // distance-driven opacity crosses its span and hits 0 en route.
      let dirX = byFlick ? e.velocityX : tx.value;
      let dirY = byFlick ? e.velocityY : ty.value;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;
      const exit = Math.hypot(width, height);
      tx.set(withTiming(tx.value + dirX * exit, { duration: EXIT_MS }));
      ty.set(
        withTiming(ty.value + dirY * exit, { duration: EXIT_MS }, (finished) => {
          if (finished) runOnJS(onDismiss)();
        }),
      );
    })
    // Always fires once the gesture resolves (release OR cancel), so the tap
    // suppression clears even on a failed/interrupted swipe.
    .onFinalize(() => {
      if (onSwipeEnd) runOnJS(onSwipeEnd)();
    });
  if (vertical) pan.activeOffsetY([-ACTIVATE_PX, ACTIVATE_PX]).failOffsetX([-FAIL_PX, FAIL_PX]);
  else pan.activeOffsetX([-ACTIVATE_PX, ACTIVATE_PX]).failOffsetY([-FAIL_PX, FAIL_PX]);

  // The page shrinks with distance travelled but never fades — X-style, the
  // dragged page stays solid and only the dim layer behind it dissolves. Scale
  // is listed after the translate so the page shrinks toward its own (moved)
  // centre, i.e. it pulls away under the finger rather than snapping to origin.
  const animatedStyle = useAnimatedStyle(() => {
    const dist = Math.hypot(tx.value, ty.value);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scale: interpolate(dist, [0, span * SCALE_SPAN_FRACTION], [1, MIN_SCALE], Extrapolation.CLAMP) },
      ],
    };
  });

  // The backdrop's fade in place: proportional to distance, gone a whole span
  // away. Still ~75% dim at the release threshold — fading fully by then would
  // flash the screen behind during a drag that ends up cancelled. Derived from
  // the same offsets as the transform, so the drag, the spring-back, and the
  // exit fling all animate it with no imperative writes.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.hypot(tx.value, ty.value), [0, span], [1, 0], Extrapolation.CLAMP),
  }));

  // Web keeps its own input model (wheel/keyboard/click); no swipe-away there,
  // so the backdrop just sits static behind the content — nothing to sync.
  if (Platform.OS === 'web') {
    if (!backdropColor) return <>{children}</>;
    return (
      <Animated.View style={styles.fill}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]} />
        {children}
      </Animated.View>
    );
  }

  return (
    <View style={styles.fill}>
      {backdropColor && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }, backdropStyle]}
        />
      )}
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
