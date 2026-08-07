/**
 * Where a released gesture is HEADED — the one rule every "did they mean it?" decision in the app
 * should be asking.
 *
 * The obvious rule, and the one this replaced everywhere, is a pair of independent tests: commit
 * past some fraction of the travel OR above some velocity. That reads as reasonable and feels
 * wrong, because it is a CLIFF. Below the velocity bar, speed contributes exactly nothing — so a
 * fast, short throw is rejected outright while a slow crawl that happened to cover more ground
 * succeeds. Users describe the result as "no momentum, it just snaps back", which is precisely
 * what it is.
 *
 * Apple's answer, from WWDC 2018's "Designing Fluid Interfaces" — the talk about how their own
 * system gestures work — is to PROJECT: ask where the thing would come to rest if you let go now,
 * and decide on that. Distance and speed stop being two tests and become one quantity. That method
 * is the part worth taking, and it is why a small quick flick pops a UIKit navigation stack while a
 * long slow drag that stalls does not.
 *
 * ── The horizon, and why it is 0.3 and not 0.5 ──────────────────────────────────────────────────
 * The method needs a time to project over, and this file used to derive one from Apple's formula,
 *
 *     project(v) = (v / 1000) * rate / (1 - rate)
 *
 * which at `UIScrollView.DecelerationRate.normal` (0.998) works out to ~0.499s. That derivation is
 * sound for what it describes — where a SCROLL coasting to a stop under that deceleration would
 * land — and this file wrongly treated it as the answer for a different question, calling
 * react-navigation's 0.3 "hand-picked" by comparison.
 *
 * A dismissal is not a scroll coasting to rest. It is a stack pop, and the shipping implementation
 * of that on iOS is `react-native-screens`' full-screen swipe (RNSScreenStack.mm, handleSwipe),
 * which drives a real UIKit percent-driven transition and decides with:
 *
 *     gestureDistance = translation + velocity * 0.3;
 *     shouldFinishTransition = gestureDistance > distance / 2;
 *
 * — the same shape, over 0.3s, cross-referenced in its own comment to react-navigation's Card.tsx.
 * Two independent implementations of this exact gesture agree on 0.3, and Apple's own pop rule is
 * private (`_UINavigationInteractiveTransition` is undocumented; nobody outside Apple has its
 * finish/cancel logic), so 0.3 is as close to "what iOS does here" as anything observable.
 *
 * The difference is not cosmetic: at 1000 pt/s, 0.499 projects 499 points where 0.3 projects 300.
 * Running long meant a quick flick that had barely moved committed anyway, which reads as a page
 * that dismisses when you didn't ask it to.
 */

/**
 * Seconds of travel a release is projected along its own velocity.
 *
 * Matches react-native-screens and react-navigation for the stack-pop decision — see above, and
 * note this is deliberately NOT the UIScrollView deceleration projection, which answers a
 * different question and runs ~0.5s.
 */
const PROJECTION_SECONDS = 0.3;

/** How much further a release carries, in points, given its velocity in points/second. */
function projectRelease(velocity: number): number {
  'worklet';
  return velocity * PROJECTION_SECONDS;
}

/**
 * Did this release commit? `translation` and `velocity` are along the gesture's axis, positive in
 * the committing direction; `threshold` is the distance past which the gesture counts as done.
 *
 * Self-correcting in the direction that matters: drag most of the way and then flick BACK at the
 * moment you let go, and the projected endpoint falls behind the threshold — which is a person
 * changing their mind, and is what should happen. That case is exactly what an `OR raw > threshold`
 * fallback would break, which is why there isn't one.
 */
export function releaseCommitted(translation: number, velocity: number, threshold: number): boolean {
  'worklet';
  return translation + projectRelease(velocity) > threshold;
}

/**
 * The same decision for a gesture that commits in EITHER direction (a page that can be thrown off
 * any side). Judged along the direction it actually travelled, so a flick back still cancels
 * rather than being read as commitment the other way.
 */
export function releaseCommittedEitherWay(offset: number, velocity: number, threshold: number): boolean {
  'worklet';
  const direction = offset < 0 ? -1 : 1;
  return releaseCommitted(offset * direction, velocity * direction, threshold);
}
