import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';

import { isGestureTraceEnabled, trace, traceGate, traceThrottled } from '@/lib/gesture-trace';

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
export const BACK_ACTIVATE_PX = 10;
/**
 * Vertical travel (or leftward travel) that gives the drag up instead.
 *
 * Sits just ABOVE activation, which is the whole of the horizontal-dominance rule now: a drag wins
 * by reaching 10 rightward before it has spent 12 vertically, so anything steeper than about 50°
 * goes to the scroller. It cannot be pulled much tighter without losing honest swipes — the opening
 * millimetres of a real one wander in both axes, and at these distances the wander is most of the
 * measurement. It cannot be pushed much looser without stealing scrolls.
 *
 * Note it does NOT need to stay under the scroller's threshold the way ACTIVATE does. Failing late
 * costs nothing: by then the scroller has the touch anyway, which is the outcome failing asks for.
 */
export const BACK_FAIL_PX = 12;

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
      const t = e.allTouches[0];
      if (t) {
        downX.set(t.absoluteX);
        downY.set(t.absoluteY);
      }
      trace(tag, 'touch.down', { n: e.numberOfTouches });
    })
    .onTouchesMove((e) => {
      const t = e.allTouches[0];
      if (!t) return;
      traceThrottled(moveGate, 60, tag, 'touch.move', {
        dx: t.absoluteX - downX.value,
        dy: t.absoluteY - downY.value,
      });
    })
    .onTouchesCancelled(() => {
      trace(tag, 'touch.cancel');
    })
    .onBegin(() => {
      trace(tag, 'BEGAN');
    });
}
