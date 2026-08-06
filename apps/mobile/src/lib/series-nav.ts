import { useNavigation, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useMemo } from 'react';

import { claimNavigation, navTargetKey } from '@/lib/nav-guard';

/** The sub-pages a series page (or its reader) can push. (Tag/author/type SEARCH is not one of
 *  them anymore — on the series page it opens as an in-screen layer, see
 *  useOpenSearchLayer.) */
type SeriesSubPath = '/series-downloads' | '/downloads';

/**
 * `/series` is a contained transparent modal, and
 * react-native-screens can't push a plain root-stack card on top of a transparent modal (it
 * presents as a bottom sheet, not a page). The modal therefore hosts its own nested stack with
 * twin routes for every sub-page the series details / in-place reader can push (see
 * `app/series/_layout.tsx`). This hook keeps the push SITES context-free: on the
 * series page (or one of its sub-pages) it prefixes the target into the nested stack — a real
 * native push with the edge-swipe back — and everywhere else it returns the path untouched.
 *  */
export function useSeriesSubPath(): (path: SeriesSubPath) => SeriesSubPath | `/series${SeriesSubPath}` {
  const pathname = usePathname();
  const inSeriesPage = pathname === '/series' || pathname.startsWith('/series/');
  return useCallback(
    (path: SeriesSubPath) => (inSeriesPage ? (`/series${path}` as const) : path),
    [inSeriesPage],
  );
}

/**
 * Present anywhere inside the /series nested stack (provided by
 * `app/series/_layout.tsx`), null everywhere else. Series cards read this instead of
 * `usePathname` — cards are render-cost-sensitive, and a context whose value never changes
 * doesn't re-render them on every navigation the way the pathname hook would. `drillSeries` is a
 * ref the combined page's screen fills with its layer-push (see SeriesReaderScreen): a drilled
 * series renders as a plain sibling LAYER inside that one screen, because navigation can't do
 * this on iOS — a second contained transparent modal loses the middle screen's view (UIKit
 * re-roots the OverCurrentContext presentation at the react root), and a covered nested card is
 * detached by UINavigationController — while a sibling view keeps the parent series LIVE beneath
 * the drilled one for its dismissal gestures.
 */
export const InSeriesPageStack = createContext(false);

/**
 * Percent-encode one series route param — a bridge display name or a cover URL.
 *
 * Parens included, explicitly: `encodeURIComponent` leaves '(' and ')' alone (they're unreserved),
 * and expo-router's href resolution breaks on literal parens in a param value. Real bridge names
 * carry them all the time ("Illustration Gallery (Demo)"), as do plenty of cover URLs. The series
 * page decodes with a single `decodeURIComponent`, which handles %28/%29 like any other escape.
 */
export function encodeSeriesParam(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** The layer-push handler, registered by the mounted SeriesReaderScreen (there is at most one —
 *  drilled series are layers inside it, never a second modal). A hand-rolled module singleton on
 *  purpose (like lib/tab-bar-visibility): the React Compiler forbids mutating a context-carried
 *  ref, and this is a callback hand-off, not state anything renders from. */
let drillSeriesHandler: ((params: Record<string, string>) => void) | null = null;
export function registerDrillSeries(fn: (params: Record<string, string>) => void): () => void {
  drillSeriesHandler = fn;
  return () => {
    if (drillSeriesHandler === fn) drillSeriesHandler = null;
  };
}

/**
 * The same drill, for a caller OUTSIDE the series page's React tree. The card context menu is a
 * ROOT overlay (see SeriesCardContextMenuHost), so it can't read the `InSeriesPageStack` context
 * the cards themselves do — yet a card long-pressed in a related rail must still open its series
 * as a LAYER rather than stack a second contained transparent modal, which is the one thing iOS
 * won't do (see the note on InSeriesPageStack).
 *
 * The registered handler's presence IS the test, and it's exact: at most one series page is ever
 * mounted, and while one is, it's the screen the menu was opened over. Returns false when there
 * is none, so the caller pushes the route instead.
 */
export function drillSeriesFromOverlay(params: Record<string, string>): boolean {
  if (!drillSeriesHandler) return false;
  // Shares the nav-guard claim with the in-tree drill, so a double commit can't fire twice.
  if (claimNavigation(navTargetKey({ pathname: '/series', params }))) drillSeriesHandler(params);
  return true;
}

/** Same hand-off for the SEARCH layer (tag/author/type intents — see SearchLayer in
 *  app/series/index.tsx). */
let openSearchLayerHandler: (() => void) | null = null;
export function registerOpenSearchLayer(fn: () => void): () => void {
  openSearchLayerHandler = fn;
  return () => {
    if (openSearchLayerHandler === fn) openSearchLayerHandler = null;
  };
}

/**
 * Tag/author/type search, for the series details: null outside the series page's nested stack (callers
 * fall back to pushing /search), otherwise a function that opens the search as an in-screen
 * LAYER over the series — sliding in with the statically-stuck shared chevron, the parent live
 * beneath, and its result cards drilling further layers. The caller stashes the search intent
 * first (setSearchIntent), exactly like the route path.
 */
export function useOpenSearchLayer(): (() => void) | null {
  const inStack = useContext(InSeriesPageStack);
  return useMemo(() => {
    if (!inStack) return null;
    return () => {
      if (!claimNavigation(navTargetKey('/series#search'))) return;
      openSearchLayerHandler?.();
    };
  }, [inStack]);
}

/**
 * The drill itself, for series cards: null outside the series page's nested stack (callers fall back to
 * their normal `router.push`), otherwise a function that hands the tapped series to the combined
 * page's layer stack. From the nested search/downloads sub-pages it first pops the nested stack
 * back to the combined page (the layers live on that screen), so the result slides in over the
 * series context you came from. Shares the nav-guard claim so a double tap can't fire twice.
 *
 */
export function useDrillRelatedSeries(): ((params: Record<string, string>) => void) | null {
  const inStack = useContext(InSeriesPageStack);
  const navigation = useNavigation();
  // A useCallback rather than a useMemo returning one: `navigation` is not a dependency the React
  // Compiler can prove stable, and it gives up on preserving a memo whose body closes over it.
  const drill = useCallback(
    (params: Record<string, string>) => {
      if (!claimNavigation(navTargetKey({ pathname: '/series', params }))) return;
      // Only when actually ON a sub-page — from the combined page itself the nested stack is at
      // its root and the stack router rejects POP_TO_TOP (a noisy dev warning).
      const state = navigation.getState();
      if (state && state.index > 0) navigation.dispatch({ type: 'POP_TO_TOP' });
      drillSeriesHandler?.(params);
    },
    [navigation],
  );
  return inStack ? drill : null;
}
