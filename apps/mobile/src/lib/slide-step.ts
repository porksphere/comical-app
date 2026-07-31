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
  if (Math.abs(y - prevY) > MAX_GESTURE_STEP) return hidden;
  if (maxScrollY > 0 && y >= maxScrollY) return hidden;
  return Math.min(span, Math.max(0, hidden + (y - prevY)));
}

/**
 * `slideStep` plus the commit-on-release rule the bars actually ship: a state only sticks when the
 * gesture ENDS, so nothing half-done survives letting go.
 *
 * - **Hiding never starts under the finger.** A fully-shown bar holds still on downward scroll and
 *   only raises `pending`; the caller slides it away on `release` (see `scroll-release`). Before
 *   this, a few px of downward scroll immediately shaved a few px off the bar, which read as the
 *   chrome twitching at every direction change.
 * - **Revealing tracks the finger, but only a FULL reveal is committed.** Upward scroll gives the
 *   bar back 1:1 (so it feels attached to the gesture), and symmetrically a partial reveal gives
 *   ground 1:1 to a downward one — neither was ever committed. The caller drops anything still
 *   part-way at `rest`, so a stingy flick doesn't leave a bar hanging half-on-screen.
 *
 * `pending` is carried in/out rather than owned here so this stays a pure function usable from both
 * threads: the top bar keeps it in a shared value, the tab bar in a ref.
 */
export function settleStep(
  hidden: number,
  pending: boolean,
  y: number,
  prevY: number,
  maxScrollY: number,
  span: number,
  topGuard = 0,
): { hidden: number; pending: boolean } {
  'worklet';
  const next = slideStep(hidden, y, prevY, maxScrollY, span, topGuard);
  // Revealing (including the snap to fully-shown at the top): track it, and drop any pending hide —
  // the user has changed their mind mid-gesture.
  if (next < hidden) return { hidden: next, pending: false };
  // Hiding. A fully-shown bar is only MARKED; a partial reveal gives its ground back immediately.
  if (next > hidden) return { hidden: hidden === 0 ? hidden : next, pending: true };
  // No movement, so the intent has to be read off the raw step. Three ways to get here:
  // pinned at the top (nothing to commit), a guard rejecting the step (unknown intent — leave
  // `pending` exactly as it was), or an already-fully-shown bar clamping an upward step to 0 — which
  // is still the user asking for the chrome, so a hide marked earlier in the same gesture is off.
  if (y <= topGuard) return { hidden: 0, pending: false };
  if (y < prevY && Math.abs(y - prevY) <= MAX_GESTURE_STEP && (maxScrollY <= 0 || y < maxScrollY)) {
    return { hidden, pending: false };
  }
  return { hidden, pending };
}
