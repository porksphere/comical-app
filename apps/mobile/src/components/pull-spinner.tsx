import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** Twelve, like `UIActivityIndicatorView` — enough that the chase reads as rotation, not as steps. */
const SPOKES = 12;
const SPOKE_INDEXES = Array.from({ length: SPOKES }, (_, i) => i);

// Ring geometry, all as fractions of `size` so the whole thing scales from one number. Tuned to
// UIActivityIndicatorView's proportions: outer tip at ~0.46·size from the centre, spokes ~0.30·size
// long. That leaves the tips clearly separated but the inner ends overlapping, which is what makes
// it read as a solid ring rather than twelve loose dashes.
/** Gap between the box's edge and the outer tip of a spoke. */
const INSET = 0.04;
/** Spoke length. */
const LENGTH = 0.3;
/** Spoke thickness (floored in px below, so it can't vanish at small sizes). */
const THICKNESS = 0.11;

/** Dimmest a spoke gets while the chase runs — the ring has to stay legible AS a ring. */
const TAIL_FLOOR = 0.18;
/** One revolution while refreshing. */
const SPIN_MS = 900;

/**
 * The pull-to-refresh spinner: twelve spokes radiating from a centre, hand-rolled.
 *
 * This is the shape `UIRefreshControl` draws, and it's here rather than `ActivityIndicator` for the
 * one property that matters to a pull gesture — **it has a determinate state**. `ActivityIndicator`
 * is indeterminate-only, so a pull could only fade it in; the drag had nothing to drive. Spokes have
 * a natural progress form:
 *
 * - **Pulling**: the spokes light up clockwise, one at a time, so the ring *completes* exactly as
 *   the pull reaches the trigger line and the haptic fires. That's the gesture feedback the app's
 *   old open-book mark had and the ActivityIndicator swap lost.
 * - **Refreshing**: the brightest point chases around the ring, fading behind itself — the
 *   spin, which is what says the refresh actually fired rather than merely being armed.
 *
 * Built from plain Views with a rotation transform and an animated opacity each — no SVG, no
 * per-frame prop animation, no native control — so iOS, Android and web draw exactly the same
 * thing. That matters here because this is the ONLY spinner now: the native `RefreshControl` was
 * tried on iOS/Android and reverted (`progressViewOffset` repositions the control without opening
 * inset space for it, so it collided with the cells — facebook/react-native#35283), so all three
 * platforms are back on the custom overlay this draws into.
 */
export function PullSpinner({
  pullY,
  pullThreshold,
  refreshing,
  color,
  size = 20,
}: {
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  color: string;
  size?: number;
}) {
  // Sweep position, 0→1 per revolution, running only while refreshing. Linear on purpose: an eased
  // repeat would read as a stutter once per turn.
  const spin = useSharedValue(0);
  useEffect(() => {
    if (refreshing) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
    return () => cancelAnimation(spin);
  }, [refreshing, spin]);

  return (
    <View style={{ width: size, height: size }}>
      {SPOKE_INDEXES.map((i) => (
        <Spoke
          key={i}
          index={i}
          size={size}
          color={color}
          pullY={pullY}
          pullThreshold={pullThreshold}
          refreshing={refreshing}
          spin={spin}
        />
      ))}
    </View>
  );
}

/**
 * One spoke. A child component rather than a loop of `useAnimatedStyle` calls inline, so each spoke
 * owns exactly one hook and the count is fixed by `SPOKES` (a module constant) rather than by
 * anything that could change between renders.
 */
function Spoke({
  index,
  size,
  color,
  pullY,
  pullThreshold,
  refreshing,
  spin,
}: {
  index: number;
  size: number;
  color: string;
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  spin: SharedValue<number>;
}) {
  const thickness = Math.max(2, size * THICKNESS);
  const length = size * LENGTH;
  const inset = size * INSET;
  // Where this spoke sits around the ring, 0→1 clockwise from twelve o'clock.
  const frac = index / SPOKES;

  const style = useAnimatedStyle(() => {
    if (refreshing) {
      // Distance BEHIND the head of the sweep, wrapped into [0,1): 0 at the head, approaching 1 just
      // ahead of it. Brightest at the head with a tail fading the whole way round is what reads as
      // rotation — a single lit spoke would read as ticking.
      const behind = (spin.value - frac + 1) % 1;
      return { opacity: TAIL_FLOOR + (1 - TAIL_FLOOR) * (1 - behind) };
    }
    // Pulling: each spoke fills as the pull passes its position, so the ring completes at the
    // threshold. Clamped at BOTH ends — the hooks' settle spring is underdamped (damping ratio
    // ~0.73, "barely-overshooting" in their own words) and dips `pullY` below zero on the way back.
    const progress = Math.min(1, Math.max(0, pullY.value / pullThreshold));
    return { opacity: Math.min(1, Math.max(0, (progress - frac) * SPOKES)) };
  }, [refreshing]);

  // The rotating thing is a FULL-SIZE wrapper, not the bar itself. A wrapper that fills the box has
  // its centre at the ring's centre, which is already the default transform origin, so the spoke
  // sweeps the ring without anyone having to state an origin. The obvious alternative — rotate the
  // bar and move its origin with `transformOrigin` — needs a px-pair string whose parsing isn't
  // worth depending on: get it wrong and every spoke pivots about the wrong point, which scatters
  // the ring instead of failing loudly.
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${index * (360 / SPOKES)}deg` }] }, style]}>
      <View
        style={{
          position: 'absolute',
          top: inset,
          left: (size - thickness) / 2,
          width: thickness,
          height: length,
          borderRadius: thickness / 2,
          backgroundColor: color,
        }}
      />
    </Animated.View>
  );
}
