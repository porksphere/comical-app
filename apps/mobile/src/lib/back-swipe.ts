import { createContext, useContext, useMemo } from 'react';
import { Gesture, type GestureType, type LegacyPanGesture as PanGesture } from 'react-native-gesture-handler';
import { makeMutable, type SharedValue } from 'react-native-reanimated';

import { projectRelease } from '@/lib/gesture-release';
import { isGestureTraceEnabled, trace, traceGate, traceThrottled } from '@/lib/gesture-trace';

// Gesture Handler 3 exports the builder API's types under `Legacy*` names, except this one.
type NativeGesture = ReturnType<typeof Gesture.Native>;

/**
 * The app's hand-rolled back-swipe: what counts as one, in one place.
 *
 * Several surfaces need it — the series page's details (which drives the gallery collapse) and the
 * in-screen search layer (which slides out like a pushed card) — and none of them can use the real
 * thing. A contained transparent modal has no native pop gesture, and neither does a sibling view
 * pretending to be a screen. So each rig recreates it, and the ONE part that must not drift between
 * them is what counts as an activation.
 *
 * ── Declarative offsets, NOT manual activation ───────────────────────────────
 * This used to decide activation itself: `manualActivation(true)`, watch the raw touches in
 * `onTouchesMove`, and call `manager.activate()` once the travel was more horizontal than vertical
 * by some ratio. The appeal was real, and the reasoning written here for a while was not wrong on
 * its own terms — a ratio is a CONE, which matches intent far better than the rectangle the
 * declarative options can express, and a thumb arc that a rectangle rejects sails through a cone.
 *
 * It does not work here. Three rounds of fixes went into it — a dead band between the cones, a
 * verdict latch that never re-armed once a scroller owned the touch stream, a recogniser stranded
 * in FAILED — and each fixed something genuinely broken while leaving the gesture just as dead.
 * The common factor was the mechanism, not the numbers. Manual activation decides in a worklet
 * touch callback; these pans are composed `Simultaneous` with a native scroll view, and once that
 * scroller owns the stream those callbacks are not something to build on. The offsets below are
 * evaluated inside the native recogniser instead — which is what the search layer used for months,
 * working, before it was "unified" onto the clever version.
 *
 * So: a rectangle, honestly. Activate once the drag has gone far enough RIGHT; give up if it goes
 * far enough vertically, or meaningfully left, first. No ratio, no pending state, nothing to get
 * stuck in. The strictness a cone was wanted for is approximated by keeping the two numbers close,
 * so a drag that wanders vertically loses before it can win.
 *
 * ── The numbers are a race, not a taste ─────────────────────────────────────
 * Read BACK_ACTIVATE_PX below before adjusting either constant. They are not tuned for feel: they
 * are sized against UIScrollView's own claim threshold, and raising activation past it does not
 * make the gesture "stricter", it makes it unreachable on any drag slow enough to be measured.
 *
 * If the cone is worth another attempt it needs a different mechanism — a native recogniser that
 * understands direction — not a fourth pass at this one.
 */

/**
 * Rightward travel that activates the back-swipe.
 *
 * TEN pixels, and the number is not a feel preference — it is a race condition, settled by a device
 * trace. UIScrollView's own pan recognizer claims a touch after roughly ten points of movement IN
 * ANY DIRECTION, including sideways on a vertically-scrolling list that has nothing to scroll that
 * way. Once it has claimed, this pan stops being fed pointer data: the trace showed drag after drag
 * reaching BEGAN, receiving exactly ONE touch sample somewhere between 4 and 23 points of rightward
 * travel with two or three points of vertical wobble, and then hearing nothing at all until the
 * finger lifted four hundred milliseconds later. Nothing in the criteria had failed. There simply
 * was no longer anyone listening.
 *
 * At the old 24 that made a slow swipe unwinnable by construction, because 24 is on the far side of
 * the scroller's 10 — a leisurely drag hands the touch over before this pan is allowed to want it.
 * The swipes that DID work were fast ones, where a single frame carried the finger past 24 before
 * the scroller's threshold was even evaluated. That is the whole of "it works sometimes", and it is
 * why every previous attempt to fix this by reasoning about angles and dominance missed: the
 * criteria were never consulted.
 *
 * So activation now happens at the scroller's own threshold rather than beyond it. Apple's back
 * gesture ducks this fight entirely by living on the screen edge, where no scroller competes; a
 * full-surface pop has to win the contest instead of avoiding it.
 */
const BACK_ACTIVATE_PX = 10;
/**
 * ── How straight a back-swipe has to be, and why it takes TWO numbers ───────────────────────────
 *
 * THE RULE is BACK_SWIPE_DEGREES: how far off straight-across a back-swipe may wander over its
 * OPENING stretch (BACK_SWIPE_LOCK_PX). Stated in degrees because that is the unit the question gets
 * asked in, and everything below derives from it.
 *
 * It cannot be applied at activation. Activation has to decide inside ten points — the scroller's
 * claim deadline, not a preference (see BACK_ACTIVATE_PX) — and fifteen degrees of ten points is a
 * two-and-a-half-point vertical budget. That is finger jitter. A gate that tight does not measure
 * the swipe's direction, it measures how steadily the thumb landed, and it would put us straight
 * back to swipes that die for no visible reason.
 *
 * So the two halves get the precision they actually have:
 *
 *   • ACTIVATION uses BACK_ACTIVATE_DOMINANCE, a coarse pre-filter. Its only jobs are to not lose
 *     honest swipes and to not steal obvious scrolls. It is deliberately generous, because ten
 *     points cannot support better and because being wrong here is cheap: activation buys only the
 *     right to FOLLOW the finger, which is reversible.
 *   • The LOCK uses the real angle, once the drag has travelled BACK_SWIPE_LOCK_PX from activation —
 *     long enough for the angle to be a measurement rather than a guess. It is decided ONCE there
 *     and latched (`trackBackSwipeShape`): whatever the finger does afterwards, the drag was or was
 *     not a back-swipe, and only the release distance is left to decide.
 *
 * Worth knowing what this is NOT: UIKit does not work this way. Its own back gesture is edge-only
 * (UIScreenEdgePanGestureRecognizer, ~20pt from the leading edge), which is how it avoids ever
 * having to tell a back-swipe from a scroll — almost nothing else starts in that strip. And once
 * engaged it never re-checks direction: the interactive pop's percentComplete is horizontal
 * translation alone, vertical discarded, so an edge swipe that arcs hard upward still pops. Decide
 * once, early, then commit — the same shape as UIScrollView's directional lock, and the shape the
 * lock copies. A full-surface back-swipe only needs the decision a few points later than an edge
 * gesture would, because it has no strip to hide in.
 *
 * It used to judge the angle over the WHOLE stroke, at release. That read thumb arcs as diagonals:
 * a quick flick curls at the end (120 across with 40 of curl is 18°), so flicks a native pop takes
 * sprang back, and a long drag that curled after it was obviously a back-swipe needed a latch to
 * survive its own ending.
 *
 * Tune BACK_SWIPE_DEGREES. Leave the other two alone unless swipes stop STARTING, which is the
 * failure the pre-filter owns.
 */
const BACK_SWIPE_DEGREES = 15;

/** Travel from activation over which BACK_SWIPE_DEGREES is judged — 15° of it is ~8pt of vertical,
 *  past finger jitter, and short enough that even a quick flick has been decided before it lands. */
const BACK_SWIPE_LOCK_PX = 32;

/** The rule as a slope: the most |cross-axis| may be as a fraction of |along-axis|, over the
 *  opening stretch. Derived from the degrees above so the two cannot disagree. */
const BACK_DOMINANCE = Math.tan((BACK_SWIPE_DEGREES * Math.PI) / 180);

/**
 * The coarse gate at activation — see above for why this is not BACK_DOMINANCE. Roughly 35°, which
 * at a ten-point activation distance is about as strict as the opening millimetres of a real swipe
 * will tolerate: the wander in those first few points is a large share of the whole measurement.
 */
export const BACK_ACTIVATE_DOMINANCE = 0.7;

/**
 * Vertical travel (or leftward travel) that gives the drag up instead. Derived, never dialled on
 * its own.
 *
 * It does NOT need to stay under the scroller's claim threshold the way ACTIVATE does. Failing late
 * costs nothing: by then the scroller has the touch anyway, which is the outcome failing asks for.
 */
const BACK_FAIL_PX = Math.round(BACK_ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);

/**
 * ── EVERY callback on this pan needs an explicit `'worklet'` directive ──────────────────────────
 *
 * Not style, and not optional. Reanimated's Babel plugin auto-workletizes gesture callbacks only
 * when it can see the chain is a gesture, and its test is literal:
 *
 *     isGestureObject(exp) → exp.callee.object.name === 'Gesture'
 *
 * A chain rooted at `Gesture.Pan()` qualifies. A chain rooted at a FACTORY CALL — `backSwipePan(tag)`,
 * or the local `pan` below — does not, and the plugin silently leaves those callbacks as ordinary
 * functions. RNGH then sees `isWorklet` false and takes the whole gesture off the UI thread:
 *
 *     get shouldUseReanimated() { return ... && !this.handlers.isWorklet.includes(false) && ...; }
 *
 * One un-workletized callback demotes the ENTIRE gesture. What follows is not subtle: every handler
 * runs on the JS thread at touch frequency, and every shared-value read inside one becomes a
 * blocking `runOnUISync` round-trip to the UI thread. A device profile caught 131ms of exactly that
 * under `onGestureHandlerEvent`. It also explains the stale-latch mystery this file's callers spent
 * a while working around: on the JS thread a `.set()` schedules the UI write asynchronously, so
 * reading the value back in the same callback fetches the UI thread's older copy.
 *
 * So: extracting a shared factory for these gestures — which is the whole point of this module —
 * costs the automatic workletization, and the directives buy it back. Add one to any callback added
 * here or at a call site.
 */

/**
 * A pan wired with the criteria above. The caller supplies everything that happens AFTER — what a
 * back-swipe drives differs completely between surfaces (one runs a zoom collapse, another slides
 * a card out) while what STARTS one must not.
 *
 * `tag` names this copy in the gesture trace (Settings → Diagnostics → Gesture trace). It buys the
 * two questions that source alone can't answer: does this recognizer SEE the touches, and does it
 * reach BEGAN — i.e. whether a dead swipe died before the offsets were ever consulted, or because
 * they weren't satisfied. The observers are attached ONLY while the trace is recording: touch
 * callbacks flip RNGH's `needsPointerData`, and a probe that reconfigures the recognizer it is
 * measuring can't be trusted to be measuring the shipped one.
 */
export function backSwipePan(tag?: string): PanGesture {
  const pan = Gesture.Pan()
    .activeOffsetX(BACK_ACTIVATE_PX)
    .failOffsetX(-BACK_FAIL_PX)
    .failOffsetY([-BACK_FAIL_PX, BACK_FAIL_PX]);
  if (!tag || !isGestureTraceEnabled()) return pan;
  // Per-copy, like every other piece of per-copy state on these pans: the recipe is built more
  // than once and the copies must not share a touch origin or a throttle window.
  const downX = makeMutable(0);
  const downY = makeMutable(0);
  const moveGate = traceGate();
  return pan
    .onTouchesDown((e) => {
      'worklet';
      const t = e.allTouches[0];
      if (t) {
        downX.set(t.absoluteX);
        downY.set(t.absoluteY);
      }
      trace(tag, 'touch.down', { n: e.numberOfTouches });
    })
    .onTouchesMove((e) => {
      'worklet';
      const t = e.allTouches[0];
      if (!t) return;
      traceThrottled(moveGate, 60, tag, 'touch.move', {
        dx: t.absoluteX - downX.value,
        dy: t.absoluteY - downY.value,
      });
    })
    .onTouchesCancelled(() => {
      'worklet';
      trace(tag, 'touch.cancel');
    })
    .onBegin(() => {
      'worklet';
      trace(tag, 'BEGAN');
    });
}

/**
 * ── Horizontal scrollers keep their own turf ────────────────────────────────────────────────────
 *
 * The back-swipe activates at the same ten points a native scroller claims at, which is what makes
 * it reachable at all (see BACK_ACTIVATE_PX). The cost is that it now also beats HORIZONTAL
 * scrollers — the related-series rails — at their own game: a rightward drag on a rail dismissed the
 * page instead of scrolling the rail back, which makes the rails unusable.
 *
 * Lowering activation again isn't an option; that's the setting that made the gesture work. And the
 * two can't be told apart by geometry, because they ARE the same gesture — a rightward drag. The
 * only thing that distinguishes them is WHERE the finger landed, and the recognizer that knows that
 * is the rail's own.
 *
 * So the rail is given the right of first refusal. `useBackSwipeBlocker` hands a horizontal scroller
 * a native gesture declaring that the back-swipe must wait for it: land on a rail with somewhere to
 * scroll and the rail takes the drag, land anywhere else (or on a rail already at its end, whose
 * recognizer fails) and the back-swipe proceeds untouched. That is exactly how a nested scroll view
 * behaves inside a native pop gesture, and it needs no knowledge of rails here or of the back-swipe
 * there — only the ref that the two share through context.
 *
 * A surface with no back-swipe (the home feed's rails) reads a null context and gets nothing, so the
 * relation costs those nothing at all.
 *
 * The gesture OBJECT travels through the context, not a ref to it. RNGH accepts either, and the
 * object avoids handing a ref across a render boundary for something that is already a stable
 * memoized value on the providing side.
 */
export const BackSwipeGestureContext = createContext<GestureType | null>(null);

/** For a horizontal scroller nested inside a back-swipe surface: compose this onto it (or wrap it
 *  in a `GestureDetector`) and the back-swipe will wait for the scroller to fail first. Returns
 *  undefined where there is no back-swipe to yield to. */
export function useBackSwipeBlocker(): NativeGesture | undefined {
  const backSwipe = useContext(BackSwipeGestureContext);
  return useMemo(
    () => (backSwipe ? Gesture.Native().blocksExternalGesture(backSwipe) : undefined),
    [backSwipe],
  );
}

// Above every worklet that reads them: a worklet captures its closure where it is declared, and
// Hermes has no TDZ, so a const declared further down is silently `undefined` on the UI thread.
const SHAPE_UNDECIDED = 0;
const SHAPE_BACK_SWIPE = 1;
const SHAPE_NOT_BACK_SWIPE = -1;

/** The lock's verdict for one drag: undecided, a back-swipe, or not one. */
export type BackSwipeShape = SharedValue<number>;

/**
 * Was this drag a back-swipe? The lock's verdict when it reached one (see BACK_SWIPE_DEGREES);
 * the angle is not looked at again after that, however the stroke curls on the way to the release.
 *
 * A drag released before the lock distance never got a verdict — a tiny flick — and is judged here
 * on its endpoint or, failing that, on where it was headed (lib/gesture-release), since a flick that
 * short is all wobble and its velocity says more about its direction than its few points of travel.
 *
 * RNGH resets translation to zero the moment a pan activates (RNPanHandler.m, at the state change),
 * so `tx`/`ty` measure the drag from activation onward — the part that was on screen following the
 * finger.
 */
export function backSwipeStayedHorizontal(
  tx: number,
  ty: number,
  vx: number,
  vy: number,
  shape: BackSwipeShape,
): boolean {
  'worklet';
  if (shape.value !== SHAPE_UNDECIDED) return shape.value === SHAPE_BACK_SWIPE;
  if (Math.abs(ty) <= Math.abs(tx) * BACK_DOMINANCE) return true;
  const px = tx + projectRelease(vx);
  const py = ty + projectRelease(vy);
  return Math.abs(py) <= Math.abs(px) * BACK_DOMINANCE;
}

/** One per gesture copy, alongside its other shared values. */
export function backSwipeShape(): BackSwipeShape {
  return makeMutable(SHAPE_UNDECIDED);
}

/** Call from `onStart` — translation is measured per drag, so the verdict is too. */
export function resetBackSwipeShape(shape: BackSwipeShape): void {
  'worklet';
  shape.set(SHAPE_UNDECIDED);
}

/** Call from `onUpdate`: decides the verdict on the first sample past the lock distance. */
export function trackBackSwipeShape(shape: BackSwipeShape, tx: number, ty: number): void {
  'worklet';
  if (shape.value !== SHAPE_UNDECIDED || Math.hypot(tx, ty) < BACK_SWIPE_LOCK_PX) return;
  shape.set(tx > 0 && Math.abs(ty) <= tx * BACK_DOMINANCE ? SHAPE_BACK_SWIPE : SHAPE_NOT_BACK_SWIPE);
}
