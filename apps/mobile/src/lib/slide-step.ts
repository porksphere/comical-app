/**
 * The single scroll→slide rule every auto-hiding bar follows: chrome hides by accumulating
 * downward-scroll pixels and reveals by accumulating upward ones, clamped to [0, span] — 1:1
 * X/Twitter-style tracking, not a threshold flip. Shared by the top bar (`useSlidingBar`, driven
 * on the UI thread inside an animated reaction) and the bottom tab bar (`useHideTabBarOnScroll`,
 * driven on the JS thread because expo-router's TabList only takes a plain style — see app-tabs).
 * The 'worklet' directive is what lets ONE function serve both: it remains an ordinary function on
 * the JS thread while staying transferable into the top bar's worklet. Before this the two hooks
 * each hand-rolled the same rule, and they drifted (the tab bar shipped without the bounce guard
 * for a while — see its comment history).
 *
 * Guards, in order:
 * - At/above `topGuard` (resting at the top, or an active pull/overscroll reporting negative y):
 *   snap fully shown.
 * - A step larger than `MAX_GESTURE_STEP` is a reposition, not a scroll — see that constant.
 * - Past the content end (y ≥ maxScrollY) the list is in — or springing back out of — its elastic
 *   bottom bounce, which produces the same "offset decreasing" deltas a real scroll-up does.
 *   Hold still instead of revealing, or every bottom overscroll would slide the chrome back in.
 *   An unknown/unmeasured maxScrollY (≤ 0) skips the guard.
 *
 * Returns the next hidden-px value (0 = fully shown, `span` = fully hidden).
 */
// How far one scroll report can plausibly move under a finger. Even a hard fling only travels
// ~130px between frames at 60Hz (~66px at 120Hz), so this leaves generous headroom while still
// rejecting the jumps that carry no gesture intent at all: a list landing mid-content on a fresh
// mount, a programmatic `scrollToOffset`, an estimate/header size correction, or `useSlidingBar`'s
// scope reset zeroing `scrollY` while the list actually sits elsewhere. Accumulating one of those
// slid BOTH bars their full span in a single frame and left them there for good — on Android CI,
// Browse cold-started with no tab bar and no top bar at all, with the feed resting ~780px down
// (`tab.browse` absent from the view hierarchy; caught by e2e/mobile/swipe-dismiss, which then
// took 10 more flows down with it). Holding still re-baselines for free: the caller's `prevY`
// advances either way, so the next genuine frame measures from wherever the list ended up.
//
// The cost of the guard misfiring is a bar that fails to hide for one frame of an unusually janky
// fling — visible only as the hide starting a frame late, and self-correcting on the next report.
const MAX_GESTURE_STEP = 240;
/** The two ways a scroll step carries no gesture intent: a reposition-sized jump (above), and the
 *  elastic bottom bounce, whose springback produces the same deltas a real scroll-up does. */
function stepRejected(y: number, prevY: number, maxScrollY: number): boolean {
  'worklet';
  return Math.abs(y - prevY) > MAX_GESTURE_STEP || (maxScrollY > 0 && y >= maxScrollY);
}
export function slideStep(
  hidden: number,
  y: number,
  prevY: number,
  maxScrollY: number,
  span: number,
  topGuard = 0,
): number {
  'worklet';
  if (y <= topGuard) return 0;
  if (stepRejected(y, prevY, maxScrollY)) return hidden;
  return Math.min(span, Math.max(0, hidden + (y - prevY)));
}

/**
 * Upward scroll (in one gesture) that locks a bar back in. Deliberately ONE number for every bar
 * rather than "however far this particular bar travels": the top bar's span is its content height
 * (60) and the tab bar's is its measured height (~82), so per-bar thresholds meant the top bar stuck
 * while the tab bar, given the identical flick, slid straight back out — the two disagreeing about
 * the same gesture, which is what it looked like.
 *
 * Set just UNDER the shortest bar's span so no bar can sit fully extended yet uncommitted (releasing
 * there would yank back a bar that already looks all the way out, for no reason a user can see). The
 * taller tab bar locks in with a little travel left and finishes it in the settle.
 */
export const COMMIT_DISTANCE = 56;

/**
 * `slideStep` plus the bookkeeping for the commit-on-release rule the bars actually ship: both
 * directions track the finger 1:1, and letting go finishes the job in whichever direction the
 * gesture earned.
 *
 * `up` is that earning: upward px accumulated within the current gesture, capped at (and so read as
 * committed at) `COMMIT_DISTANCE`. Any downward scroll spends it back to zero — which is what makes
 * a dismissal cheap, in line with how the bars are used: you flick down to get the chrome out of the
 * way constantly, and ask for it back deliberately. At the top it saturates, since a bar pinned
 * fully shown has nothing left to earn.
 *
 * The caller settles on it when the gesture ends: `up >= COMMIT_DISTANCE` ⇒ all the way shown, else
 * all the way hidden. Carried in/out rather than owned here so this stays a pure function usable
 * from both threads — the top bar keeps it in a shared value, the tab bar in a ref.
 */
export function settleStep(
  hidden: number,
  up: number,
  y: number,
  prevY: number,
  maxScrollY: number,
  span: number,
  topGuard = 0,
): { hidden: number; up: number } {
  'worklet';
  const next = slideStep(hidden, y, prevY, maxScrollY, span, topGuard);
  if (y <= topGuard) return { hidden: next, up: COMMIT_DISTANCE };
  // A step with no gesture intent moves neither the bar nor the credit.
  if (stepRejected(y, prevY, maxScrollY)) return { hidden: next, up };
  const dy = y - prevY;
  return { hidden: next, up: dy > 0 ? 0 : Math.min(COMMIT_DISTANCE, up - dy) };
}
