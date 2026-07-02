import { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// A subtle pulsing placeholder block — the cross-platform stand-in for the
// reference's `skeleton-shimmer` gradient sweep (a moving gradient needs a
// linear-gradient dep; an opacity pulse reads the same and is cheap).

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const v = useSharedValue(0.5);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
  }, [v]);
  const animated = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[{ backgroundColor: 'rgba(128,128,128,0.18)' }, style, animated]} />;
}
