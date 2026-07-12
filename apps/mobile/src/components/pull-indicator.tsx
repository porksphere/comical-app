import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { PullBookMark } from '@/components/pull-book-mark';

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
 * (independent of `pullY`, which has sprung back to 0 by then — see the hooks). The indicator itself
 * is the app's open-book logo, animated by the pull (`PullBookMark`), not a generic spinner.
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
  const style = useAnimatedStyle(() => {
    const progress = refreshing ? 1 : Math.min(1, pullY.value / pullThreshold);
    return {
      opacity: progress,
      transform: [{ translateY: -HEIGHT + progress * HEIGHT }],
    };
  });

  return (
    <Animated.View style={[styles.container, { top }, style]}>
      <PullBookMark pullY={pullY} pullThreshold={pullThreshold} refreshing={refreshing} />
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
