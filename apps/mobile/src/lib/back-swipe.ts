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
 * ── Why these numbers ────────────────────────────────────────────────────────
 * DOMINANCE is the angle: 3 admits anything within ~18° of horizontal. It was 2 (~27°), which read
 * as too lenient on device — a lazy diagonal that was really a scroll would take the page with it.
 * Raising it costs nothing for a deliberate swipe, which is far straighter than 18°.
 *
 * ACTIVATE and FAIL are deliberately ASYMMETRIC, and that asymmetry is the whole trick. Deciding at
 * the first sample that clears a low bar is what made the old rig feel loose: the first few points
 * of any gesture are noise, and whichever axis wins there is close to random. So the horizontal bar
 * is high enough to be past the noise (24px), while the vertical one is low (12px) — a drag that
 * sets off downward is a scroll and should be handed back immediately, without making the scroller
 * wait 24px for its own gesture. Undecided until one of them trips.
 */

/** Horizontal travel needed before a drag is a back-swipe. */
export const BACK_ACTIVATE_PX = 24;
/** Vertical travel (or backwards travel) that hands the gesture back instead. */
export const BACK_FAIL_PX = 12;
/** How many times more horizontal than vertical the travel must be. 3 ≈ within 18° of horizontal. */
export const BACK_DOMINANCE = 3;
/**
 * Rightward travel after which an undominant drag is GIVEN UP ON rather than left pending.
 *
 * Without this the test has a band it can never decide. `ay > FAIL && ay > dx` only catches drags
 * that are more vertical than horizontal, so a drag between the dominance angle and 45° satisfies
 * NEITHER branch — not straight enough to activate, not steep enough to fail — and stays pending
 * for as long as the finger moves. The gesture then does nothing at all: it never activates, and
 * because activation is manual it never cleanly hands the touch back either.
 *
 * That band is exactly the swipe a person actually makes, and raising DOMINANCE from 2 widened it
 * from 27°–45° to 18°–45°, which is what made the back-swipe "inconsistent" — not stricter, but
 * silently dead over a third of the angles. Comfortably above ACTIVATE so a true horizontal swipe
 * has always won by the time it is consulted.
 */
export const BACK_DECIDE_PX = 48;

/** 1 = this is a back-swipe, -1 = it belongs to something else, 0 = not enough travel to say. */
export type BackSwipeVerdict = 1 | -1 | 0;

/**
 * The decision, as a pure worklet — the single definition of "is this a back-swipe", given the
 * travel since the finger went down. `dx` is signed (rightward positive); `dy` need not be.
 */
export function decideBackSwipe(dx: number, dy: number): BackSwipeVerdict {
  'worklet';
  const ay = Math.abs(dy);
  if (dx > BACK_ACTIVATE_PX && dx > ay * BACK_DOMINANCE) return 1;
  // Vertical intent (the list underneath is scrolling), or a leftward drag, which is never this.
  if ((ay > BACK_FAIL_PX && ay > dx) || dx < -BACK_FAIL_PX) return -1;
  // Gone far enough right to have shown its intent, and that intent is not dominantly horizontal.
  // Hand it back rather than leaving it pending forever — see BACK_DECIDE_PX.
  if (dx > BACK_DECIDE_PX) return -1;
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
