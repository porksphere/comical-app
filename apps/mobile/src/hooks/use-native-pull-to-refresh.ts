import { useCallback, useEffect } from 'react';
import {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { hapticImpactLight } from '@/lib/haptics';

/** Overscroll distance (px) past which a release triggers a refresh. Matches the web hook. */
const PULL_THRESHOLD = 64;
/** Hard cap on how far the indicator travels, however far the list is overscrolled. */
const PULL_MAX = 96;
/** Settle motion for the snap-into-refresh and spring-back — a quick, barely-overshooting spring,
 *  which reads as more alive than a linear timing and closer to the native refresh recoil. */
const SETTLE_SPRING = { damping: 18, stiffness: 220, mass: 0.7 } as const;

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
 * fires the refresh, and the returned `listTranslateY` onto the list wrapper so it holds down while
 * the refresh runs (see below). `refreshing` mirrors the controlled-`RefreshControl` contract.
 *
 * The subtlety vs. web: web opens the pull gap by translating the list itself, so it can just hold
 * that translation until `refreshing` clears. On iOS the gap comes from the *native* bounce, which
 * recoils the instant the finger lifts — so without help the content snaps back immediately even
 * though the (overlay) spinner stays. To match web's "stick until done", once triggered we hold the
 * content down ourselves via `listTranslateY`, easing from the release distance to `PULL_THRESHOLD`
 * (mirroring web's snap) and then counteracting the native recoil frame-by-frame
 * (`holdOffset + scrollY`) so the content stays put at a constant offset while `refreshing`, before
 * springing back to 0. During the *pull* itself `listTranslateY` stays 0 — the native bounce is
 * already moving the content, and translating on top of it would double the movement.
 *
 * Inert off iOS: Android clamps overscroll (no negative offset) and web never bounces, so `scrollY`
 * stays >= 0 there and nothing here ever leaves its rest value.
 */
export function useNativePullToRefresh(scrollY: SharedValue<number>, onRefresh: () => void, refreshing: boolean) {
  const pullY = useSharedValue(0);
  // Pulled past the trigger threshold as of the latest frame — read on release to decide whether
  // to fire. A shared value (not a ref) so the UI-thread reaction can write it.
  const armed = useSharedValue(false);
  // True from a triggered release until the spring-back completes — freezes `pullY` and switches
  // `listTranslateY` into hold mode.
  const holding = useSharedValue(false);
  // Target content offset while holding: eased to PULL_THRESHOLD on trigger, back to 0 on resolve.
  const holdOffset = useSharedValue(0);

  // Follow the elastic overscroll 1:1 (iOS already applies rubber-band resistance, so the raw
  // negative offset is the natural pull distance), capped at PULL_MAX. Frozen while holding.
  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      if (holding.value) return;
      const over = y < 0 ? -y : 0;
      pullY.value = over > PULL_MAX ? PULL_MAX : over;
      const nowArmed = over >= PULL_THRESHOLD;
      // Tap the moment the pull first crosses the trigger line — the signature "you've pulled far
      // enough" feedback the native control gives. Fire only on the false→true edge, not every frame.
      if (nowArmed && !armed.value) runOnJS(hapticImpactLight)();
      armed.value = nowArmed;
    },
  );

  // How far to translate the list wrapper. Zero during the pull (native bounce owns the movement);
  // during the hold, `holdOffset + scrollY` keeps the content pinned at `holdOffset` as the native
  // overscroll recoils from the release position back to 0.
  const listTranslateY = useDerivedValue(() => (holding.value ? holdOffset.value + scrollY.value : 0));

  useEffect(() => {
    if (holding.value && !refreshing) {
      holdOffset.value = withSpring(0, SETTLE_SPRING, (finished) => {
        // Stay in hold mode until the spring-back lands, so listTranslateY eases to 0 rather than
        // snapping there; only then release so the next pull starts clean.
        if (finished) holding.value = false;
      });
      pullY.value = withSpring(0, SETTLE_SPRING);
    }
  }, [refreshing, holding, holdOffset, pullY]);

  const onScrollEndDrag = useCallback(() => {
    if (!armed.value || holding.value) return;
    holding.value = true;
    // Start the hold at the actual release distance, then ease to the resting threshold — the same
    // snap web does — while `listTranslateY` counteracts the native recoil to keep it smooth.
    holdOffset.value = scrollY.value < 0 ? -scrollY.value : 0;
    holdOffset.value = withSpring(PULL_THRESHOLD, SETTLE_SPRING);
    onRefresh();
  }, [armed, holding, holdOffset, scrollY, onRefresh]);

  return { pullY, listTranslateY, pullThreshold: PULL_THRESHOLD, onScrollEndDrag };
}
