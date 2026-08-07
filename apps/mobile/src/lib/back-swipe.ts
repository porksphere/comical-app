import { Gesture, type PanGesture } from 'react-native-gesture-handler';

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
 * If the cone is worth another attempt it needs a different mechanism — a native recogniser that
 * understands direction — not a fourth pass at this one.
 */

/** Rightward travel that activates the back-swipe. */
export const BACK_ACTIVATE_PX = 24;
/**
 * Vertical travel (or leftward travel) that gives the drag up instead.
 *
 * Deliberately close to ACTIVATE rather than far below it. Much lower and it becomes what the old
 * rig effectively was — a gesture that loses to any wobble, since the opening millimetres of a real
 * swipe wander in both axes. Much higher and a genuine scroll gets stolen. Just under ACTIVATE
 * means a drag has to commit more travel rightward than it spends drifting, without having to be
 * geometrically straight.
 */
export const BACK_FAIL_PX = 18;

/**
 * A pan wired with the criteria above. The caller supplies everything that happens AFTER — what a
 * back-swipe drives differs completely between surfaces (one runs a zoom collapse, another slides
 * a card out) while what STARTS one must not.
 */
export function backSwipePan(): PanGesture {
  return Gesture.Pan()
    .activeOffsetX(BACK_ACTIVATE_PX)
    .failOffsetX(-BACK_FAIL_PX)
    .failOffsetY([-BACK_FAIL_PX, BACK_FAIL_PX]);
}
