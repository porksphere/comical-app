import { Platform } from 'react-native';

import {
  Link as ExpoLink,
  router as expoRouter,
  useLocalSearchParams as useExpoLocalSearchParams,
  useRouter as useExpoRouter,
} from 'expo-router';
import { useMemo, type ComponentProps } from 'react';

import { openBridgeSearchPane } from '@/lib/bridge-search-pane';
import { focusedTabRoute } from '@/lib/focused-tab';
import { usePaneNav, usePaneParams, type PaneParams } from '@/lib/pane';
import { openResultsPane } from '@/lib/results-pane';
import { openSeriesPane } from '@/lib/series-pane';

import { BACK_TARGET, claimNavigation, navTargetKey } from '@/lib/nav-guard';

/**
 * The app's navigation entry points — expo-router's, wrapped so a duplicate navigation from a
 * double tap is dropped. **Import `useRouter`, `router` and `Link` from here, never from
 * `expo-router` directly** (enforced by the `comical/no-unguarded-nav` lint rule).
 *
 * Why this exists at all — and why the guard is time-based rather than state-based — is in
 * `nav-guard.ts`; this module only wires that decision to the two ways the app navigates:
 * the imperative router (every screen) and the `<Link>` anchor (the series card on web, and
 * ExternalLink). Both share ONE guard, so a card that is a `<Link>` on web and an imperative
 * `router.push` on native can't double-fire through the seam either.
 *
 * Only the operations that CHANGE the stack are guarded — `push`/`navigate`/`replace`/
 * `dismissTo` by destination, `back`/`dismiss`/`dismissAll` as one shared "go back" target.
 * `setParams`, `prefetch`, `reload` and the `can*` predicates pass straight through: they're
 * either idempotent or not navigation at all, and guarding them would only break callers.
 */

type Router = ReturnType<typeof useExpoRouter>;

/**
 * Guarded views are cached per underlying router object so the wrapper has a STABLE identity —
 * `router` sits in plenty of `useCallback`/`useMemo` dependency arrays, and a fresh object per
 * render would invalidate every one of them. (expo-router hands out one of two singletons: the
 * real router, or a warn-only one inside a link preview — hence a map rather than a constant.)
 */
const guarded = new WeakMap<Router, Router>();

function guard(base: Router): Router {
  const existing = guarded.get(base);
  if (existing) return existing;
  const wrapper: Router = {
    ...base,
    push: (href, options) => {
      if (!claimNavigation(navTargetKey(href))) return;
      if (takeContentPane(href)) return;
      base.push(destinationHref(href), options);
    },
    navigate: (href, options) => {
      if (!claimNavigation(navTargetKey(href))) return;
      if (takeContentPane(href)) return;
      base.navigate(destinationHref(href), options);
    },
    replace: (href, options) => {
      if (claimNavigation(navTargetKey(href))) base.replace(href, options);
    },
    dismissTo: (href, options) => {
      if (claimNavigation(navTargetKey(href))) base.dismissTo(href, options);
    },
    back: () => {
      if (claimNavigation(BACK_TARGET)) base.back();
    },
    dismiss: (count) => {
      if (claimNavigation(BACK_TARGET)) base.dismiss(count);
    },
    dismissAll: () => {
      if (claimNavigation(BACK_TARGET)) base.dismissAll();
    },
  };
  guarded.set(base, wrapper);
  return wrapper;
}

/**
 * Guarded drop-in for expo-router's `useRouter()`.
 *
 * Inside a pane it also stays inside it: a settings screen that pushes a sub-page (a bridge's
 * settings, a registry's contents, a page editor) would otherwise navigate the whole app to a
 * full-screen route and leave the panel behind, and a series page's back would unwind the app under
 * its own pane. The pane gets first refusal on every push and every back; anything it declines goes
 * to the router as usual.
 */
export function useRouter(): Router {
  const base = guard(useExpoRouter());
  const pane = usePaneNav();
  return useMemo(() => {
    if (!pane) return base;
    return {
      ...base,
      push: (href: Parameters<Router['push']>[0]) => {
        const { pathname, params } = splitHref(href);
        if (pathname && pane.push(pathname, params)) return;
        base.push(href);
      },
      back: () => {
        if (pane.back()) return;
        base.back();
      },
      canGoBack: () => pane.canGoBack() || base.canGoBack(),
    };
  }, [base, pane]);
}

/**
 * Hands a `/series`, `/results` or `/search` navigation to its pane over the content region when one is up,
 * and reports that it did.
 *
 * Here rather than at the call sites because there are eleven of them across cards, rows, menus and
 * the series page's own related rails, and a pane that some of them missed would be a pane you can
 * navigate out from under. The panes answer false whenever none is mounted — every viewport below
 * the rail's, and every native build — so this reduces to the plain push there.
 */
function takeContentPane(href: unknown): boolean {
  const { pathname, params } = splitHref(href);
  if (pathname === '/series') return openSeriesPane(params);
  if (pathname === '/results') return openResultsPane(params);
  if (pathname === '/search') return openBridgeSearchPane();
  return false;
}

/**
 * Where a push actually lands. Here, with the pane hand-off, because the push sites are many and
 * context-free.
 *
 * A reader-first `/series` open, a collection's sequence among them, is the READER page,
 * `/series/read`: the details and the reader are two pages (SeriesSplit in components/series/split-handoff).
 *
 * iOS: a series, search or results page pushed from inside a tab opens INSIDE that tab's native
 * stack — the twin routes under `app/(tabs)/<tab>/in-tab/` — so the tab bar stays up over it as it does in
 * every system app, instead of on the root stack over the whole tab shell. From outside the tabs
 * the page goes to the root route — see `focusedTabRoute`. Android and web keep their single root
 * copies.
 */
type PushHref = Parameters<Router['push']>[0];
const IN_TAB_PATHS = new Set(['/series', '/search', '/results']);
function destinationHref(href: PushHref): PushHref {
  const { pathname, params } = splitHref(href);
  if (!pathname || !IN_TAB_PATHS.has(pathname)) return href;
  const page = pathname === '/series' && (params.reader === '1' || params.seq === '1') ? '/series/read' : pathname;
  const tab = Platform.OS === 'ios' ? focusedTabRoute() : null;
  if (tab) return tabHref(tab, page, params);
  return page === pathname ? href : ({ pathname: page, params } as unknown as PushHref);
}

/**
 * A tab's own copy of a root page: `/series` inside `library` is `/(tabs)/library/in-tab/series`. For a
 * `<Link>` rendered under a tab (series-card's zoom link), which names its stack itself — the
 * imperative push above does this for every call site, but an href is built at render time, when
 * the focused tab is not necessarily the one the card is in (see `TabRouteContext`).
 */
export function tabHref(tab: string, pathname: string, params: PaneParams): PushHref {
  return { pathname: `/(tabs)/${tab}/in-tab${pathname}`, params } as unknown as PushHref;
}

/** Both shapes expo-router accepts, reduced to the pathname and params the pane needs to render. */
function splitHref(href: unknown): { pathname: string | null; params: PaneParams } {
  if (typeof href === 'string') {
    const [pathname, query] = href.split('?');
    return { pathname: pathname ?? null, params: Object.fromEntries(new URLSearchParams(query ?? '')) };
  }
  if (href && typeof href === 'object' && 'pathname' in href) {
    const o = href as { pathname?: unknown; params?: Record<string, unknown> };
    const params: PaneParams = {};
    for (const [k, v] of Object.entries(o.params ?? {})) params[k] = v == null ? undefined : String(v);
    return { pathname: typeof o.pathname === 'string' ? o.pathname : null, params };
  }
  return { pathname: null, params: {} };
}

/**
 * Drop-in for expo-router's `useLocalSearchParams` that prefers the settings pane's own params.
 *
 * A screen rendered as a pane was never navigated to, so the URL still describes whatever route is
 * actually showing — the pane's `bridge-settings` would have read the Browse tab's params. Screens
 * that can appear in the pane import this instead.
 */
export function useLocalSearchParams<T extends PaneParams = PaneParams>(): T {
  // Untyped against the route table on purpose: a pane's params come from a `push` the pane
  // intercepted, not from a route, so there is no path for expo-router to check them against.
  const routeParams = useExpoLocalSearchParams() as T;
  const paneParams = usePaneParams();
  return paneParams ? (paneParams as T) : routeParams;
}

/** Guarded drop-in for expo-router's `router` singleton (for call sites outside a component). */
export const router: Router = guard(expoRouter);

type LinkProps = ComponentProps<typeof ExpoLink>;
type LinkPressEvent = Parameters<NonNullable<LinkProps['onPress']>>[0];

/**
 * Guarded drop-in for expo-router's `<Link>`. A rejected press is `preventDefault()`ed, which
 * expo-router reads (`shouldHandleMouseEvent`) as "already handled" and skips its own
 * navigation — the same call that stops the browser following the underlying `<a href>` on web,
 * so neither route changes. The wrapped `onPress` is skipped too, since a link that does its own
 * work on press (ExternalLink opening the in-app browser) must not do it twice either.
 *
 * On WEB an accepted press also has to route itself. Handing `onPress` to `<Link asChild>` puts it
 * on the child Pressable, and expo-router's own click handling then never reaches the anchor — so
 * the browser followed the raw `href` and did a FULL DOCUMENT LOAD. Every series opened from a card
 * re-booted the whole app: measured at 5093ms against 1246ms for a client-side push, and the
 * "transition" people saw was the app cold-starting and fading in. So the accepted path pushes
 * through the router and cancels the anchor.
 *
 * `expoRouter`, not the guarded `router`: this press has already claimed its navigation, and going
 * back through the guard would have it reject its own claim.
 *
 * NATIVE IS UNTOUCHED. There is no anchor there, expo-router's `onPress` composition works as
 * documented, and this whole branch is behind `Platform.OS === 'web'`.
 */
export function Link({ onPress, ...rest }: LinkProps) {
  const handlePress = (event: LinkPressEvent) => {
    if (!claimNavigation(navTargetKey(rest.href))) {
      event.preventDefault();
      return;
    }
    onPress?.(event);
    if (Platform.OS !== 'web') return;
    event.preventDefault();
    if (takeContentPane(rest.href)) return;
    const to = destinationHref(rest.href);
    if (rest.replace) expoRouter.replace(to);
    else if (rest.push) expoRouter.push(to);
    else expoRouter.navigate(to);
  };
  // eslint-disable-next-line comical/require-test-id -- pass-through wrapper: the testID comes from the call site's props.
  return <ExpoLink {...rest} onPress={handlePress} />;
}

/**
 * The parts of expo-router's `Link` the iOS zoom transition is built from, for a `<Link asChild>`
 * from this module: `<LinkTrigger withAppleZoom>` around the pressed element makes it the zoom's
 * source, and `<LinkAppleZoomTarget>` on the destination screen marks what it grows into. Both are
 * a plain pass-through off iOS 18. Here because the lint keeps `Link` itself out of reach.
 */
export const LinkTrigger = ExpoLink.Trigger;
export const LinkAppleZoomTarget = ExpoLink.AppleZoomTarget;
