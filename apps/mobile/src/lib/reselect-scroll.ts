/**
 * Web-only registry backing "tap the already-active tab to scroll to top" (native gets this for
 * free from the OS — see the react-native-screens patch — but the web nav is a custom component
 * with no equivalent system behavior). Keyed by the same tab name used in `app-tabs.web.tsx`'s
 * `TABS` list; each screen registers its own scrollable while focused via
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
