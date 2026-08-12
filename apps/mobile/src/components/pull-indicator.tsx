import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { PullSpinner } from '@/components/pull-spinner';
import { useTheme } from '@/hooks/use-theme';

const HEIGHT = 56;

/**
 * Minimum time a triggered refresh keeps `refreshing` true, however fast the fetch resolves.
 *
 * A same-device fetch (the embedded transport, or just a warm cache) can resolve in a handful of ms —
 * far less than a pull-release-and-settle takes. Without this floor the spinner is told to stop before
 * it has even rendered, and on iOS a `refreshing` that clears while the finger is still down snaps the
 * content back instead of letting the gesture resolve naturally. Owned here rather than per-screen so
 * Browse and Search can't drift apart on it.
 */
export const REFRESH_MIN_VISIBLE_MS = 600;

/**
 * The pull-to-refresh overlay, shared across every platform — fed by `useTouchPullToRefresh`
 * (web + Android) or `useNativePullToRefresh` (iOS), both through the same `pullY`. Slides down from
 * behind the top bar as the user pulls, and stays fully shown for as long as `refreshing` is true
 * (independent of `pullY`, which has sprung back to 0 by then — see the hooks).
 *
 * This container owns the *reveal* — where the spinner sits and whether it's visible at all — while
 * `PullSpinner` owns the *state*, filling its spokes with the drag and chasing them round while the
 * request runs. Splitting it that way is what lets the gesture drive the artwork: the position is a
 * function of how far the list has opened, the spinner is a function of how far through the pull you
 * are, and those aren't the same thing once `refreshing` pins one of them.
 */
export function PullIndicator({
  pullY,
  pullThreshold,
  refreshing,
  top,
}: {
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  /** Where the bar's resting bottom edge is — the indicator settles just below it. */
  top: number;
}) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => {
    // Clamped at BOTH ends: the hooks' settle spring is deliberately underdamped (damping ratio
    // ~0.73 — "barely-overshooting" in their own comments), so `pullY` dips below zero on the way
    // back. Clamping only the top let that through as negative opacity and a translateY past the
    // hidden position.
    const progress = refreshing ? 1 : Math.min(1, Math.max(0, pullY.value / pullThreshold));
    return {
      // Ramped faster than the travel so the ring is legible while its spokes are still filling —
      // at a flat `progress` the early pull is both dim AND mostly unlit, which reads as nothing
      // happening. Position still tracks the pull 1:1 below.
      opacity: Math.min(1, progress * 1.5),
      transform: [{ translateY: -HEIGHT + progress * HEIGHT }],
    };
  });

  return (
    <Animated.View style={[styles.container, { top }, style]}>
      <PullSpinner pullY={pullY} pullThreshold={pullThreshold} refreshing={refreshing} color={theme.textSecondary} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
