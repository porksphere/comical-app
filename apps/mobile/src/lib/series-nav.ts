import type { Href, Stack } from 'expo-router';
import { useNavigation, useSegments } from 'expo-router';
import type { ComponentProps } from 'react';
import { createContext, useCallback, useContext } from 'react';

import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { useRouter } from '@/lib/nav';
import { claimNavigation, navTargetKey } from '@/lib/nav-guard';

/** The sub-pages a series page (or its reader) can push. (The tag/author/type SEARCH is routed
 *  separately — see useOpenSeriesSearch.) */
type SeriesSubPath = '/series-downloads' | '/downloads';

/**
 * `/series` is a contained transparent modal, and
 * react-native-screens can't push a plain root-stack card on top of a transparent modal (it
 * presents as a bottom sheet, not a page). The modal therefore hosts its own nested stack with
 * twin routes for every sub-page the series details / in-place reader can push (see
 * `app/series/_layout.tsx`). This hook keeps the push SITES context-free: on the
 * series page (or one of its sub-pages) it prefixes the target into the nested stack — a real
 * native push with the edge-swipe back — and everywhere else it returns the path untouched.
 *
 * Only the ROOT series route's nested stack has the sub-page routes. Its copies inside the iOS tab
 * stacks (`app/(tabs)/<tab>/series`) host a nested stack too (`components/tab-series-stack`), but
 * only for the page's system bar; they can't push a card over themselves either, so from one of
 * those the sub-page goes to the root route, over the tab shell — hence the segments, not the
 * pathname, which strips the `(tabs)` group and reads the same for both.
 *  */
export function useSeriesSubPath(): (path: SeriesSubPath) => SeriesSubPath | `/series${SeriesSubPath}` {
  const segments: readonly string[] = useSegments();
  const inSeriesPage = segments[0] === 'series';
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

/**
 * Registrations as a stack, newest answering. Drilled series are layers inside ONE series page,
 * never a second modal — but the desktop pane stays mounted under a full-screen reader opened from
 * it (see lib/series-pane), so two pages can be up at once, and the one on top must take the drill
 * while the pane gets it back when the reader closes. A hand-rolled module singleton on purpose
 * (like lib/tab-bar-visibility): the React Compiler forbids mutating a context-carried ref, and
 * this is a callback hand-off, not state anything renders from.
 */
function handlerStack<F>() {
  const stack: F[] = [];
  return {
    current: (): F | null => stack[stack.length - 1] ?? null,
    register(fn: F): () => void {
      stack.push(fn);
      return () => {
        const at = stack.lastIndexOf(fn);
        if (at >= 0) stack.splice(at, 1);
      };
    },
  };
}

const drillSeriesHandlers = handlerStack<(params: Record<string, string>) => void>();
/**
 * A drill asked for while no page holds the handlers: the nested search card (iOS) covers the
 * series page, which gives them up while blurred — so a result tapped there pops the card first
 * and the page takes the drill back as it re-registers on focus. Timed, so a stale one can't fire
 * on a page opened later.
 */
let pendingDrill: { params: Record<string, string>; at: number } | null = null;
const PENDING_DRILL_MS = 1500;
export function registerDrillSeries(fn: (params: Record<string, string>) => void): () => void {
  const unregister = drillSeriesHandlers.register(fn);
  if (pendingDrill) {
    const { params, at } = pendingDrill;
    pendingDrill = null;
    if (Date.now() - at <= PENDING_DRILL_MS) fn(params);
  }
  return unregister;
}

/**
 * The same drill, for a caller OUTSIDE the series page's React tree. The card context menu is a
 * ROOT overlay (see SeriesCardContextMenuHost), so it can't read the `InSeriesPageStack` context
 * the cards themselves do — yet a card long-pressed in a related rail must still open its series
 * as a LAYER rather than stack a second contained transparent modal, which is the one thing iOS
 * won't do (see the note on InSeriesPageStack).
 *
 * The registered handler's presence IS the test, and it's exact: while a series page is mounted,
 * the topmost one is the screen the menu was opened over. Returns false when there is none, so the
 * caller pushes the route instead.
 */
export function drillSeriesFromOverlay(params: Record<string, string>): boolean {
  const handler = drillSeriesHandlers.current();
  if (!handler) return false;
  // Shares the nav-guard claim with the in-tree drill, so a double commit can't fire twice.
  if (claimNavigation(navTargetKey({ pathname: '/series', params }))) handler(params);
  return true;
}

/** Same hand-off for the SEARCH layer (tag/author/type intents — see SearchLayer in
 *  app/series/index.tsx). Android and web only; iOS pushes a card instead, see below. */
const openSearchLayerHandlers = handlerStack<() => void>();
export function registerOpenSearchLayer(fn: () => void): () => void {
  return openSearchLayerHandlers.register(fn);
}

/**
 * The options of the `search` card inside a series page's nested stack (the root route's and
 * each tab copy's), iOS: the only sub-page there that shows the system bar, since the search's
 * field IS that bar. Both stacks hide the bar by default for the combined page, whose bar is its
 * own `Stack.Screen`'s business; this is the same transparent, chevron-only bar every pushed page
 * gets from the root and tab stacks.
 */
export const NESTED_SEARCH_BAR: ComponentProps<typeof Stack.Screen>['options'] = {
  headerShown: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  scrollEdgeEffects: { top: 'soft' },
};

/**
 * Tag/author/type search, for the series details: null outside the series page's nested stack
 * (callers fall back to pushing /search), otherwise a function that opens the search over the
 * series. The caller stashes the search intent first (setSearchIntent), exactly like the route
 * path.
 *
 * On iOS it is a real push INTO the page's nested stack — the `search` twin under `app/series/`
 * or the focused tab's `series/` copy (by the segments, which strip the `(tabs)` group), so the
 * tab bar stays up and the search gets the system bar with its field, filters sheet and sort
 * menu like the one pushed from Browse. Over the series page, as one of its sub-pages, because
 * the page's own route is a contained transparent modal nothing can be pushed over (see
 * InSeriesPageStack). Elsewhere the search is an in-screen LAYER over the series — sliding in
 * with the statically-stuck shared chevron, the parent live beneath, and its result cards
 * drilling further layers.
 */
export function useOpenSeriesSearch(): (() => void) | null {
  const inStack = useContext(InSeriesPageStack);
  const segments: readonly string[] = useSegments();
  const router = useRouter();
  const nestedSearch = NATIVE_HEADER ? nestedSearchHref(segments) : null;
  // A useCallback rather than a useMemo returning one, as in useDrillRelatedSeries: the React
  // Compiler can't prove `router` stable and gives up on a memo closing over it.
  const open = useCallback(() => {
    if (nestedSearch) {
      router.push(nestedSearch);
      return;
    }
    if (!claimNavigation(navTargetKey('/series#search'))) return;
    openSearchLayerHandlers.current()?.();
  }, [nestedSearch, router]);
  return inStack ? open : null;
}

/** The nested `search` route of the series page the segments describe, if they describe one. */
function nestedSearchHref(segments: readonly string[]): Href | null {
  if (segments[0] === 'series') return '/series/search' as Href;
  if (segments[0] === '(tabs)' && segments[1] && segments[2] === 'series') {
    return `/(tabs)/${segments[1]}/series/search` as unknown as Href;
  }
  return null;
}

/**
 * The drill itself, for series cards: null outside the series page's nested stack (callers fall back to
 * their normal `router.push`), otherwise a function that hands the tapped series to the combined
 * page's layer stack. From the nested search/downloads sub-pages it first pops the nested stack
 * back to the combined page (the layers live on that screen), so the result slides in over the
 * series context you came from — and since that page only holds the handlers while focused,
 * the drill waits for it (see registerDrillSeries). Shares the nav-guard claim so a double tap
 * can't fire twice.
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
      // its root and the stack router rejects POP_TO_TOP (a noisy dev warning). By the top route's
      // NAME, not the index, so a navigator with no sub-pages at all (a tab copy's nested stack)
      // reads the same.
      const state = navigation.getState();
      const top = state?.routes[state.index]?.name;
      if (top === 'downloads' || top === 'series-downloads' || top === 'search') {
        navigation.dispatch({ type: 'POP_TO_TOP' });
      }
      const handler = drillSeriesHandlers.current();
      if (handler) handler(params);
      else pendingDrill = { params, at: Date.now() };
    },
    [navigation],
  );
  return inStack ? drill : null;
}
