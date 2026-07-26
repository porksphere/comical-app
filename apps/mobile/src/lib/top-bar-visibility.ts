/**
 * How far the focused screen's sliding top bar is currently slid up (px, 0 = fully shown). Note the
 * bar may DOCK rather than leave the screen: Browse's slides by its content height and keeps its
 * frosted strip over the status-bar inset, so at max slide the remaining chrome is `insets.top` tall
 * — which the consumer's `insets.top + barHeight - hidden` arithmetic already yields.
 * The mirror image of `tab-bar-visibility` for the bar at the other end of the screen, and reported
 * by the same hook that drives the slide (`useSlidingBar`).
 *
 * It exists because the long-press context menu is a ROOT overlay: it has to clip its flying cover to
 * the chrome that's actually on screen (see `series-card-context-menu`), but it sits outside the
 * navigator, so it can't see a screen's bar — let alone how far that bar has scrolled away. A plain
 * module value rather than a Legend State observable: nothing renders off it, it's read once, on
 * press, by code that isn't a component.
 *
 * Screens whose top bar doesn't slide (the tab title bars) never report, which is why `useSlidingBar`
 * resets this to 0 on blur — otherwise a stale offset from Browse would follow you to Library.
 */
let hiddenPx = 0;

export function setTopBarHidden(px: number): void {
  hiddenPx = Math.max(0, px);
}

export function getTopBarHidden(): number {
  return hiddenPx;
}
