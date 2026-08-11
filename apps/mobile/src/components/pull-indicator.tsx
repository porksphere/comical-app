import { ActivityIndicator, Platform, StyleSheet } from 'react-native';
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
 * Whether the spinner spins during the *pull*, before the refresh is actually committed.
 *
 * iOS and web hold it still and start spinning only on commit — that's how `UIRefreshControl`
 * behaves, and it matters: the spokes sitting static under your finger vs. starting to turn is the
 * signal that the refresh fired. A spinner already spinning on the way down is claiming to be
 * working before anything has been requested.
 *
 * Android has to spin the whole time. Its `ActivityIndicator` is a `ProgressBar`, and
 * `ProgressBarContainerView` sets the view INVISIBLE whenever `animating` is false — it ignores
 * `hidesWhenStopped` completely — so gating it there would show nothing at all during the pull,
 * which is worse than spinning early.
 */
const ANIMATE_DURING_PULL = Platform.OS === 'android';

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
 * fades and slides into place as `pullY` climbs. What marks the commit is the spinner starting to
 * turn (see `ANIMATE_DURING_PULL`), not the container. The gesture itself (thresholds, haptic,
 * hold-open) is untouched and still lives in the hooks.
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
    // Clamped at BOTH ends. `SETTLE_SPRING` in the two gesture hooks is deliberately underdamped
    // (damping ratio ~0.73 — they describe it as "barely-overshooting"), so `pullY` undershoots
    // below zero on every spring-back. Clamping only the top let that through as negative opacity
    // and a translateY past the hidden position.
    const progress = refreshing ? 1 : Math.min(1, Math.max(0, pullY.value / pullThreshold));
    return {
      opacity: progress,
      transform: [{ translateY: -HEIGHT + progress * HEIGHT }],
    };
  });

  return (
    <Animated.View style={[styles.container, { top }, style]}>
      <ActivityIndicator
        size="small"
        color={theme.textSecondary}
        animating={ANIMATE_DURING_PULL || refreshing}
        // Required for the static-during-pull state above to be visible at all on iOS, where the
        // default hides a stopped indicator outright. Honoured on web, ignored on Android.
        hidesWhenStopped={false}
      />
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
