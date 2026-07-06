import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { setTabBarProgress } from '@/lib/tab-bar-visibility';

// Scroll distance (px) over which the bar fully hides/reveals — it tracks the finger 1:1 within
// this span, X/Twitter-style, rather than flipping between two states past a threshold.
const SLIDE_DISTANCE = 96;
const TOP_GUARD = 8;

/**
 * Native only: slides the tab bar away continuously as the screen scrolls down and back in as it
 * scrolls up, snapping to fully shown at the top or when the screen (re)gains focus. Reports into
 * the shared `tab-bar-visibility` store (there's one bar, and only the focused screen's scrolling
 * should drive it).
 *
 * Returns a ready `onScroll` for a plain FlatList/ScrollView, plus the underlying `reportOffset`
 * for screens that already drive a Reanimated `useAnimatedScrollHandler` worklet and need to
 * bridge back to JS via `runOnJS` instead of attaching a second `onScroll`.
 */
export function useHideTabBarOnScroll() {
  const lastY = useRef(0);
  const distance = useRef(0);

  useFocusEffect(
    useCallback(() => {
      distance.current = 0;
      setTabBarProgress(0);
    }, []),
  );

  const reportOffset = useCallback((y: number) => {
    const dy = y - lastY.current;
    lastY.current = y;
    if (dy === 0) return;
    if (y <= TOP_GUARD) {
      distance.current = 0;
      setTabBarProgress(0);
      return;
    }
    distance.current = Math.min(SLIDE_DISTANCE, Math.max(0, distance.current + dy));
    setTabBarProgress(distance.current / SLIDE_DISTANCE);
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      reportOffset(e.nativeEvent.contentOffset.y);
    },
    [reportOffset],
  );

  return { onScroll, reportOffset };
}
