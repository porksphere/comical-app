import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { getTabBarHideOffset, setTabBarProgress } from '@/lib/tab-bar-visibility';

// The scroll span over which the bar fully hides/reveals is the bar's own hide offset (its measured
// height — see tab-bar-visibility), so the bar tracks the finger EXACTLY 1:1, X/Twitter-style:
// translateY = progress * hideOffset = the accumulated scroll px. A span larger than the offset
// (the old fixed 96 vs ~82) made the fully-hidden bar overshoot the screen edge, and a scroll-up
// had to walk the invisible overshoot back before the bar appeared to move.
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
    const span = getTabBarHideOffset();
    const q = Math.round(p * span) / span;
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
      // Re-read the span each report: the bar re-measures on inset/layout changes, and the px-based
      // accumulator just re-clamps to whatever the span currently is.
      const span = getTabBarHideOffset();
      distance.current = Math.min(span, Math.max(0, distance.current + dy));
      publish(distance.current / span);
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
