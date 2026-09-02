import { useCallback, useEffect, useRef, useState } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withDecay, withTiming } from 'react-native-reanimated';

import { edgeOffset, panLimits, WIDE_ZOOM_HEADROOM, type RestEdge, type Size } from '@/components/reader/page-geometry';

// Shared NATIVE zoom primitive for both readers (a paged page, and each webtoon
// page). It owns EVERYTHING the two share — not just the math but the whole gesture
// wiring, so there's one place that defines how zoom behaves:
//   - pinch-to-zoom, anchored on the focal point, clamped to the picture's own box (so a page can't
//     be pushed off into its letterbox), ignoring finger-lift frames so the scale doesn't
//     jump/rubber-band on release;
//   - double-tap to toggle between the page's REST and a fixed magnification, centred on the tap —
//     or, for a consumer that asks (`onDoubleTap`), to hand the tap over instead;
//   - one-finger pan (only while zoomed) that flings with momentum on release — and never turns
//     the page: a zoomed page is left by its taps, or by leaving the zoom;
//   - a rest that isn't always 1×: a spread, or every page under fill-height, rests at fit-height
//     at the edge reading starts from, and keeps its side-zone taps live (see `restScale`);
//   - an optional single tap (page-turn zones / chrome toggle), and the mutually
//     EXCLUSIVE composition of pinch vs the taps (so a pinch is never misread as a
//     double-tap), with pan/extras running Simultaneous alongside.
// The consumer just applies the returned `gesture` to a GestureDetector and
// `animatedStyle` to the view that should scale. Web readers have their own
// pointer-event implementations — this is native-only (reanimated + gesture-handler).

const MAX_SCALE = 4;
// At/below this we treat the content as "not zoomed" and snap back to a clean 1×. Also the
// tolerance, as a ratio, for "at rest".
const ZOOM_EPSILON = 1.01;
// Magnification a double-tap zooms into (and back out of), relative to the page's rest.
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
  content,
  restScale = 1,
  restEdge = 'center',
  active = true,
  doubleTapEnabled = true,
  onDoubleTap,
}: {
  width: number;
  height: number;
  /** The picture's box at 1×, centred in the viewport — what every pan is clamped to, so a zoomed
   *  page stops at its own edge rather than sliding on into its letterbox. Defaults to the
   *  viewport, which is right for a page that fills it (and for a fit-width page, whose picture
   *  is top-aligned rather than centred, so this clamp would be the wrong one). */
  content?: Size;
  /** Where the page sits when nothing is touching it (see page-geometry's `pageGeometry`): 1× for
   *  most pages; a spread rests above 1×, at `restEdge`. Double-tap returns here, a page that
   *  leaves the screen goes back here, and a rest above 1× keeps the side-zone taps live while
   *  zoomed (they pan first — see `tapPanDirection`). Pinching OUT below the rest is allowed, down
   *  to 1×, for a look at the whole spread; the next double-tap or page turn restores it. */
  restScale?: number;
  restEdge?: RestEdge;
  /** Whether this is the page on screen. A page that leaves it is put back to rest SILENTLY: the
   *  pager's zoomed flag is the visible page's, and the page arriving reports its own on becoming
   *  active. Two pages reporting in one commit would race, and the order they commit in is the
   *  order they sit in the tree, not the order they were read in. */
  active?: boolean;
  /** Whether there is a double-tap at all (`useReaderSettings().doubleTap !== 'off'`). Off, the
   *  double-tap leaves the composition altogether rather than merely being disabled, so the single
   *  tap has nothing to wait out and fires on release — the whole point of turning it off. */
  doubleTapEnabled?: boolean;
  /** When given, a double-tap on a page AT REST is handed here instead of magnifying — the
   *  fill-height toggle, which changes what rest IS. A page that isn't at rest (magnified, or
   *  pinched out below a spread's rest) still goes back to rest first, so the toggle is always
   *  read against a settled page. */
  onDoubleTap?: () => void;
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
  // Boxed so the rest effect below can report without depending on the consumer's callback
  // identity — a new `onZoomChange` closure must not put a page the reader has zoomed back to rest.
  const reportZoomRef = useRef(reportZoom);
  useEffect(() => {
    reportZoomRef.current = reportZoom;
  }, [reportZoom]);

  const viewport: Size = { width, height };
  const box: Size = content ?? viewport;
  const maxScale = Math.max(MAX_SCALE, restScale * WIDE_ZOOM_HEADROOM);
  const restTx = edgeOffset(restEdge, panLimits(restScale, box, viewport).x);
  const restZoomed = restScale > ZOOM_EPSILON;

  // Put the page at rest: on mount, whenever the rest itself moves (the picture's dimensions
  // arriving, the spread setting flipped, a rotation), and when the page leaves the screen so its
  // next arrival starts from rest. Animated if the page is being looked at — a spread that loads
  // under your eyes grows into place — and instant for a neighbour being readied off screen.
  // `box`/`width`/`height` are deliberately not deps: they only matter through `restTx`, and a
  // page whose rest hasn't moved keeps whatever zoom the reader gave it.
  useEffect(() => {
    const settled =
      Math.abs(scale.value - restScale) < 0.001 && Math.abs(tx.value - restTx) < 0.5 && Math.abs(ty.value) < 0.5;
    if (!settled) {
      if (active) {
        scale.set(withTiming(restScale));
        tx.set(withTiming(restTx));
        ty.set(withTiming(0));
      } else {
        scale.set(restScale);
        tx.set(restTx);
        ty.set(0);
      }
      savedTx.set(restTx);
      savedTy.set(0);
    }
    // The local `zoomed` flag is left alone off screen: it only gates gestures, and an inactive
    // page receives none. It is set again, with the report, the moment the page is active.
    if (active) reportZoomRef.current(restZoomed);
  }, [active, restScale, restTx, restZoomed, scale, tx, ty, savedTx, savedTy]);

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
      const nextScale = clamp(baseScale.value * e.scale, 1, maxScale);
      const anchorX = (focalStartX.value - cx - baseTx.value) / baseScale.value;
      const anchorY = (focalStartY.value - cy - baseTy.value) / baseScale.value;
      const limit = panLimits(nextScale, box, viewport);
      tx.set(clamp(e.focalX - cx - nextScale * anchorX, -limit.x, limit.x));
      ty.set(clamp(e.focalY - cy - nextScale * anchorY, -limit.y, limit.y));
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
    .enabled(enabled && doubleTapEnabled)
    .numberOfTaps(2)
    .maxDuration(300)
    .maxDistance(DOUBLE_TAP_MAX_DIST)
    .onEnd((e) => {
      const s0 = scale.value;
      // Anywhere but at rest — magnified, or pinched out below a spread's rest — goes back to rest.
      if (s0 > restScale * ZOOM_EPSILON || s0 < restScale / ZOOM_EPSILON) {
        scale.set(withTiming(restScale));
        tx.set(withTiming(restTx));
        ty.set(withTiming(0));
        savedTx.set(restTx);
        savedTy.set(0);
        runOnJS(reportZoom)(restZoomed);
        return;
      }
      if (onDoubleTap) {
        runOnJS(onDoubleTap)();
        return;
      }
      const cx = width / 2;
      const cy = height / 2;
      const target = Math.min(DOUBLE_TAP_SCALE * restScale, maxScale);
      const limit = panLimits(target, box, viewport);
      // Keep the tapped content point under the finger. From 1× at the origin this is the familiar
      // tx = (p − centre)(1 − scale); from a spread's rest the point has to be read back through
      // the rest transform first.
      const anchorX = (e.x - cx - tx.value) / s0;
      const anchorY = (e.y - cy - ty.value) / s0;
      const nx = clamp(e.x - cx - target * anchorX, -limit.x, limit.x);
      const ny = clamp(e.y - cy - target * anchorY, -limit.y, limit.y);
      scale.set(withTiming(target));
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
      const limit = panLimits(scale.value, box, viewport);
      tx.set(clamp(savedTx.value + e.translationX, -limit.x, limit.x));
      ty.set(clamp(savedTy.value + e.translationY, -limit.y, limit.y));
    })
    // Fling the zoomed image: keep gliding on release, decelerating and stopping at
    // the pan bounds (`clamp`). The next pan's onStart re-captures tx/ty as its base,
    // so grabbing mid-glide continues seamlessly from wherever it's coasted.
    .onEnd((e) => {
      const limit = panLimits(scale.value, box, viewport);
      tx.set(withDecay({ velocity: e.velocityX, clamp: [-limit.x, limit.x], deceleration: 0.994 }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: [-limit.y, limit.y], deceleration: 0.994 }));
    });

  // Optional single tap — page-turn zones (x-based) or a chrome toggle (ignores x).
  // Off while zoomed (a tap there does nothing) — except on a page that RESTS zoomed, a spread or
  // a fill-height page, whose taps stay live and turn as they always do: with the pager's scroll
  // frozen under a zoom, the taps are how such a page is left — and per the consumer's own gate.
  // `singleTapArmed` carries the touch-down verdict (see `singleTapAllowed`) through to the
  // release; with no gate supplied every touch arms it, which is the old behaviour exactly.
  const singleTap = onSingleTap
    ? Gesture.Tap()
        .enabled((!zoomed || restZoomed) && singleTapEnabled)
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
  const exclusive =
    doubleTapEnabled && singleTap
      ? Gesture.Exclusive(pinch, doubleTap, singleTap)
      : doubleTapEnabled
        ? Gesture.Exclusive(pinch, doubleTap)
        : singleTap
          ? Gesture.Exclusive(pinch, singleTap)
          : pinch;
  const gesture = Gesture.Simultaneous(pan, ...(extraSimultaneous ?? []), exclusive);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return { gesture, animatedStyle, zoomed };
}
