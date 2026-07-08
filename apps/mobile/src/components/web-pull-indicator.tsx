import { ActivityIndicator, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const HEIGHT = 56;

/**
 * Web counterpart to native's RefreshControl spinner — see `useWebPullToRefresh`, which this
 * renders the progress of. Slides down from behind the top bar as the user pulls, and stays
 * fully shown for as long as `refreshing` is true (independent of `pullY`, which has already
 * sprung back to 0 by then — see the hook).
 */
export function WebPullIndicator({
  pullY,
  pullThreshold,
  refreshing,
  top,
  color,
}: {
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  /** Where the bar's resting bottom edge is — the indicator settles just below it. */
  top: number;
  color: string;
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
      <ActivityIndicator color={color} />
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
