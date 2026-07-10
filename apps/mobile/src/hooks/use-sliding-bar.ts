/**
 * A top bar that slides away 1:1 with downward scroll and back with upward scroll (X/Twitter-style),
 * driven by the list's UI-thread scroll offset. Shared by the Browse grid's bridge/page bar and the
 * Search screen's filter bar so their motion can't drift — and reusable by any other scrolling
 * screen that wants a collapsing header.
 *
 * Wiring: spread `sharedValues` onto the (Animated)LegendList's `sharedValues` prop so it feeds the
 * live scroll offset, and pass `onScroll` to the list so `maxScrollY` stays in sync (it distinguishes
 * a real upward scroll from the bottom's elastic bounce-back). Apply `barStyle` to the bar's
 * Animated.View. Pass `resetKey` (a string that changes when the logical scope changes) + the
 * `listRef` to snap the bar back to visible and the list to the top on a scope change.
 *
 * `scrollY`/`maxScrollY`/`offset` are exposed for screens that drive additional scroll-linked effects
 * off the same values (e.g. Browse's tab-bar auto-hide, a border/shadow that fades with scroll,
 * pull-to-refresh).
 */
import { useCallback, useEffect, useMemo, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

/** Minimal structural type for the list refs we reset — LegendList and FlatList both satisfy it. */
type Scrollable = { scrollToOffset: (opts: { offset: number; animated?: boolean }) => void };

export type SlidingBar = {
  /** Live scroll offset (UI thread). Also reusable for other scroll-driven effects. */
  scrollY: SharedValue<number>;
  /** contentHeight − viewportHeight, kept in sync by `onScroll` (for the bottom-bounce guard). */
  maxScrollY: SharedValue<number>;
  /** The bar's translateY: 0 fully visible, −barHeight fully hidden. */
  offset: SharedValue<number>;
  /** Animated transform for the bar (translateY = offset). */
  barStyle: ReturnType<typeof useAnimatedStyle>;
  /** Spread onto the AnimatedLegendList's `sharedValues` prop. */
  sharedValues: { scrollOffset: SharedValue<number> };
  /** Wire to the list's plain `onScroll` — keeps `maxScrollY` in sync. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

export function useSlidingBar(
  barHeight: number,
  opts?: { resetKey?: string; listRef?: RefObject<Scrollable | null> },
): SlidingBar {
  const scrollY = useSharedValue(0);
  const maxScrollY = useSharedValue(0);
  const offset = useSharedValue(0);

  useAnimatedReaction(
    () => scrollY.value,
    (y, prevY) => {
      // At/above the top (resting, or an active pull/overscroll reporting negative y): pinned visible.
      if (y <= 0) {
        offset.value = 0;
        return;
      }
      // Past the content end the list is in (or springing out of) its elastic bottom bounce, which
      // produces the same "offset decreasing" delta a real scroll-up does — ignore it so the bar
      // isn't revealed on every bottom bounce. Only apply the delta below the max (real scrolling).
      if (maxScrollY.value > 0 && y >= maxScrollY.value) return;
      const dy = y - (prevY ?? y);
      offset.value = Math.min(0, Math.max(-barHeight, offset.value - dy));
    },
    [barHeight],
  );

  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  const resetKey = opts?.resetKey;
  const listRef = opts?.listRef;
  useEffect(() => {
    // A scope change snaps the bar back to visible + the list to the top. The list instance persists
    // across scope changes (keepPreviousData, no remount), so it won't return to the top on its own.
    scrollY.value = 0;
    offset.value = 0;
    maxScrollY.value = 0;
    listRef?.current?.scrollToOffset({ offset: 0, animated: false });
    // Shared values + listRef are stable refs; only a resetKey change should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentSize, layoutMeasurement } = e.nativeEvent;
      if (contentSize && layoutMeasurement) {
        maxScrollY.value = Math.max(0, contentSize.height - layoutMeasurement.height);
      }
    },
    [maxScrollY],
  );

  const sharedValues = useMemo(() => ({ scrollOffset: scrollY }), [scrollY]);

  return { scrollY, maxScrollY, offset, barStyle, sharedValues, onScroll };
}
