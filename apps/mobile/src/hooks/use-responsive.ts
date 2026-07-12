import { useEffect, useState } from 'react';
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
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(Platform.OS !== 'web');
  useEffect(() => setHydrated(true), []);
  return hydrated;
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
