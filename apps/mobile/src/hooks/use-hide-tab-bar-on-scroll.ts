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
  const lastProgress = useRef(0);

  // Quantize to whole-pixel steps of the slide and drop no-op repeats before
  // touching the store. Without this, a fast scroll — or scrolling further while
  // the bar is already fully hidden/shown (progress clamped at 1/0) — fires a
  // store update, and an AppTabs re-render, on *every* frame. That per-frame JS
  // churn is exactly what a card tap right after a scroll would queue behind,
  // adding to the pre-transition stall. Endpoints still publish (0.98 → 1 is a
  // real change); only truly-unchanged frames are skipped.
  const publish = useCallback((p: number) => {
    const q = Math.round(p * SLIDE_DISTANCE) / SLIDE_DISTANCE;
    if (q === lastProgress.current) return;
    lastProgress.current = q;
    setTabBarProgress(q);
  }, []);

  useFocusEffect(
    useCallback(() => {
      distance.current = 0;
      lastProgress.current = 0;
      setTabBarProgress(0);
    }, []),
  );

  const reportOffset = useCallback(
    (y: number, maxY?: number) => {
      const dy = y - lastY.current;
      lastY.current = y;
      if (dy === 0) return;
      if (y <= TOP_GUARD) {
        distance.current = 0;
        publish(0);
        return;
      }
      // Past the content end the list is in (or springing back out of) its elastic bottom bounce.
      // That stretch reports the same "offset decreasing" deltas a genuine scroll-UP does, so without
      // this the tab bar slides back in every time you overscroll the end of a list — the bar visibly
      // reacting to the rubber-band. Ignore deltas at/beyond the end; only real scrolling below the
      // max moves the bar. This is the same guard the top bar already has (see `useSlidingBar`, whose
      // `maxScrollY` check exists for exactly this) — the two bars now behave symmetrically.
      //
      // `maxY` unknown (a caller that can't supply it) ⇒ no guard, i.e. the previous behaviour.
      if (maxY !== undefined && maxY > 0 && y >= maxY) return;
      distance.current = Math.min(SLIDE_DISTANCE, Math.max(0, distance.current + dy));
      publish(distance.current / SLIDE_DISTANCE);
    },
    [publish],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      reportOffset(contentOffset.y, contentSize.height - layoutMeasurement.height);
    },
    [reportOffset],
  );

  return { onScroll, reportOffset };
}
