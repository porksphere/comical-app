import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { notifyScrollActivity, subscribeScrollPhase, type ScrollPhase } from '@/lib/scroll-release';
import {
  MAX_SCROLL_UNMEASURED,
  SETTLE_MS,
  settleEase,
  settleTarget,
  slideStep,
  TOP_GUARD,
} from '@/lib/slide-step';
import {
  animateTabBarProgress,
  cancelTabBarProgress,
  getTabBarHideOffset,
  getTabBarProgress,
  setTabBarProgress,
  tabBarHideOffset,
  tabBarPinned,
  tabBarProgress,
} from '@/lib/tab-bar-slide';

/**
 * Native only: slides the bottom bar away as the screen scrolls down and back in as it scrolls up,
 * committing to whichever end it is nearer once the scrolling stops, snapping fully shown at the top
 * or when the screen (re)gains focus.
 *
 * The SAME machinery as the top bar (`useSlidingBar`), deliberately: the scroll offset arrives as a
 * shared value, `slideStep` runs inside a `useAnimatedReaction` worklet, and the result is written
 * straight to `tabBarProgress` — UI thread end to end, with the JS thread out of the per-frame path
 * entirely. It used to read a JS `onScroll` (or, on Browse, a `runOnJS` hop off the top bar's own
 * reaction — a UI→JS→UI round trip per frame), do the arithmetic in JS, and push the result back
 * across. That worked, but it put the bar's tracking behind whatever else the JS thread was doing
 * mid-fling: list virtualization, cover decode. The transform was smooth; the numbers feeding it
 * weren't.
 *
 * Wiring, per screen: spread `sharedValues` onto the (Animated)LegendList so it feeds the offset,
 * and pass `onScroll` so `maxScrollY` stays in sync (it's what tells a real scroll-up from the
 * elastic bottom bounce). A screen that ALREADY has both — Browse, from its top bar — passes them in
 * as `source` instead, and both bars then read one value rather than two that can disagree.
 *
 * Only the settle layer stays on the JS thread, because the "scrolling ended" signal is a native
 * scroll event (`scroll-release`). That's once per gesture, not once per frame.
 *
 * It does NOT drive the scroller the way the top bar's settle does. It doesn't have to: the two read
 * the same offset, so the top bar's lockstep scroll moves this bar too, through the ordinary 1:1
 * path. Two bars both scrolling the one list would be two answers to the same question.
 */
export function useHideTabBarOnScroll(source?: {
  scrollY: SharedValue<number>;
  /** Optional: a screen that already tracks the content end (the top bar does) shares it, so the two
   *  bars can't disagree about where the elastic bounce starts. Otherwise `onScroll` fills it in. */
  maxScrollY?: SharedValue<number>;
}) {
  const ownScrollY = useSharedValue(0);
  const ownMaxScrollY = useSharedValue(MAX_SCROLL_UNMEASURED);
  const scrollY = source?.scrollY ?? ownScrollY;
  const maxScrollY = source?.maxScrollY ?? ownMaxScrollY;

  // How far the bar is currently hidden, in px. The worklet's accumulator — `tabBarProgress` is this
  // divided by the span, and is what the bar's transform reads.
  const distance = useSharedValue(0);
  // Whether `scrollY` has reported a real position since the last mount/focus. See the reaction.
  const primed = useSharedValue(false);
  // A settle owns the bar until it lands (or a new gesture cancels it); reports stand back.
  const settling = useSharedValue(false);
  // Only the FOCUSED screen drives the one bar — checked in the worklet, since a blurred screen's
  // list can still report (momentum, a layout pass) after focus has moved on.
  const focused = useSharedValue(true);
  const focusedJs = useRef(true);

  useAnimatedReaction(
    () => scrollY.value,
    (y, prevY) => {
      // Reanimated runs a mapper ONCE when it registers, before any scrolling — `prevY` is null only
      // for that fire, and it carries no movement.
      if (prevY === null) return;
      if (!focused.value || tabBarPinned.value) return;
      // The first real offset after mount/focus is a POSITION, not a gesture: a list that comes up
      // already scrolled (a restored offset, or a warm query cache rendering the whole feed at once)
      // reports it in one step, and diffing that against a `scrollY` still sitting at 0 reads as one
      // enormous downward flick — which hid the bar completely before the user had touched anything.
      // On Android CI that made Browse cold-start with no tab bar at all (`tab.browse` absent from
      // the hierarchy — caught by e2e/mobile/swipe-dismiss). Swallowing the first report re-baselines
      // at whatever the list is ACTUALLY showing.
      if (!primed.value) {
        primed.set(true);
        return;
      }
      if (settling.value) return;
      // The scroll→slide rule (top pin, bottom-bounce guard, clamped accumulation) is the shared
      // `slideStep` — the top bar's reaction runs the same function on the same thread now, so the
      // two bars' motion can't drift. The span is re-read every frame: the bar re-measures on
      // inset/layout changes, and the px accumulator just re-clamps to whatever it currently is.
      const span = tabBarHideOffset.value;
      const next = slideStep(distance.value, y, prevY, maxScrollY.value, span, TOP_GUARD);
      distance.set(next);
      tabBarProgress.value = next / span;
    },
  );

  const cancelSettle = useCallback(() => {
    if (!settling.value) return;
    cancelTabBarProgress();
    settling.set(false);
    // The tween was mid-flight, so the committed target stored up front isn't where the bar actually
    // is. Read the real position back, or the next 1:1 report would accumulate from a place the bar
    // never reached.
    distance.set(getTabBarProgress() * getTabBarHideOffset());
  }, [distance, settling]);

  const settleTo = useCallback(
    (target: number) => {
      cancelSettle();
      const span = getTabBarHideOffset();
      if (distance.value === target) return;
      distance.set(target);
      settling.set(true);
      animateTabBarProgress(target / span, { duration: SETTLE_MS, easing: settleEase }, () => {
        'worklet';
        settling.set(false);
      });
    },
    [cancelSettle, distance, settling],
  );

  useFocusEffect(
    useCallback(() => {
      focused.set(true);
      focusedJs.current = true;
      cancelSettle();
      distance.set(0);
      primed.set(false);
      setTabBarProgress(0);
      return () => {
        focused.set(false);
        focusedJs.current = false;
        cancelSettle();
      };
    }, [cancelSettle, distance, focused, primed]),
  );

  // The moments this bar commits on. The phase broadcast is global (one scroller at a time), but a
  // blurred screen keeps its subscription, so it has to ignore what it hears.
  const settle = useCallback(
    (phase: ScrollPhase) => {
      if (!focusedJs.current) return;
      if (phase === 'begin') {
        // A new gesture takes the bar over wherever the settle had got to.
        cancelSettle();
        return;
      }
      // Only at REST, and for the same reason as the top bar: `release` is the start of a fling, so
      // the position there is not the one the user landed on. See `settleTarget`.
      if (phase !== 'rest') return;
      // A settle already in flight owns the bar — a second `rest` behind it must not restart the
      // same animation.
      if (settling.value) return;
      settleTo(settleTarget(distance.value, scrollY.value, getTabBarHideOffset()));
    },
    [cancelSettle, distance, scrollY, settleTo, settling],
  );
  useEffect(() => subscribeScrollPhase(settle), [settle]);

  // Keeps `maxScrollY` in sync and the release detector's idle fallback ticking (the ONLY "the
  // gesture ended" signal on web, where a wheel/trackpad emits no drag events at all). Both are
  // once-per-event bookkeeping, not the bar's position — that never comes through here now.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      notifyScrollActivity();
      const { contentSize, layoutMeasurement } = e.nativeEvent;
      if (contentSize && layoutMeasurement) {
        // Floored at 0: content shorter than the viewport has nothing to scroll, so every offset it
        // ever reports is an elastic stretch the bar must sit out. A raw negative would read as
        // "unmeasured" and disarm the guard exactly where it's needed most.
        maxScrollY.set(Math.max(0, contentSize.height - layoutMeasurement.height));
      }
    },
    [maxScrollY],
  );

  const sharedValues = useMemo(() => ({ scrollOffset: scrollY }), [scrollY]);

  return { scrollY, maxScrollY, sharedValues, onScroll };
}
