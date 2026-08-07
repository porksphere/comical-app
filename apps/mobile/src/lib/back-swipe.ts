import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';

/**
 * The app's hand-rolled back-swipe: what counts as one, in one place.
 *
 * Several surfaces need it — the series page's details (which drives the gallery collapse) and the
 * in-screen search layer (which slides out like a pushed card) — and none of them can use the real
 * thing. A contained transparent modal has no native pop gesture, and neither does a sibling view
 * pretending to be a screen. So each rig recreates it, and the ONE part that must not drift between
 * them is the activation test: if the same drag opens one surface and dies on another, the app
 * stops feeling like it has a back-swipe at all and starts feeling like it has several.
 *
 * ── Why manual activation ────────────────────────────────────────────────────
 * RNGH's declarative bounds can only express ABSOLUTE budgets — `activeOffsetX(24)` with
 * `failOffsetY([-12, 12])` means "24px across, but die if you ever drift 12px down". A real thumb
 * arc drifts more than that on the way, so those bounds reject ordinary human swipes while
 * accepting slow diagonal ones that happen to creep across the x line first. The test that matches
 * intent is a RATIO — how much more horizontal than vertical the travel is — and a ratio needs the
 * raw touch stream, which is what `manualActivation` gives.
 *
 * ── Why these numbers, and the trap they replaced ────────────────────────────
 * The two tests are SYMMETRIC — same distance, same ratio, opposite axes — and that symmetry is
 * load-bearing. An earlier version was deliberately asymmetric: activate at 24px on a strict ratio,
 * but fail the moment vertical travel passed 12px while merely exceeding horizontal. The reasoning
 * was that a scroll should be handed back instantly without making the list wait. The flaw is that
 * `|dy| > |dx|` is TRIVIALLY TRUE at the start of almost any gesture — at dx ≈ 0 any vertical at all
 * satisfies it — so a swipe that began with the finger settling a dozen pixels downward, which is
 * most swipes on a list that is already scrolling, was killed before its horizontal movement had
 * even begun. It didn't read as strict, it read as the gesture randomly not working.
 *
 * So failing now requires travel that is CLEARLY vertical — past the same distance, and dominant by
 * the same ratio. Early noise cannot satisfy that, while a real scroll satisfies it almost at once.
 *
 * DOMINANCE stays forgiving (2 ≈ within 27° of horizontal) for a reason beyond taste: activation has
 * to happen before the scroll view underneath commits to its own gesture, and on iOS a scroll that
 * has started does not hand the touch back. Tightening this to 3 pushed activation later and let the
 * scroller win first — which is how "require more horizontal than diagonal" turned into "the swipe
 * doesn't fire". The strictness lives in the fail side instead: anything between the two cones is
 * neither, and is given up on at BACK_DECIDE_PX rather than being awarded to either.
 */

/** Travel along an axis before that axis is allowed to decide anything. */
export const BACK_ACTIVATE_PX = 24;
/** The mirror of it: vertical travel before a drag may be called a scroll. Same distance on purpose. */
export const BACK_FAIL_PX = 24;
/** How many times one axis must exceed the other. 2 ≈ within 27° of that axis. */
export const BACK_DOMINANCE = 2;
/**
 * Total travel after which a drag belonging to NEITHER cone is given up on rather than left pending.
 *
 * With two dominance cones there is a band between them — roughly 27° to 63° — that satisfies
 * neither test. Without this bar such a drag stays undecided for as long as the finger moves, and
 * since activation is manual that means the gesture never fires AND never cleanly releases the
 * touch. Diagonal drags land here by design: they are not a back-swipe, and giving up is how the
 * scroller gets them.
 *
 * Generous, because it is only reached by drags that are genuinely ambiguous — a real swipe or a
 * real scroll has been decided long before.
 */
export const BACK_DECIDE_PX = 64;

/** 1 = this is a back-swipe, -1 = it belongs to something else, 0 = not enough travel to say. */
export type BackSwipeVerdict = 1 | -1 | 0;

/**
 * The decision, as a pure worklet — the single definition of "is this a back-swipe", given the
 * travel since the finger went down. `dx` is signed (rightward positive); `dy` need not be.
 */
export function decideBackSwipe(dx: number, dy: number): BackSwipeVerdict {
  'worklet';
  const ay = Math.abs(dy);
  // Dominantly rightward — ours.
  if (dx > BACK_ACTIVATE_PX && dx > ay * BACK_DOMINANCE) return 1;
  // Dominantly vertical (the list is scrolling), or meaningfully leftward, which is never this.
  if ((ay > BACK_FAIL_PX && ay > dx * BACK_DOMINANCE) || dx < -BACK_FAIL_PX) return -1;
  // Neither cone, and far enough along to say so — see BACK_DECIDE_PX.
  if (Math.hypot(dx, ay) > BACK_DECIDE_PX) return -1;
  return 0;
}

/**
 * Wire `decideBackSwipe` onto a pan: manual activation, the touch-down origin, and the per-gesture
 * verdict. The caller supplies everything that comes after — `onStart`/`onUpdate`/`onEnd` are its
 * own, because what a back-swipe DRIVES differs completely between surfaces (one runs a zoom
 * collapse, another slides a card out) while what STARTS one must not.
 *
 * The shared values are created per call, not per module: a rig typically builds this recipe TWICE
 * (once at screen level, once composed onto a scroller — see the call sites), and the two copies
 * see the same touch stream. Sharing the origin between them would have each overwrite the other's.
 *
 * `canStart`, when given, must be a worklet: it is consulted on the first meaningful movement and
 * fails the gesture outright, for a surface that is only swipeable in some of its states.
 */
export function withBackSwipeActivation(pan: PanGesture, canStart?: () => boolean): PanGesture {
  const startX = makeMutable(0);
  const startY = makeMutable(0);
  const verdict = makeMutable<BackSwipeVerdict>(0);
  return pan
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (!t) return;
      startX.set(t.absoluteX);
      startY.set(t.absoluteY);
      verdict.set(0);
    })
    .onTouchesMove((e, manager) => {
      if (verdict.value !== 0) return;
      const t = e.allTouches[0];
      if (!t) return;
      if (canStart && !canStart()) {
        verdict.set(-1);
        manager.fail();
        return;
      }
      const decision = decideBackSwipe(t.absoluteX - startX.value, t.absoluteY - startY.value);
      if (decision === 1) {
        verdict.set(1);
        manager.activate();
      } else if (decision === -1) {
        verdict.set(-1);
        manager.fail();
      }
    });
}

/** A fresh pan already wired with the activation above — the usual entry point. */
export function backSwipePan(canStart?: () => boolean): PanGesture {
  return withBackSwipeActivation(Gesture.Pan(), canStart);
}
