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
 * and decide on that. Distance and speed stop being two tests and become one quantity.
 *
 *     project(v) = (v / 1000) * rate / (1 - rate)
 *
 * with `rate` the UIScrollView deceleration constant. That is the whole of it, and it is why a
 * small quick flick from the edge pops a UIKit navigation stack while a long slow drag that stalls
 * does not.
 *
 * (Apple's own pop logic is private — `_UINavigationInteractiveTransition` is not documented and
 * nobody outside Apple has its finish/cancel rule. This is their published method rather than
 * their shipped code. It is also NOT react-navigation's constant: that library projects over 0.3s,
 * a hand-picked number, where the normal deceleration rate works out to ~0.5s. We match Apple.)
 */

/** `UIScrollView.DecelerationRate.normal`. `.fast` is 0.99 — much stingier, wrong for a page. */
export const DECELERATION_RATE = 0.998;

/** Seconds of travel a release is projected along its own velocity. ~0.499 at the rate above. */
export const PROJECTION_SECONDS = DECELERATION_RATE / (1 - DECELERATION_RATE) / 1000;

/** How much further a release carries, in points, given its velocity in points/second. */
export function projectRelease(velocity: number): number {
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
