import { useIsRestoring } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';

const INITIAL_SCALE_FACTOR = Dimensions.get('screen').height / 90;
const DURATION = 600;

// Hold the OS/native splash (the `expo-splash-screen` bg + logo) instead of
// letting it vanish on the first rendered frame. We hand off to the JS overlay
// below — same `#208AEF` background — the moment it mounts, so there's never a
// bare frame between the two. Called at module load (this file is imported from
// `_layout.tsx`), which runs well before the first render commits.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Keep the animated logo up at least this long so its entrance can read even
// when everything below is ready instantly (warm start, empty cache). The gate
// is `min-time AND cache-restored`, whichever finishes last.
const MIN_DISPLAY_MS = 900;

/**
 * The JS splash: a full-screen `#208AEF` cover (matching the native splash) with
 * the animated logo, shown until the app is actually ready, then faded out.
 *
 * "Ready" = the persisted TanStack Query cache has finished restoring from
 * AsyncStorage (`useIsRestoring()` — the one meaningful async step at startup;
 * the embedded runtime install in `startup.ts` is synchronous and there are no
 * fonts to load). Waiting on it means the first screen paints with its cached
 * Library/History/Activity already in place instead of flashing empty.
 *
 * Native only — the `.web.tsx` sibling renders nothing (web has no OS splash).
 */
export function AnimatedSplashOverlay() {
  const isRestoring = useIsRestoring();
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    // The JS overlay is now on screen (same color as the native splash), so drop
    // the native one — the handoff is seamless.
    SplashScreen.hideAsync().catch(() => {});
    const timer = setTimeout(() => setMinElapsed(true), MIN_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // `ready` only ever flips false→true (the cache never un-restores), so
  // returning null here removes the node once, and reanimated plays the
  // `exiting` fade before it unmounts.
  const ready = !isRestoring && minElapsed;
  if (ready) return null;

  return (
    <Animated.View exiting={exitKeyframe.duration(DURATION)} style={styles.backgroundSolidColor}>
      <AnimatedIcon />
    </Animated.View>
  );
}

// Fade + gentle scale-up as the cover clears, revealing the app underneath.
const exitKeyframe = new Keyframe({
  0: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
  100: {
    opacity: 0,
    transform: [{ scale: 1.08 }],
    easing: Easing.out(Easing.quad),
  },
});

const keyframe = new Keyframe({
  0: {
    transform: [{ scale: INITIAL_SCALE_FACTOR }],
  },
  100: {
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const logoKeyframe = new Keyframe({
  0: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
  },
  40: {
    transform: [{ scale: 1.3 }],
    opacity: 0,
    easing: Easing.elastic(0.7),
  },
  100: {
    opacity: 1,
    transform: [{ scale: 1 }],
    easing: Easing.elastic(0.7),
  },
});

const glowKeyframe = new Keyframe({
  0: {
    transform: [{ rotateZ: '0deg' }],
  },
  100: {
    transform: [{ rotateZ: '7200deg' }],
  },
});

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Animated.View entering={glowKeyframe.duration(60 * 1000 * 4)} style={styles.glow}>
        <Image style={styles.glow} source={require('@/assets/images/logo-glow.png')} />
      </Animated.View>

      <Animated.View entering={keyframe.duration(DURATION)} style={styles.background} />
      <Animated.View style={styles.imageContainer} entering={logoKeyframe.duration(DURATION)}>
        <Image style={styles.image} source={require('@/assets/images/comical-logo.png')} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glow: {
    width: 201,
    height: 201,
    position: 'absolute',
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
    zIndex: 100,
  },
  image: {
    position: 'absolute',
    width: 84,
    height: 84,
  },
  background: {
    borderRadius: 40,
    experimental_backgroundImage: `linear-gradient(180deg, #3C9FFE, #0274DF)`,
    width: 128,
    height: 128,
    position: 'absolute',
  },
  backgroundSolidColor: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
