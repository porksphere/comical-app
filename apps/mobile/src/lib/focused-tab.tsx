import { useSegments } from 'expo-router';
import { createContext, use, useLayoutEffect } from 'react';

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
 * stack, null when it belongs on the root stack: outside the tabs. An in-tab series is a plain
 * pushed card of that stack (see useNativePush in app/series/index), so a page pushed from on top
 * of it — a related series, its tag search, a result — stacks there too.
 */
export function focusedTabRoute(): string | null {
  if (segments[0] !== '(tabs)') return null;
  return segments[1] ?? null;
}

/**
 * The tab a component is rendered UNDER — provided by each tab's stack (components/tab-stack),
 * null outside the tabs. Not the focused tab: every tab's screens stay mounted while another is
 * focused, so a Link rendered in Library must name Library's stack even while Browse is up, and
 * `focusedTabRoute` would hand it Browse's. The imperative `router` reads the focused tab because
 * it runs at press time, when the two agree; an href is built at render time, when they need not.
 */
export const TabRouteContext = createContext<string | null>(null);

export function useTabRoute(): string | null {
  return use(TabRouteContext);
}
