/**
 * Only rendered on the GitHub Pages preview build (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1`,
 * set in deploy-web.yml), which has no backend to reach from static hosting and
 * renders mock data instead — see `data/source.ts`. Never rendered in a real
 * production build, so mock content is never mistaken for the live app.
 *
 * It says its piece and then leaves: a frosted pill (the toast's material, see
 * `components/toast.tsx`) fades in over the top of the screen and fades out a few
 * seconds later, or on tap. The disclosure is a one-time fact about the build, not a
 * running state, and the full-width slab this used to be sat over every screen's
 * header for the entire session to deliver it.
 */
import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ANDROID_BLUR } from '@/components/context-menu-material';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { IS_CAPTURE_MODE, IS_DEMO_MODE } from '@/data/source';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

const ENTER_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
/** Let the first screen paint before the pill arrives, so it reads as a notice about what just
 *  loaded rather than part of the launch sequence. */
const ENTER_DELAY_MS = 700;
const VISIBLE_MS = 6000;
const EXIT_MS = 220;
/** Same glass as the toast pill: heavy blur doing the legibility work, barely-there tint. */
const BLUR = 70;
const FILL = { light: 'rgba(255,255,255,0.18)', dark: 'rgba(28,30,34,0.22)' } as const;

export function DemoBanner() {
  // A capture build (see e2e/demo/) is filmed for the README, where the pill would sit in every
  // frame of the recording.
  if (!IS_DEMO_MODE || IS_CAPTURE_MODE) return null;
  return <Pill />;
}

function Pill() {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [gone, setGone] = useState(false);

  const dismiss = () => {
    progress.set(
      withTiming(0, { duration: EXIT_MS }, (finished) => {
        if (finished) runOnJS(setGone)(true);
      }),
    );
  };

  useEffect(() => {
    progress.set(withDelay(ENTER_DELAY_MS, withSpring(1, ENTER_SPRING)));
    const t = setTimeout(dismiss, ENTER_DELAY_MS + VISIBLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [-10, 0]) }],
  }));

  // Unmounting once faded out is what keeps the pill from eating taps aimed at the header
  // underneath it for the rest of the session.
  if (gone) return null;

  return (
    // box-none: only the pill itself is touchable; everything under it stays reachable.
    <View pointerEvents="box-none" style={[styles.host, { paddingTop: insets.top + Spacing.two }]}>
      <Animated.View style={[styles.pillShadow, pillStyle]}>
        <BlurView
          tint={scheme}
          intensity={BLUR}
          experimentalBlurMethod={ANDROID_BLUR}
          style={[styles.pill, { borderColor: theme.backgroundSelected }]}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: FILL[scheme] }]} />
          <Pressable
            testID="demo.banner"
            onPress={dismiss}
            style={styles.press}
            accessibilityRole="alert"
            accessibilityLabel="Demo preview: sample data, not the live app">
            <ThemedText type="small" style={styles.text}>
              Demo preview · sample data
            </ThemedText>
          </Pressable>
        </BlurView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
  },
  pillShadow: {
    borderRadius: 999,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pill: {
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  press: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  text: {
    textAlign: 'center',
  },
});
