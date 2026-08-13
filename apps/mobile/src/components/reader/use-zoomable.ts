import { useCallback, useState } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';

// Shared NATIVE zoom primitive for both readers (a paged page, and each webtoon
// page). It owns EVERYTHING the two share — not just the math but the whole gesture
// wiring, so there's one place that defines how zoom behaves:
//   - pinch-to-zoom, anchored on the focal point, clamped to a width×height box,
//     ignoring finger-lift frames so the scale doesn't jump/rubber-band on release;
//   - double-tap to toggle between fit and a fixed zoom, centred on the tap;
//   - one-finger pan (only while zoomed) that flings with momentum on release;
//   - an optional single tap (page-turn zones / chrome toggle), and the mutually
//     EXCLUSIVE composition of pinch vs the taps (so a pinch is never misread as a
//     double-tap), with pan/extras running Simultaneous alongside.
// The consumer just applies the returned `gesture` to a GestureDetector and
// `animatedStyle` to the view that should scale. Web readers have their own
// pointer-event implementations — this is native-only (reanimated + gesture-handler).

const MAX_SCALE = 4;
// At/below this we treat the content as "not zoomed" and snap back to a clean 1×.
const ZOOM_EPSILON = 1.01;
// Scale a double-tap zooms into (and back out of).
const DOUBLE_TAP_SCALE = 2.5;
// Movement caps that make the tap recognizers FAIL once the finger travels —
// they must be explicit: RNGH's iOS tap handler has no default distance bound,
// and when the taps run `simultaneousWithExternalGesture` a scroll (the
// continuous webtoon's Gesture.Native list) no longer preempts them either.
// Without these, two quick scroll flicks read as a double-tap and zoomed the
// viewport mid-scroll on iOS. 40 matches the web readers' DOUBLE_TAP_DIST
// (how far apart the two taps may land); a lone tap gets a tighter drift cap.
const DOUBLE_TAP_MAX_DIST = 40;
const SINGLE_TAP_MAX_DIST = 16;
// How long the finger may stay down and still count as a page-turn tap. The single tap used to
// inherit the double-tap's 300ms, which is the wrong bound for it: 300ms limits the interval
// BETWEEN two taps, whereas here it silently rejects one deliberate, unhurried press-and-release.
// Nothing else on the page claims a long press, so the only outcome a tight bound buys is "nothing
// happens" — strictly worse than turning the page. `SINGLE_TAP_MAX_DIST` is what actually keeps a
// drag (a page swipe, a content-pan) from reading as a tap; duration was never doing that work.
// This also unblocks Maestro on iOS, whose XCUITest-synthesized touch is held far longer than a
// human tap: e2e/mobile/reader-navigation is the first flow to TAP a zone rather than just assert
// one exists, and it failed on iOS at `reader.control.next` — chrome still up, page still 1/26 —
// while Android (tapped via `adb shell input tap`, ~50ms) sailed through the same step.
const SINGLE_TAP_MAX_DURATION = 800;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export function useZoomable({
  width,
  height,
  enabled = true,
  onZoomChange,
  onPinchChange,
  onSingleTap,
  singleTapEnabled = true,
  singleTapAllowed,
  simultaneousExternal,
  extraSimultaneous,
}: {
  width: number;
  height: number;
  /** Gates pinch/double-tap/pan off entirely (e.g. a fit-width page that
   *  content-pans instead, or a failed page showing its Retry chip). */
  enabled?: boolean;
  /** Fires when the zoomed state flips — the reader disables its swipe-away /
   *  scroll while zoomed so a one-finger drag pans instead. */
  onZoomChange?: (zoomed: boolean) => void;
  /** Fires when a pinch STARTS and ends — distinct from `onZoomChange`, which reports the settled
   *  result and so says nothing until the fingers are already up.
   *
   *  A pinch has to run simultaneously with the scroller it lives inside (see
   *  `simultaneousExternal`, and what happens when it doesn't), and a UIScrollView reads two
   *  fingers as a two-finger DRAG: the same pinch that scales the page also pans the scroller
   *  under it, sliding the neighbouring pages into view. A consumer that can freeze its scroll
   *  wants to know at the start of the pinch, not the end of it. Reported on every exit, cancelled
   *  pinches included — a scroller frozen for a gesture that ended some other way stays frozen. */
  onPinchChange?: (pinching: boolean) => void;
  /** Optional single tap, dispatched with the tap's x within the view (page-turn
   *  zones use it; a chrome toggle ignores it). Composed Exclusive with the
   *  double-tap so it waits out a possible second tap. Omit for no single tap. */
  onSingleTap?: (x: number) => void;
  /** Gate for the single tap, independent of `enabled` (e.g. a page's tap zones
   *  stay live on an overflowing fit-width page where pinch is off). */
  singleTapEnabled?: boolean;
  /** UI-thread worklet asked, at TOUCH-DOWN, whether this touch is allowed to become a single tap.
   *  The continuous webtoon reader answers "no" while the strip is coasting, so a tap that stops a
   *  flick is spent on stopping it rather than also toggling the chrome.
   *
   *  Asked at touch-down and latched, not read at release, because a touch that interrupts a scroll
   *  has already ended that scroll by the time the finger lifts — the answer only exists at the
   *  moment the finger LANDS. Omit for a single tap that is always allowed. */
  singleTapAllowed?: () => boolean;
  /** External gestures (a list's `Gesture.Native()` scroll, and anything else mounted on the
   *  scroller — the paged reader's edge pan, say) that these must run SIMULTANEOUSLY with. EVERY
   *  gesture that could arbitrate against these belongs here, not just the scroll: an undeclared
   *  competitor doesn't have to win often to be noticed, and what it takes first is the double-tap,
   *  which is the only one here that has to survive across two separate touch sequences. */
  simultaneousExternal?: GestureType | GestureType[];
  /** Extra gestures composed Simultaneous with the zoom gestures (e.g. a page's
   *  fit-width content-pan). */
  extraSimultaneous?: GestureType[];
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
  // Whether the touch currently down is allowed to become a single tap — see `singleTapAllowed`.
  const singleTapArmed = useSharedValue(true);
  // Whether a pinch is in flight, so `onFinalize` only reports an end for a pinch it reported the
  // start of (it runs for every outcome, including one that never activated).
  const pinching = useSharedValue(false);

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
      pinching.set(true);
      if (onPinchChange) runOnJS(onPinchChange)(true);
    })
    .onUpdate((e) => {
      // Ignore frames where a finger has already begun to lift (numberOfPointers < 2):
      // those report a collapsing two-finger distance that yanks the scale down right
      // before release — the "pinch in, then it animates out / jumps" jank. Keeping
      // the last clean two-finger frame means the scale ends where the fingers were.
      if (e.numberOfPointers < 2) return;
      const cx = width / 2;
      const cy = height / 2;
      const nextScale = clamp(baseScale.value * e.scale, 1, MAX_SCALE);
      const anchorX = (focalStartX.value - cx - baseTx.value) / baseScale.value;
      const anchorY = (focalStartY.value - cy - baseTy.value) / baseScale.value;
      const limitX = ((nextScale - 1) * width) / 2;
      const limitY = ((nextScale - 1) * height) / 2;
      tx.set(clamp(e.focalX - cx - nextScale * anchorX, -limitX, limitX));
      ty.set(clamp(e.focalY - cy - nextScale * anchorY, -limitY, limitY));
      scale.set(nextScale);
    })
    .onEnd(() => {
      // No animation on release: the scale is already exactly where the fingers left
      // it (the lift-frame guard above keeps it clean), so just keep it — or reset to
      // a clean 1× when it's within a hair of 1×, which is imperceptible since it's
      // already there. Animating here is what produced the "weird jump on release".
      if (scale.value > ZOOM_EPSILON) {
        savedTx.set(tx.value);
        savedTy.set(ty.value);
        runOnJS(reportZoom)(true);
      } else {
        scale.set(1);
        tx.set(0);
        ty.set(0);
        savedTx.set(0);
        savedTy.set(0);
        runOnJS(reportZoom)(false);
      }
    })
    // Every exit, not just a clean release: a pinch that is cancelled (or that never activated)
    // must still hand the scroller back, or it stays frozen until the next one.
    .onFinalize(() => {
      if (!pinching.value) return;
      pinching.set(false);
      if (onPinchChange) runOnJS(onPinchChange)(false);
    });

  const doubleTap = Gesture.Tap()
    .enabled(enabled)
    .numberOfTaps(2)
    .maxDuration(300)
    .maxDistance(DOUBLE_TAP_MAX_DIST)
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

  // Optional single tap — page-turn zones (x-based) or a chrome toggle (ignores x).
  // Off while zoomed (a tap there does nothing) and per the consumer's own gate.
  // `singleTapArmed` carries the touch-down verdict (see `singleTapAllowed`) through to the
  // release; with no gate supplied every touch arms it, which is the old behaviour exactly.
  const singleTap = onSingleTap
    ? Gesture.Tap()
        .enabled(!zoomed && singleTapEnabled)
        .numberOfTaps(1)
        .maxDuration(SINGLE_TAP_MAX_DURATION)
        .maxDistance(SINGLE_TAP_MAX_DIST)
        .onBegin(() => {
          singleTapArmed.set(!singleTapAllowed || singleTapAllowed());
        })
        .onEnd((e) => {
          if (!singleTapArmed.value) return;
          runOnJS(onSingleTap)(e.x);
        })
    : null;

  // Anything mounted on the scroller (passed in) would otherwise swallow the pinch/taps — let them
  // run alongside all of it.
  const externals = simultaneousExternal
    ? Array.isArray(simultaneousExternal)
      ? simultaneousExternal
      : [simultaneousExternal]
    : [];
  if (externals.length) {
    pinch.simultaneousWithExternalGesture(...externals);
    pan.simultaneousWithExternalGesture(...externals);
    doubleTap.simultaneousWithExternalGesture(...externals);
    singleTap?.simultaneousWithExternalGesture(...externals);
  }

  // pinch / double-tap / single-tap are mutually EXCLUSIVE (pinch has priority, so a
  // pinch's two fingers can't be misread as a double-tap and randomly zoom all the
  // way); pan and any extras (a page's content-pan) run Simultaneous alongside.
  const exclusive = singleTap
    ? Gesture.Exclusive(pinch, doubleTap, singleTap)
    : Gesture.Exclusive(pinch, doubleTap);
  const gesture = Gesture.Simultaneous(pan, ...(extraSimultaneous ?? []), exclusive);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return { gesture, animatedStyle, zoomed, reset };
}
