/**
 * Native-only registry backing "slide the tab bar away as you scroll down, back in as you scroll
 * up" (`app-tabs.tsx`). Web has its own DOM-scroll-driven fade (see `useAutoHideBottomBar` there)
 * and doesn't use this. Each tab screen reports its scroll position via `useHideTabBarOnScroll`;
 * there's only one bar, so this is a single shared value rather than a per-screen one.
 *
 * `progress` is 0 (fully shown) to 1 (fully hidden) and tracks scroll position continuously —
 * not a two-state flip — so the bar moves in lockstep with the finger, X/Twitter-style.
 */
type Listener = (progress: number) => void;

let progress = 0;
const listeners = new Set<Listener>();

export function setTabBarProgress(next: number): void {
  const clamped = Math.min(1, Math.max(0, next));
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
