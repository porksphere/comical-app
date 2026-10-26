import { useSyncExternalStore } from 'react';

/**
 * Whether the iOS system tab bar is hidden — a count of the screens asking for that, for the same
 * reason `tab-bar-visibility` keeps a count: two series layers can both be on their pages, and a
 * flag would bring the bar back as soon as the first of them returned to its details. Only the
 * reader takes it. Every pushed PAGE keeps the bar, as the system apps do (a series page or a
 * search lives inside the tab's own stack — see `tab-stack`), and the reader is the one screen
 * that is full-bleed.
 *
 * Plain module state behind useSyncExternalStore rather than a Legend observable: one boolean the
 * tab shell renders from, nothing persists it, nothing on the UI thread reads it.
 */
let hides = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function hideNativeTabBar(): () => void {
  hides += 1;
  if (hides === 1) notify();
  // Idempotent: a release called twice must not drop somebody else's hide along with its own.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hides -= 1;
    if (hides === 0) notify();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return hides > 0;
}

export function useNativeTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
