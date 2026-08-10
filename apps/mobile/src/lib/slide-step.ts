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
 *   Only `MAX_SCROLL_UNMEASURED` skips the guard — a measured 0 is a real answer (see it).
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
/**
 * The `maxScrollY` a caller passes before it has measured the content — "no answer yet", distinct
 * from the perfectly good answer 0.
 *
 * They used to be the same value, and that is what let the bars react to a *stretch*: on a screen
 * whose content fits the viewport there is nothing to scroll, only the elastic bounce, and
 * `contentHeight − viewportHeight ≤ 0` read as "unmeasured ⇒ no bounce guard". So dragging up on a
 * short screen (or on any list at rest with nothing below it) reported a rising offset, the bars
 * accumulated it as real scroll, and the chrome slid away under a gesture that never moved the
 * content at all. With 0 taken literally, every offset on such a screen is ≥ maxScrollY — i.e. all
 * overscroll — and the bars hold perfectly still.
 */
export const MAX_SCROLL_UNMEASURED = -1;
/** The two ways a scroll step carries no gesture intent: a reposition-sized jump (above), and the
 *  elastic bottom bounce, whose springback produces the same deltas a real scroll-up does. */
function stepRejected(y: number, prevY: number, maxScrollY: number): boolean {
  'worklet';
  return Math.abs(y - prevY) > MAX_GESTURE_STEP || (maxScrollY >= 0 && y >= maxScrollY);
}
/**
 * The furthest a bar can be hidden at scroll offset `y`: it cannot have travelled further from its
 * resting place than the content itself has. Within the first `span` px of scroll that ties the bar
 * to the content, so it arrives fully shown exactly as the list reaches the top — "pinned at the
 * top" stops being a separate rule that has to fire and becomes something the position can't
 * violate.
 *
 * The bug this fixes: the top pin used to be a hard `y <= topGuard ⇒ hidden = 0` snap. That was
 * invisible while the bars tracked scroll 1:1 in both directions — approaching the top they were
 * already almost fully in, so the snap covered a pixel or two. Commit-on-release changed that: an
 * unearned reveal snaps a bar back to FULLY hidden, which it can now be while the list sits a few px
 * from the top. Crossing the guard then flung a 60-82px bar open in a single frame off a 5px scroll,
 * most visibly right as a settle finished.
 */
export function hideCeiling(y: number, span: number): number {
  'worklet';
  return Math.min(span, Math.max(0, y));
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
  const ceiling = hideCeiling(y, span);
  // A rejected step still can't leave the bar further out than the content allows — a reposition
  // that lands near the top must not park it off-screen up there until the next real frame.
  if (stepRejected(y, prevY, maxScrollY)) return Math.min(hidden, ceiling);
  return Math.min(ceiling, Math.max(0, hidden + (y - prevY)));
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
 * How long a bar takes to slide to its committed state once the gesture ends, and the curve it takes
 * getting there. Here rather than in each hook for the same reason `COMMIT_DISTANCE` is: the bars
 * move together or they look broken — and they had already drifted. All three agreed on 200ms and
 * nothing else: the tab bar hand-rolled this ease-out, the web fade used CSS `ease` over 320ms, and
 * the top bar passed no `easing` at all, so it took Reanimated's default `Easing.inOut(Easing.quad)`.
 * An ease-IN start is nearly motionless for its first frames, which is what made a released drag look
 * like it paused before the bar moved.
 *
 * Ease-out is the curve a gesture hand-off wants: the bar leaves at the speed the finger left it and
 * decelerates into place, so the settle reads as the end of the drag rather than a separate animation
 * that had to spin up. That's most of why this feels quicker — the duration cut is the rest.
 */
export const SETTLE_MS = 140;

/** The settle curve — cubic ease-out. A worklet so the top bar can hand it straight to `withTiming`
 *  on the UI thread, while the tab bar's rAF tween calls it as an ordinary function on the JS one.
 *  The web fade can't take a function at all and repeats it as a `cubic-bezier` — see app-tabs. */
export function settleEase(t: number): number {
  'worklet';
  return 1 - (1 - t) ** 3;
}

/**
 * How far the CONTENT must have scrolled before letting go can leave the chrome hidden. Under it a
 * release bounces every bar back fully shown; past it a release commits them fully away.
 *
 * ONE number for every bar, for exactly the reason `COMMIT_DISTANCE` is one number — and this is the
 * threshold that had escaped that rule. Each bar used its OWN span here (the top bar's 60, the tab
 * bar's measured ~56–90 depending on the home indicator, and a third copy in app-tabs' web fade,
 * which read `getTabBarHideOffset()` directly), so scrolling down through the band between them and
 * letting go dismissed one bar and bounced the other back — the two disagreeing about the same
 * gesture, on a threshold that belonged to neither of them.
 *
 * Set clear of every bar's span (top 60, or 64 on desktop; tab bar ~56 with no bottom inset, ~82–90
 * with one) so the same scroll depth decides both on every device. `dismissThreshold` still floors it
 * at the bar's own span, so this can't be tuned DOWN into the pop that `hideCeiling` exists to
 * prevent: a bar committed further out than the content has scrolled snaps back to the ceiling on the
 * very next report.
 */
export const DISMISS_DISTANCE = 96;

/** The dismissal threshold for a bar of `span` px — the shared distance, never less than the bar's
 *  own height (see `DISMISS_DISTANCE`). */
export function dismissThreshold(span: number): number {
  'worklet';
  return Math.max(span, DISMISS_DISTANCE);
}

/**
 * At or above this offset the content is resting at the top (or being pulled past it), and every bar
 * is pinned fully shown. Shared for the same reason as everything else here: it was a `const
 * TOP_GUARD = 8` copied into the tab-bar hook and app-tabs, and simply missing for the top bar, which
 * passed no guard at all and so ran with 0.
 */
export const TOP_GUARD = 8;

/**
 * Where a DISMISSAL settles to at scroll offset `y` — all the way out, or all the way back in.
 *
 * `hideCeiling` caps how far a bar can be hidden by how far the content has scrolled, which is right
 * while the finger is down (that's the 1:1 tracking) but wrong as a resting place: nearer the top
 * than the bar's own height there is no room to hide, so committing to "the ceiling" parked the bar
 * half-way — visible, clipped, and not really usable, with no gesture able to explain the position.
 * A small scroll down from the top hit this every time.
 *
 * So a dismissal only commits once the content has carried it past `dismissThreshold`; otherwise the
 * bar goes back where it came from.
 *
 * Only the RESTING position is decided here. Tracking under the finger still follows the ceiling, so
 * the bar moves with a scroll of any size; it's the release that snaps the decision to one end.
 */
export function dismissTarget(y: number, span: number): number {
  'worklet';
  return y < dismissThreshold(span) ? 0 : span;
}

/**
 * Whether a dismissal decided when the finger lifted should be acted on NOW, or held until the
 * scrolling actually stops.
 *
 * `dismissTarget` reads the offset at the instant it's asked, and at `release` that instant is the
 * start of a fling, not the end of one. A flick from the top lifts the finger after ~40px while
 * momentum carries the list hundreds more: asked then, the answer is "bounce back", so both bars
 * snapped fully in, momentum tracked them straight back out, and `rest` finally dismissed them —
 * out, in, out, gone. Two visible jiggles before the chrome went away.
 *
 * So a dismissal only commits early when it's committing to HIDDEN, which momentum can't invalidate
 * (the content is already past the threshold and only moving further). A "bounce back" waits for
 * `rest`, by which point the offset is the one the user actually landed on. Nothing is frozen in the
 * meantime — the bars keep tracking the content 1:1 through the fling, which is what makes the wait
 * invisible rather than a pause.
 *
 * The earned REVEAL still fires at release, untouched: that one is about the gesture, not the
 * offset, so waiting would just make asking for the chrome back feel slow.
 */
export function dismissesNow(hideTo: number, atRest: boolean): boolean {
  'worklet';
  return hideTo > 0 || atRest;
}

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
 * all the way hidden (`dismissTarget`). Carried in/out rather than owned here so this stays a pure
 * function usable from both threads — the top bar keeps it in a shared value, the tab bar in a ref.
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
