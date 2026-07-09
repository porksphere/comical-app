import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { PullBookMark } from '@/components/pull-book-mark';

const HEIGHT = 56;

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
