/**
 * Registry backing "slide the tab bar away as you scroll down, back in as you scroll up"
 * (`app-tabs.tsx`). Each tab screen reports its scroll position via `useHideTabBarOnScroll`; there's
 * only one bar, so this is a single shared value rather than a per-screen one.
 *
 * `progress` is 0 (fully shown) to 1 (fully hidden) and tracks scroll position continuously —
 * not a two-state flip — so the bar moves in lockstep with the finger, X/Twitter-style. It is
 * native-only: web hides the bar by fading it instead (`useAutoHideBottomBar` in app-tabs) and
 * leaves `progress` at 0 throughout.
 *
 * The PIN below (`pinTabBar`) is the one part both platforms read — "this screen keeps the bar",
 * which has to mean the same thing whether the bar would otherwise slide or fade.
 */
type Listener = (progress: number) => void;

let progress = 0;
const listeners = new Set<Listener>();

export function setTabBarProgress(next: number): void {
  // A pinned screen owns the bar outright (see `pinTabBar`): whatever anyone else reports, it stays
  // put. Swallowed here rather than at each reporter so there is one place the guarantee holds.
  const clamped = pins > 0 ? 0 : Math.min(1, Math.max(0, next));
  if (clamped === progress) return;
  progress = clamped;
  for (const listener of listeners) listener(clamped);
}

export function getTabBarProgress(): number {
  return progress;
}

export function subscribeTabBarProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Screens that keep the bottom bar put — it neither slides (native) nor fades (web) there, whatever
 * their content does. Settings is the whole of it today: it's a table of contents you scan and tap,
 * so hiding the nav buys nothing and costs you the tap you came for.
 *
 * A count, not a flag: the pin is taken on focus and dropped on blur, and a push/pop overlaps the
 * two (the incoming screen focuses before the outgoing one blurs), so a flag would leave the bar
 * unpinned after a settings→settings navigation. Taking it also snaps the bar back to fully shown —
 * arriving from a tab that had scrolled it away must not leave it stuck off-screen here.
 */
type PinListener = (pinned: boolean) => void;

let pins = 0;
const pinListeners = new Set<PinListener>();

export function pinTabBar(): () => void {
  pins += 1;
  if (pins === 1) {
    // Ordering: `setTabBarProgress` clamps to 0 while pinned, so this both reveals the bar and
    // becomes the position everything else is now held at.
    setTabBarProgress(0);
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
