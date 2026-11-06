import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/**
 * The reader page of the split, cut off at the strip it grows out of and shrinks back into (see
 * SplitHandoff): the bottom edge travels with `progress`, everything above it stays where it is.
 * Anything else renders as it is.
 */
export function SplitClip({
  travel,
  progress,
  children,
}: {
  /** From the window's bottom edge up to the strip's. */
  travel: number | null;
  progress: SharedValue<number>;
  children: ReactNode;
}) {
  if (travel === null) return children;
  return (
    <SplitClipFrame travel={travel} progress={progress}>
      {children}
    </SplitClipFrame>
  );
}

function SplitClipFrame({
  travel,
  progress,
  children,
}: {
  travel: number;
  progress: SharedValue<number>;
  children: ReactNode;
}) {
  const frameStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -travel * progress.value }] }), [travel]);
  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateY: travel * progress.value }] }), [travel]);
  return (
    <Animated.View style={[styles.splitClip, frameStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, pageStyle]}>{children}</Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  splitClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});
