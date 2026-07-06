/**
 * Registry backing "tap the already-active tab to scroll to top" for the custom-rendered tab bar
 * (`app-tabs.tsx`), which has no OS-native equivalent to rely on. Keyed by the same tab name used
 * in its `TABS` list; each screen registers its own scrollable while focused via
 * `useScrollToTopOnReselect`.
 */
type ScrollToTop = () => void;

const registry = new Map<string, ScrollToTop>();

export function registerScrollToTop(routeName: string, fn: ScrollToTop): () => void {
  registry.set(routeName, fn);
  return () => {
    if (registry.get(routeName) === fn) registry.delete(routeName);
  };
}

export function scrollToTopFor(routeName: string): void {
  registry.get(routeName)?.();
}
