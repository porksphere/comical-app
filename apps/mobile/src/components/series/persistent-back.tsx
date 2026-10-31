import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

/**
 * The series pages' back chevron where the system bar doesn't draw one: TopBarSwitch's
 * `persistent` slot, so it stays put while the bars beneath it cross-fade. Its colour follows
 * `progress`, white over the reader's page and the theme's text over the details.
 */
export function PersistentBack({
  progress,
  style,
  onPress,
  touchable = true,
  nativeID,
}: {
  progress: SharedValue<number>;
  /** The page's own show and hide. */
  style: ComponentProps<typeof Animated.View>['style'];
  onPress: () => void;
  touchable?: boolean;
  nativeID?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topBarHeight = useTopBarHeight();
  const themeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [0, 1], Extrapolation.CLAMP),
  }));
  const whiteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View
      nativeID={nativeID}
      pointerEvents={touchable ? 'box-none' : 'none'}
      style={[styles.wrap, { top: insets.top, height: topBarHeight }, style]}>
      <Pressable
        testID="series-page.header-back"
        onPress={onPress}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.button}>
        <Animated.View style={whiteIconStyle}>
          <ChevronLeftIcon color="#fff" />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.button, themeIconStyle]}>
          <ChevronLeftIcon color={theme.text} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Above the details' band overlay (zIndex 3), so its taps win.
  wrap: {
    position: 'absolute',
    left: Spacing.three,
    zIndex: 4,
    justifyContent: 'center',
  },
  button: {
    justifyContent: 'center',
  },
});
