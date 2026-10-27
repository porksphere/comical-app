import { useSegments } from 'expo-router';
import { useLayoutEffect } from 'react';

/**
 * Which tab the user is in, for the router wrapper (lib/nav) to push a series, search or results
 * page INTO that tab's native stack on iOS — see `inTabHref` there.
 *
 * A module value fed by one tracker in the root layout rather than a hook: the wrapper runs in
 * event handlers, often through the module `router` with no component around it at all. The
 * segments are what expo-router's `useSegments` reports for the focused route —
 * `['(tabs)', 'library', 'search']`, or `['series', 'downloads']` for a root route.
 */
let segments: readonly string[] = [];

export function FocusedTabTracker() {
  const current = useSegments();
  useLayoutEffect(() => {
    segments = current;
  }, [current]);
  return null;
}

/**
 * The tab's route name (`'(home)'`, `'library'`, …) when a page pushed now belongs in the tab's
 * stack, null when it belongs on the root stack: outside the tabs, or anywhere on top of an
 * in-tab series — the page itself or the tag search pushed inside it. That series is a contained
 * transparent modal, and nothing can be pushed over one in the same stack (see InSeriesPageStack
 * in lib/series-nav), so from there a page goes over the whole tab shell as it always did.
 */
export function focusedTabRoute(): string | null {
  if (segments[0] !== '(tabs)') return null;
  const tab = segments[1];
  if (!tab || segments.includes('series')) return null;
  return tab;
}
