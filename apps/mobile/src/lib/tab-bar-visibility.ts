/**
 * Native-only registry backing "slide the tab bar away on scroll down, back in on scroll up"
 * (`app-tabs.tsx`). Web has its own DOM-scroll-driven fade (see `useAutoHideBottomBar` there) and
 * doesn't use this. Each tab screen reports its scroll direction via `useHideTabBarOnScroll`;
 * there's only one bar, so this is a single shared boolean rather than a per-screen one.
 */
type Listener = (hidden: boolean) => void;

let hidden = false;
const listeners = new Set<Listener>();

export function setTabBarHidden(next: boolean): void {
  if (hidden === next) return;
  hidden = next;
  for (const listener of listeners) listener(next);
}

export function getTabBarHidden(): boolean {
  return hidden;
}

export function subscribeTabBarHidden(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
