import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { setTabBarHidden } from '@/lib/tab-bar-visibility';

// Same thresholds as web's DOM-scroll-driven fade (app-tabs.tsx) for a consistent feel: hide only
// after a deliberate chunk of downward scroll, show again after a smaller upward scroll (or at the
// top), so a little back-and-forth jitter doesn't flicker the bar.
const HIDE_AFTER = 72;
const SHOW_AFTER = 40;
const TOP_GUARD = 8;

/**
 * Native only: slides the tab bar away on sustained downward scroll and back in on upward scroll,
 * at the top, or when the screen (re)gains focus. Reports into the shared `tab-bar-visibility`
 * store (there's one bar, and only the focused screen's scrolling should drive it).
 *
 * Returns a ready `onScroll` for a plain FlatList/ScrollView, plus the underlying `reportOffset`
 * for screens that already drive a Reanimated `useAnimatedScrollHandler` worklet and need to
 * bridge back to JS via `runOnJS` instead of attaching a second `onScroll`.
 */
export function useHideTabBarOnScroll() {
  const lastY = useRef(0);
  const down = useRef(0);
  const up = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(false);
    }, []),
  );

  const reportOffset = useCallback((y: number) => {
    const dy = y - lastY.current;
    lastY.current = y;
    if (dy === 0) return;
    if (y <= TOP_GUARD) {
      down.current = 0;
      setTabBarHidden(false);
      return;
    }
    if (dy > 0) {
      down.current += dy;
      up.current = 0;
      if (down.current >= HIDE_AFTER) setTabBarHidden(true);
    } else {
      up.current -= dy;
      down.current = 0;
      if (up.current >= SHOW_AFTER) setTabBarHidden(false);
    }
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      reportOffset(e.nativeEvent.contentOffset.y);
    },
    [reportOffset],
  );

  return { onScroll, reportOffset };
}
