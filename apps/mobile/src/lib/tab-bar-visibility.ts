/**
 * The two plain-JS facts about the bottom bar: how tall it measured, and whether the screen on
 * display keeps it. Its live slide position is a Reanimated shared value and lives next door in
 * `tab-bar-slide` — split so this module stays importable from a bun unit test, which can't load
 * Reanimated at all.
 *
 * There's one bar, so both of these are single module values rather than per-screen ones.
 */

/**
 * Screens that keep the bottom bar put — it neither slides (native) nor fades (web) there, whatever
 * their content does. Settings is the whole of it today: it's a table of contents you scan and tap,
 * so hiding the nav buys nothing and costs you the tap you came for.
 *
 * A count, not a flag: the pin is taken on focus and dropped on blur, and a push/pop overlaps the
 * two (the incoming screen focuses before the outgoing one blurs), so a flag would leave the bar
 * unpinned after a settings→settings navigation.
 *
 * Taking it also snaps the bar back to fully shown — arriving from a tab that had scrolled it away
 * must not leave it stuck off-screen here. That happens in the subscribers (`tab-bar-slide` for the
 * native slide, `app-tabs` for the web fade) rather than here, so this module keeps no dependency on
 * either.
 */
type PinListener = (pinned: boolean) => void;

let pins = 0;
const pinListeners = new Set<PinListener>();

export function pinTabBar(): () => void {
  pins += 1;
  if (pins === 1) {
    for (const listener of pinListeners) listener(true);
  }
  // Idempotent: a release called twice must not drop somebody else's pin along with its own.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pins -= 1;
    if (pins === 0) for (const listener of pinListeners) listener(false);
  };
}

export function isTabBarPinned(): boolean {
  return pins > 0;
}

export function subscribeTabBarPinned(listener: PinListener): () => void {
  pinListeners.add(listener);
  return () => pinListeners.delete(listener);
}

/**
 * Pixels the bar translates to fully clear the viewport — its MEASURED height plus a hair of slack,
 * reported by app-tabs' onLayout. Progress is unitless; everything that turns it back into pixels
 * (the bar's own translateY, the long-press overlay's chrome band) multiplies by this, and
 * `useHideTabBarOnScroll` uses it as the slide span, so translateY == accumulated scroll px and the
 * bar moves 1:1 with the finger. It used to be a padded constant (120) while the bar is only
 * ~48 + bottom-inset tall: fully hidden, the bar was parked ~38px past the screen edge, and a
 * scroll-up spent ~30px walking that invisible overshoot back before the bar visibly moved.
 * 120 survives only as the pre-first-layout fallback.
 */
let hideOffset = 120;

export function setTabBarHideOffset(px: number): void {
  if (px > 0) hideOffset = px;
}

export function getTabBarHideOffset(): number {
  return hideOffset;
}
