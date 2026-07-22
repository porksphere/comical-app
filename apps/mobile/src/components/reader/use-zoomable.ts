import { useCallback, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';

// Shared NATIVE zoom primitive for both readers (a paged page, and the webtoon
// viewport). It owns the pieces the two share verbatim:
//   - pinch-to-zoom, anchored on the focal point, clamped to a width×height box,
//     with a fast-pinch commit so a lift that momentarily dips the scale under
//     ZOOM_EPSILON doesn't rubber-band back to 1×;
//   - double-tap to toggle between fit and a fixed zoom, centred on the tap;
//   - one-finger pan (only while zoomed) that flings with momentum on release.
// The consumer composes the returned gestures with its OWN (tap zones / chrome
// toggle / content-pan / list scroll) and applies `animatedStyle` to whichever
// view should scale. Web readers have their own pointer-event implementations —
// this is native-only (reanimated + gesture-handler).

const MAX_SCALE = 4;
// At/below this we treat the content as "not zoomed" and snap back to a clean 1×.
const ZOOM_EPSILON = 1.01;
// Scale a double-tap zooms into (and back out of).
const DOUBLE_TAP_SCALE = 2.5;
// A pinch that reached at least this scale counts as a deliberate zoom-in, so a
// final frame that dips under ZOOM_EPSILON on lift (common on a fast pinch)
// commits the zoom instead of rubber-banding to 1×.
const PINCH_COMMIT = 1.2;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export function useZoomable({
  width,
  height,
  enabled = true,
  onZoomChange,
}: {
  width: number;
  height: number;
  /** Gates pinch/double-tap/pan off entirely (e.g. a fit-width page that
   *  content-pans instead, or a failed page showing its Retry chip). */
  enabled?: boolean;
  /** Fires when the zoomed state flips — the reader disables its swipe-away /
   *  scroll while zoomed so a one-finger drag pans instead. */
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // Anchor captured once when a pinch begins, so the transform is derived from
  // fixed values each frame instead of compounding per-frame deltas.
  const focalStartX = useSharedValue(0);
  const focalStartY = useSharedValue(0);
  const baseScale = useSharedValue(1);
  const baseTx = useSharedValue(0);
  const baseTy = useSharedValue(0);
  // Largest scale reached during the current pinch — lets the release tell a real
  // zoom-in (whose last frame may dip on lift) from a tiny/settled pinch.
  const pinchMaxScale = useSharedValue(1);

  const [zoomed, setZoomed] = useState(false);

  const reportZoom = useCallback(
    (next: boolean) => {
      setZoomed(next);
      onZoomChange?.(next);
    },
    [onZoomChange],
  );

  const reset = useCallback(() => {
    scale.set(1);
    tx.set(0);
    ty.set(0);
    savedTx.set(0);
    savedTy.set(0);
    reportZoom(false);
  }, [scale, tx, ty, savedTx, savedTy, reportZoom]);

  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .onStart((e) => {
      focalStartX.set(e.focalX);
      focalStartY.set(e.focalY);
      baseScale.set(scale.value);
      baseTx.set(tx.value);
      baseTy.set(ty.value);
      pinchMaxScale.set(scale.value);
    })
    .onUpdate((e) => {
      const cx = width / 2;
      const cy = height / 2;
      const nextScale = clamp(baseScale.value * e.scale, 1, MAX_SCALE);
      if (nextScale > pinchMaxScale.value) pinchMaxScale.set(nextScale);
      const anchorX = (focalStartX.value - cx - baseTx.value) / baseScale.value;
      const anchorY = (focalStartY.value - cy - baseTy.value) / baseScale.value;
      const limitX = ((nextScale - 1) * width) / 2;
      const limitY = ((nextScale - 1) * height) / 2;
      tx.set(clamp(e.focalX - cx - nextScale * anchorX, -limitX, limitX));
      ty.set(clamp(e.focalY - cy - nextScale * anchorY, -limitY, limitY));
      scale.set(nextScale);
    })
    .onEnd(() => {
      if (scale.value > ZOOM_EPSILON) {
        savedTx.set(tx.value);
        savedTy.set(ty.value);
        runOnJS(reportZoom)(true);
        return;
      }
      // Ended at ~1×. A fast pinch-in's LAST frame often dips under the epsilon as
      // the fingers converge on lift — don't rubber-band those: if the pinch STARTED
      // from ~1× and actually reached a real zoom, commit at that peak instead. A
      // pinch that started already-zoomed still honours a deliberate return to 1×.
      if (baseScale.value <= ZOOM_EPSILON && pinchMaxScale.value > PINCH_COMMIT) {
        const target = clamp(pinchMaxScale.value, 1, MAX_SCALE);
        const limitX = ((target - 1) * width) / 2;
        const limitY = ((target - 1) * height) / 2;
        const nx = clamp(tx.value, -limitX, limitX);
        const ny = clamp(ty.value, -limitY, limitY);
        scale.set(withTiming(target));
        tx.set(withTiming(nx));
        ty.set(withTiming(ny));
        savedTx.set(nx);
        savedTy.set(ny);
        runOnJS(reportZoom)(true);
        return;
      }
      scale.set(withTiming(1));
      tx.set(withTiming(0));
      ty.set(withTiming(0));
      savedTx.set(0);
      savedTy.set(0);
      runOnJS(reportZoom)(false);
    });

  const doubleTap = Gesture.Tap()
    .enabled(enabled)
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      if (scale.value > ZOOM_EPSILON) {
        scale.set(withTiming(1));
        tx.set(withTiming(0));
        ty.set(withTiming(0));
        savedTx.set(0);
        savedTy.set(0);
        runOnJS(reportZoom)(false);
        return;
      }
      const cx = width / 2;
      const cy = height / 2;
      const limitX = ((DOUBLE_TAP_SCALE - 1) * width) / 2;
      const limitY = ((DOUBLE_TAP_SCALE - 1) * height) / 2;
      // Keep the tapped content point under the finger: tx = (p − centre)(1 − scale).
      const nx = clamp((e.x - cx) * (1 - DOUBLE_TAP_SCALE), -limitX, limitX);
      const ny = clamp((e.y - cy) * (1 - DOUBLE_TAP_SCALE), -limitY, limitY);
      scale.set(withTiming(DOUBLE_TAP_SCALE));
      tx.set(withTiming(nx));
      ty.set(withTiming(ny));
      savedTx.set(nx);
      savedTy.set(ny);
      runOnJS(reportZoom)(true);
    });

  // One-finger pan, only while zoomed (so it never steals a swipe at 1×). Capped at
  // a single pointer so a two-finger pinch never registers as a pan and flings on
  // release — momentum belongs to a deliberate one-finger drag, not to zooming.
  const pan = Gesture.Pan()
    .enabled(zoomed && enabled)
    .maxPointers(1)
    .onStart(() => {
      savedTx.set(tx.value);
      savedTy.set(ty.value);
    })
    .onUpdate((e) => {
      const limitX = ((scale.value - 1) * width) / 2;
      const limitY = ((scale.value - 1) * height) / 2;
      tx.set(clamp(savedTx.value + e.translationX, -limitX, limitX));
      ty.set(clamp(savedTy.value + e.translationY, -limitY, limitY));
    })
    // Fling the zoomed image: keep gliding on release, decelerating and stopping at
    // the pan bounds (`clamp`). The next pan's onStart re-captures tx/ty as its base,
    // so grabbing mid-glide continues seamlessly from wherever it's coasted.
    .onEnd((e) => {
      const limitX = ((scale.value - 1) * width) / 2;
      const limitY = ((scale.value - 1) * height) / 2;
      tx.set(withDecay({ velocity: e.velocityX, clamp: [-limitX, limitX], deceleration: 0.994 }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: [-limitY, limitY], deceleration: 0.994 }));
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return { pinch, doubleTap, pan, animatedStyle, zoomed, reset };
}
