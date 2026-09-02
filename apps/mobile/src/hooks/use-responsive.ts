import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { DesktopTopBarHeight, TopBarHeight } from '@/constants/theme';

/**
 * "The real viewport width is safe to use." True on the FIRST render on native, and only after mount
 * on web.
 *
 * The deferral is a web-only concern: the static export prerenders with no viewport (width 0), so the
 * client's first render has to reproduce that same small-screen assumption or React warns and
 * reflows. Native has no prerender — `useWindowDimensions()` returns the true width on the very first
 * render — so deferring there buys nothing and COSTS a guaranteed-wrong first frame: every consumer
 * lays out at the fallback size, then jumps to the real one a frame later (rail cards visibly
 * snapping wider, a desktop-width top bar starting short). Gate the deferral on web so native is
 * correct immediately.
 *
 * Expressed as a `useSyncExternalStore` with two constant snapshots rather than a `setState` in an
 * effect: hydrated-ness IS the difference between React's prerender pass and its client pass, which
 * is exactly what the server/client snapshot split means. React uses `getServerSnapshot` for the
 * static export AND for the hydrating render, then the client snapshot from then on — so web still
 * holds the small-screen assumption for exactly one render, while native (which never prerenders)
 * reads `true` on its very first one. Nothing can change it afterwards, hence the no-op subscribe.
 */
const subscribeToNothing = () => () => {};
const hydratedSnapshot = () => true;
const prerenderSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, hydratedSnapshot, prerenderSnapshot);
}

/**
 * Whether this viewer is POINTING rather than touching — the question that decides how big a
 * tappable row has to be, and whether hover is worth wiring at all.
 *
 * Not the platform, and not the width. It used to be inferred from "web, and showing the desktop
 * overlay", which was a fine proxy only while that overlay could not appear on a phone; once a
 * short picker started opening as an anchored menu on a phone too (see MENU_MAX_ROWS), the proxy
 * put 34pt pointer rows under a thumb. `hover: hover and pointer: fine` is the actual question, and
 * the browser already answers it — a touch laptop with a trackpad says yes, a phone says no, and a
 * tablet says no even in a desktop-width browser window.
 *
 * Native is never fine-pointer: even an iPad with a trackpad is a touch-first target, and its rows
 * should stay thumb-sized.
 *
 * Hydration-safe (see `useHydrated`) — the static export prerenders with no `matchMedia`, so the
 * first client render holds the touch assumption, which is the one that is never too small.
 */
export function usePointerFine(): boolean {
  const hydrated = useHydrated();
  return hydrated && Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false;
}

// The reference site switches its type scale at 560/561px (max-width:560 reads as
// "mobile", min-width:561 as "desktop"). Mirror that single breakpoint so the
// card titles and bridge/page selectors track the website at both sizes.
export const COMPACT_BREAKPOINT = 560;

/** Viewport width at which the series detail (and browse grid / rail) switch to
 *  a large-screen desktop layout. Matches the breakpoint used in rail.tsx,
 *  (tabs)/index.tsx, and app-tabs.tsx. */
export const LARGE_SCREEN_BREAKPOINT = 768;

/**
 * True when the viewport is at the reference's mobile width.
 *
 * Hydration-safe on WEB (see `useHydrated`): the static export prerenders with no
 * viewport, so the first client render holds the compact assumption and then switches
 * to the real width. On native the real width is used from the first render.
 */
export function useIsCompact(): boolean {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  return hydrated ? width <= COMPACT_BREAKPOINT : true;
}

/**
 * True when the viewport is at the large-screen (desktop) width (≥768px).
 *
 * Hydration-safe on web like `useIsCompact`; on native the real width applies from
 * the first render (see `useHydrated`).
 */
export function useIsLargeScreen(): boolean {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  return hydrated ? width >= LARGE_SCREEN_BREAKPOINT : false;
}

/**
 * Content height of the sticky top bars — taller on desktop (≥768px), compact
 * otherwise. Shared by the browse bridge/page bar and the series-detail bar so
 * the two stay the same height and resize together (just change the
 * `TopBarHeight` / `DesktopTopBarHeight` constants).
 *
 * Hydration-safe on web like `useIsCompact`; on native the real width applies from
 * the first render, so a desktop-width bar doesn't start short and jump (see `useHydrated`).
 */
export function useTopBarHeight(): number {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  return hydrated && width >= LARGE_SCREEN_BREAKPOINT ? DesktopTopBarHeight : TopBarHeight;
}
