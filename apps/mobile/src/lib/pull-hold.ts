/**
 * How far to hold a list's content down while a pull-to-refresh spinner is still up (iOS).
 *
 * Plain arithmetic in its own module — no Reanimated — so the rule is unit-testable, the same split
 * (and for the same reason) as `slide-step` next to the bars that run it. `useNativePullToRefresh`
 * is the only caller; it evaluates this in a `useDerivedValue` worklet every frame.
 *
 * The shape of the thing: on iOS the gap comes from the native bounce, which recoils the instant the
 * finger lifts, so to keep the content down while the request runs we translate the list ourselves
 * and cancel the recoil frame by frame. `scrollY` is the list's live offset — NEGATIVE while
 * overscrolled past the top, which is the half this cancels.
 *
 * Clamping to that negative half is the whole subtlety, and getting it wrong is a real bug rather
 * than a rounding detail: `holdOffset + scrollY` unclamped keeps adding a scroll AWAY from the top
 * to the hold, so swiping up while the spinner is still spinning translates the list down by however
 * far you scrolled — off the bottom of the screen, with a growing band of bare screen background
 * above it, springing away when the refresh lands.
 */
export function pullHoldTranslate(holding: boolean, holdOffset: number, scrollY: number): number {
  'worklet';
  // Not holding = during the pull itself, where the native bounce is already moving the content and
  // translating on top of it would double the movement.
  if (!holding) return 0;
  return holdOffset + Math.min(0, scrollY);
}
