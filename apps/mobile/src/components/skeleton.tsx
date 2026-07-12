import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleProp, View, ViewStyle } from 'react-native';

import { useLightCards } from '@/lib/perf-flags';

// A subtle pulsing placeholder block — the cross-platform stand-in for the reference's
// `skeleton-shimmer` gradient sweep (a moving gradient needs a linear-gradient dep; an opacity
// pulse reads the same and is cheap).
//
// Deliberately RN's native-driven `Animated`, NOT Reanimated. A Reanimated `useAnimatedStyle`
// pulse serializes a worklet on the JS thread every time the component mounts — and Skeleton
// mounts once per still-loading card, so a scroll into fresh content fired a burst of
// `createSerializableWorklet` on the JS thread (a measured scroll hotspot). The native driver runs
// the opacity loop entirely off the JS thread with zero worklet setup. When Lightweight cards is on
// the pulse is skipped altogether for a fully static placeholder (no animation, no driver at all).
const BASE = { backgroundColor: 'rgba(128,128,128,0.18)' } as const;

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const lightCards = useLightCards();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (lightCards) return; // static placeholder — no animation
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 750, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0.5, duration: 750, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [lightCards, v]);

  if (lightCards) return <View style={[BASE, style, { opacity: 0.5 }]} />;
  return <Animated.View style={[BASE, style, { opacity: v }]} />;
}
