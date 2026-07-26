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
 * - Past the content end (y ≥ maxScrollY) the list is in — or springing back out of — its elastic
 *   bottom bounce, which produces the same "offset decreasing" deltas a real scroll-up does.
 *   Hold still instead of revealing, or every bottom overscroll would slide the chrome back in.
 *   An unknown/unmeasured maxScrollY (≤ 0) skips the guard.
 *
 * Returns the next hidden-px value (0 = fully shown, `span` = fully hidden).
 */
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
  if (maxScrollY > 0 && y >= maxScrollY) return hidden;
  return Math.min(span, Math.max(0, hidden + (y - prevY)));
}
