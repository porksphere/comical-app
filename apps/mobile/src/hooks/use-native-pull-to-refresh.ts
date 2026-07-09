import { useCallback, useEffect } from 'react';
import { useAnimatedReaction, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/** Overscroll distance (px) past which a release triggers a refresh. Matches the web hook. */
const PULL_THRESHOLD = 64;
/** Hard cap on how far the indicator travels, however far the list is overscrolled. */
const PULL_MAX = 96;

/**
 * iOS-only pull-to-refresh, driven entirely by the list's own elastic overscroll rather than a
 * native `RefreshControl`. RN's `RefreshControl` renders its spinner at the very top of the
 * scroll view's frame with no working offset on iOS (`progressViewOffset` is a no-op there — see
 * facebook/react-native#54183), so under this screen's full-bleed list frame the spinner draws
 * *behind* the opaque sliding top bar and is never visible. Rather than fight that, we skip the
 * native control on iOS and render our own overlay indicator (the same `PullIndicator` web uses),
 * positioned just below the bar where it belongs.
 *
 * `scrollY` is the same shared value already tracking the list's live offset (via the list's
 * `sharedValues` prop); on iOS an overscroll past the top reports it as negative, which is the
 * pull distance. Wire the returned `onScrollEndDrag` onto the list so a release past the threshold
 * fires the refresh. `refreshing` mirrors the controlled-`RefreshControl` contract: once triggered,
 * `pullY` holds at `PULL_THRESHOLD` (spinner shown) until `refreshing` flips back to false, instead
 * of springing straight back when the finger lifts.
 *
 * Inert off iOS: Android clamps overscroll (no negative offset, and it keeps the working native
 * control) and web never bounces, so `scrollY` stays >= 0 there and `pullY` never leaves 0.
 */
export function useNativePullToRefresh(scrollY: SharedValue<number>, onRefresh: () => void, refreshing: boolean) {
  const pullY = useSharedValue(0);
  // Pulled past the trigger threshold as of the latest frame — read on release to decide whether
  // to fire. A shared value (not a ref) so the UI-thread reaction can write it.
  const armed = useSharedValue(false);
  // True from a triggered release until `refreshing` clears — freezes `pullY` at the held position
  // so the reaction below stops following the (now springing-back) scroll offset.
  const holding = useSharedValue(false);

  // Follow the elastic overscroll 1:1 (iOS already applies rubber-band resistance, so the raw
  // negative offset is the natural pull distance), capped at PULL_MAX. Frozen while holding.
  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      if (holding.value) return;
      const over = y < 0 ? -y : 0;
      pullY.value = over > PULL_MAX ? PULL_MAX : over;
      armed.value = over >= PULL_THRESHOLD;
    },
  );

  useEffect(() => {
    if (holding.value && !refreshing) {
      holding.value = false;
      pullY.value = withTiming(0, { duration: 200 });
    }
  }, [refreshing, holding, pullY]);

  const onScrollEndDrag = useCallback(() => {
    if (!armed.value || holding.value) return;
    // Snap to and hold at the activated position; the `refreshing` effect releases it on resolve.
    holding.value = true;
    pullY.value = withTiming(PULL_THRESHOLD, { duration: 150 });
    onRefresh();
  }, [armed, holding, pullY, onRefresh]);

  return { pullY, pullThreshold: PULL_THRESHOLD, onScrollEndDrag };
}
