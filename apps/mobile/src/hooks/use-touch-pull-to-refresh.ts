import { useCallback, useEffect, useRef } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/** Drag distance (post-slop) that triggers a refresh on release. */
const PULL_THRESHOLD = 64;
/** Hard cap on how far the indicator travels, however far the finger drags. */
const PULL_MAX = 96;
/** Drag-to-pull ratio past the slop, so the gesture doesn't feel 1:1 twitchy. */
const PULL_RESISTANCE = 0.5;
/** Dead zone before a downward drag starts counting as a pull at all. */
const PULL_START_SLOP = 8;

/**
 * Touch-driven pull-to-refresh, shared by web and Android — the two platforms with no usable
 * elastic overscroll to hang the gesture off (react-native-web's RefreshControl is an inert no-op,
 * and Android clamps overscroll to a glow with no negative offset). iOS instead reads its native
 * bounce directly, see `useNativePullToRefresh`. Raw touch events (`onTouchStart/Move/End`) are
 * core RN — they fire on the wrapper for the whole subtree regardless of what's under the finger,
 * and at the top of the list there's nothing for the scroller itself to consume — so wiring the
 * three returned handlers onto a View around the scrollable area catches the pull on both.
 *
 * Only meaningful for a real touch drag (a web mouse drag never fires touch events), so it's inert
 * otherwise without any Platform gating needed by callers.
 *
 * `scrollY` is the same shared value already tracking the list's live scroll offset elsewhere on
 * the screen — reused here, not a second scroll listener, just to know whether the list is at
 * its top when a touch begins (and stays there — a genuine scroll starting mid-drag cancels the
 * pull, same as native).
 *
 * `refreshing` mirrors a controlled `RefreshControl`: on release past the threshold, `pullY` snaps
 * to (and holds at) `PULL_THRESHOLD` — rather than springing straight back to 0 — for as long as
 * `refreshing` stays true, so the pulled-down gap "sticks" with the spinner showing until the
 * actual request resolves. Only released once `refreshing` flips back to false.
 */
export function useTouchPullToRefresh(scrollY: SharedValue<number>, onRefresh: () => void, refreshing: boolean) {
  const pullY = useSharedValue(0);
  const startY = useRef(0);
  const pulling = useRef(false);
  const holding = useRef(false);

  useEffect(() => {
    if (holding.current && !refreshing) {
      holding.current = false;
      pullY.value = withTiming(0, { duration: 200 });
    }
  }, [refreshing, pullY]);

  const onTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      pulling.current = scrollY.value <= 0;
      startY.current = e.nativeEvent.pageY;
    },
    [scrollY],
  );

  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (!pulling.current) return;
      if (scrollY.value > 0) {
        // The list itself started scrolling mid-gesture — hand off to it entirely.
        pulling.current = false;
        pullY.value = withTiming(0, { duration: 150 });
        return;
      }
      const dy = e.nativeEvent.pageY - startY.current - PULL_START_SLOP;
      pullY.value = dy > 0 ? Math.min(PULL_MAX, dy * PULL_RESISTANCE) : 0;
    },
    [pullY, scrollY],
  );

  const onTouchEnd = useCallback(() => {
    const triggered = pulling.current && pullY.value >= PULL_THRESHOLD;
    pulling.current = false;
    if (triggered) {
      // Snap into (and hold at) the resting "activated" position instead of springing all the
      // way back — the `refreshing` effect above releases it once the request actually resolves.
      holding.current = true;
      pullY.value = withTiming(PULL_THRESHOLD, { duration: 150 });
      onRefresh();
    } else {
      pullY.value = withTiming(0, { duration: 200 });
    }
  }, [pullY, onRefresh]);

  // Here the list translates by the pull itself, so the wrapper offset *is* `pullY` — exposed under
  // the same name the native hook uses (where the two differ) so the caller can treat them alike.
  return { pullY, listTranslateY: pullY, pullThreshold: PULL_THRESHOLD, onTouchStart, onTouchMove, onTouchEnd };
}
