import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { notifyScrollActivity, subscribeScrollPhase, type ScrollPhase } from '@/lib/scroll-release';
import { settleStep } from '@/lib/slide-step';
import { getTabBarHideOffset, setTabBarProgress } from '@/lib/tab-bar-visibility';

// The scroll span over which the bar fully hides/reveals is the bar's own hide offset (its measured
// height — see tab-bar-visibility), so the bar tracks the finger EXACTLY 1:1, X/Twitter-style:
// translateY = progress * hideOffset = the accumulated scroll px. A span larger than the offset
// (the old fixed 96 vs ~82) made the fully-hidden bar overshoot the screen edge, and a scroll-up
// had to walk the invisible overshoot back before the bar appeared to move.
const TOP_GUARD = 8;
/** How long the bar takes to slide to its committed state once the gesture ends. */
const SETTLE_MS = 200;

/**
 * Native only: reveals the tab bar as the screen scrolls up and commits it to shown-or-hidden when
 * the gesture ends, snapping to fully shown at the top or when the screen (re)gains focus. Reports
 * into the shared `tab-bar-visibility` store (there's one bar, and only the focused screen's
 * scrolling should drive it).
 *
 * Same commit-on-release rule as the top bar, out of the same `settleStep`: downward scroll marks a
 * hide that fires when the finger lifts, and a reveal that never reached full extension slides back
 * out once the scroll comes to rest. See `scroll-release` for where those two moments come from.
 *
 * Returns a ready `onScroll` for a plain FlatList/ScrollView, plus the underlying `reportOffset`
 * for screens that already drive a Reanimated `useAnimatedScrollHandler` worklet and need to
 * bridge back to JS via `runOnJS` instead of attaching a second `onScroll`.
 */
export function useHideTabBarOnScroll() {
  const lastY = useRef(0);
  const distance = useRef(0);
  const lastProgress = useRef(0);
  // Whether `lastY` holds a real previous position yet. See `reportOffset`.
  const primed = useRef(false);
  // A hide the user has asked for but hasn't committed yet — it fires on release. See `settleStep`.
  const pending = useRef(false);
  // Handle of the settle tween in flight; while it's set, it owns the bar (see `reportOffset`).
  const settleFrame = useRef<number | null>(null);
  const focused = useRef(true);

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

  const cancelSettle = useCallback(() => {
    if (settleFrame.current === null) return;
    cancelAnimationFrame(settleFrame.current);
    settleFrame.current = null;
  }, []);

  // The commit animation. A hand-rolled rAF tween rather than Reanimated's `withTiming` because this
  // bar's position is plain React state the whole way through (`tab-bar-visibility` → AppTabs), for
  // the reason spelled out in app-tabs: expo-router's `TabList` exposes a plain `style` only.
  const settleToHidden = useCallback(() => {
    cancelSettle();
    const span = getTabBarHideOffset();
    const from = distance.current;
    if (from >= span) return;
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / SETTLE_MS);
      const eased = 1 - (1 - t) ** 3;
      distance.current = from + (span - from) * eased;
      publish(distance.current / span);
      settleFrame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    settleFrame.current = requestAnimationFrame(step);
  }, [cancelSettle, publish]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      cancelSettle();
      distance.current = 0;
      lastProgress.current = 0;
      pending.current = false;
      primed.current = false;
      setTabBarProgress(0);
      return () => {
        focused.current = false;
        cancelSettle();
      };
    }, [cancelSettle]),
  );

  // The moments this bar commits on. The phase broadcast is global (one scroller at a time), but a
  // blurred screen keeps its subscription, so it has to ignore what it hears.
  const settle = useCallback(
    (phase: ScrollPhase) => {
      if (!focused.current) return;
      if (phase === 'begin') {
        // A new gesture takes the bar over wherever the settle had got to.
        cancelSettle();
        return;
      }
      // A marked hide fires as soon as the finger lifts, so the bar is out of the way for the fling
      // rather than sliding away after it.
      if (pending.current) {
        pending.current = false;
        settleToHidden();
        return;
      }
      // A reveal that never reached full extension isn't committed — but it only loses at `rest`,
      // so an upward fling gets its momentum to finish the job first.
      if (phase === 'rest' && distance.current > 0) settleToHidden();
    },
    [cancelSettle, settleToHidden],
  );
  useEffect(() => subscribeScrollPhase(settle), [settle]);

  const reportOffset = useCallback(
    (y: number, maxY?: number) => {
      // Feeds the release detector's idle fallback, the only "the gesture ended" signal on web.
      notifyScrollActivity();
      // The first offset after mount/focus only establishes the baseline — it is a position, not a
      // gesture. Diffing it against a `lastY` still sitting at 0 reads a list that comes up already
      // scrolled as one enormous downward flick, which hid the bar completely before the user had
      // touched anything: on Android CI, relaunching with a warm persisted query cache renders the
      // whole feed at once, the list settles mid-content, and Browse cold-started with no tab bar at
      // all (`tab.browse` absent from the view hierarchy — caught by e2e/mobile/swipe-dismiss).
      if (!primed.current) {
        primed.current = true;
        lastY.current = y;
        return;
      }
      const prevY = lastY.current;
      lastY.current = y;
      if (y === prevY) return;
      // A settle owns the bar until it lands (or a new gesture cancels it).
      if (settleFrame.current !== null) return;
      // The scroll→slide rule (top pin, bottom-bounce guard, clamped accumulation, and the
      // commit-on-release layer over it) is the shared `settleStep` — the top bar's hook runs the
      // same function, so the two bars' motion can't drift. `maxY` unknown (a caller that can't
      // supply it) ⇒ 0 ⇒ no bounce guard. The span is re-read each report: the bar re-measures on
      // inset/layout changes, and the px accumulator just re-clamps to whatever it currently is.
      const span = getTabBarHideOffset();
      const next = settleStep(distance.current, pending.current, y, prevY, maxY ?? 0, span, TOP_GUARD);
      pending.current = next.pending;
      distance.current = next.hidden;
      publish(next.hidden / span);
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
