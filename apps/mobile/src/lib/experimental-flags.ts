import { usePathname } from 'expo-router';
import { createContext, useCallback, useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * EXPERIMENTAL feature toggles, surfaced in Settings → General → Experimental. Each flag here is a
 * self-contained experiment; keep this file to flags only so ripping an experiment out stays a
 * three-touch removal (its flag, its Settings row, its feature code).
 *
 * ── Series reader page ───────────────────────────────────────────────────────
 * When on, tapping a series card anywhere (browse, search, rails, library) opens `/series-reader`
 * — one screen holding both the series details and an in-place reader, with the pages as a faded
 * strip forming the top of the details page — instead of the `/series` detail screen. Off by
 * default.
 *
 * The whole experiment is:
 *   - this flag + `useSeriesSubPath` below (and its call sites, which unwrap to the plain path),
 *   - the Settings row in `app/settings-general.tsx`,
 *   - the route target switch in `components/series-card.tsx` (`buildHref`),
 *   - the screen itself, the `app/series-reader/` directory (+ its Stack.Screen entry in
 *     `app/_layout.tsx`) — see `app/series-reader/index.tsx` for the full removal list.
 *
 * Persisted as an OBJECT, not a bare boolean (same reasoning as perf-flags.ts): Legend State's
 * `safeStringify` hands a falsy value to AsyncStorage unstringified, which crashes native
 * RNCAsyncStorage when the toggle is off. An object is always truthy → serialized.
 */
export const seriesReaderPage$ = persisted$('comical:experimental-series-reader', {
  enabled: false,
});

/** Reactive read via `useSyncExternalStore` — NOT a bare `use$()`; see perf-flags.ts for why
 *  (React Compiler doesn't recognize `use$` as a hook and mis-memoizes its internals). */
export function useSeriesReaderPage(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => seriesReaderPage$.enabled.onChange(onStoreChange),
    () => seriesReaderPage$.enabled.peek(),
    () => seriesReaderPage$.enabled.peek(),
  );
}

/** The sub-pages a series page (or its reader) can push. */
type SeriesSubPath = '/search' | '/series-downloads' | '/downloads';

/**
 * EXPERIMENTAL series-reader companion: `/series-reader` is a contained transparent modal, and
 * react-native-screens can't push a plain root-stack card on top of a transparent modal (it
 * presents as a bottom sheet, not a page). The modal therefore hosts its own nested stack with
 * twin routes for every sub-page the series details / in-place reader can push (see
 * `app/series-reader/_layout.tsx`). This hook keeps the push SITES context-free: on the
 * series-reader (or one of its sub-pages) it prefixes the target into the nested stack — a real
 * native push with the edge-swipe back — and everywhere else it returns the path untouched.
 * Remove with the experiment: call sites unwrap to the plain path.
 */
export function useSeriesSubPath(): (path: SeriesSubPath) => SeriesSubPath | `/series-reader${SeriesSubPath}` {
  const pathname = usePathname();
  const inSeriesReader = pathname === '/series-reader' || pathname.startsWith('/series-reader/');
  return useCallback(
    (path: SeriesSubPath) => (inSeriesReader ? (`/series-reader${path}` as const) : path),
    [inSeriesReader],
  );
}

/**
 * True anywhere inside the /series-reader nested stack (provided by `app/series-reader/_layout.tsx`).
 * Series cards read this instead of `usePathname` — cards are render-cost-sensitive, and a context
 * whose value never changes doesn't re-render them on every navigation the way the pathname hook
 * would. With it set, a card tap DRILLS the series inside the stack (`/series-reader/related`, an
 * ordinary pushed card) rather than stacking a second transparent modal — two stacked
 * contained-transparent-modals lose the middle screen's view on iOS (UIKit re-roots the
 * OverCurrentContext presentation at the react root), which showed the tab root behind a dismissal
 * and replayed the parent series' enter animation after it. Remove with the experiment.
 */
export const InSeriesReaderStack = createContext(false);
