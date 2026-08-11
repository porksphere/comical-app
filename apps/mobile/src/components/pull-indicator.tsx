import { ActivityIndicator, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
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
 * The indicator is core RN's `ActivityIndicator`, so each platform draws its own house spinner:
 * `UIActivityIndicatorView`'s fading spokes on iOS, the Material sweeping arc on Android, and
 * react-native-web's CSS spinner on web. That's the deliberate trade — it looks different per
 * platform (unlike the rest of this app's chrome, which is custom-rendered precisely so it doesn't),
 * in exchange for reading as each platform's own refresh affordance.
 *
 * One consequence worth knowing: `ActivityIndicator` is indeterminate-only. There's no way to drive
 * its progress from the drag, so the pull is expressed by the *container* instead — the spinner
 * fades, scales, and slides into place as `pullY` climbs, then spins in place while refreshing.
 * The gesture itself (thresholds, haptic, hold-open) is untouched and still lives in the hooks.
 *
 * The color is passed explicitly rather than left to the platform default (which the app's other
 * call sites do): those all sit on a solid settings/panel surface, whereas this one floats over
 * page content in both themes, and the per-platform defaults disagree — iOS greys it, web's is blue.
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
    const progress = refreshing ? 1 : Math.min(1, pullY.value / pullThreshold);
    return {
      opacity: progress,
      // Scale is what's left of the "winding up" read now that the spinner itself can't be driven
      // by the drag: it grows to full size exactly as the pull reaches the trigger line.
      transform: [{ translateY: -HEIGHT + progress * HEIGHT }, { scale: 0.85 + 0.15 * progress }],
    };
  });

  return (
    <Animated.View style={[styles.container, { top }, style]}>
      <ActivityIndicator size="small" color={theme.textSecondary} />
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
