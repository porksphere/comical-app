/**
 * Whether the screen on display keeps the bottom bar put. The one plain-JS fact about the bar —
 * everything that moves it (position, hide offset, the pin mirrored for worklets) is a Reanimated
 * shared value next door in `tab-bar-slide`. Split so this module stays importable from a bun unit
 * test, which can't load Reanimated at all.
 *
 * There's one bar, so this is a single module value rather than a per-screen one.
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
