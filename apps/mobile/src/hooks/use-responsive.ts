import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { DesktopTopBarHeight, TopBarHeight } from '@/constants/theme';

// The reference site switches its type scale at 560/561px (max-width:560 reads as
// "mobile", min-width:561 as "desktop"). Mirror that single breakpoint so the
// card titles and bridge/page selectors track the website at both sizes.
export const COMPACT_BREAKPOINT = 560;

/** Viewport width at which the series detail (and browse grid / rail) switch to
 *  a large-screen desktop layout. Matches the breakpoint used in rail.tsx,
 *  (tabs)/index.tsx, and app-tabs.web.tsx. */
export const LARGE_SCREEN_BREAKPOINT = 768;

/**
 * True when the viewport is at the reference's mobile width.
 *
 * Hydration-safe: the static web export prerenders with no viewport (width 0 →
 * compact), so the first client render must also report compact or React warns
 * and reflows. We hold the mobile assumption until mount — matching the column
 * logic in the browse screen — then switch to the real viewport width.
 */
export function useIsCompact(): boolean {
  const { width } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? width <= COMPACT_BREAKPOINT : true;
}

/**
 * True when the viewport is at the large-screen (desktop) width (≥768px).
 *
 * Hydration-safe like `useIsCompact`: holds the not-large assumption until mount
 * so the static web export's first client render (which has no viewport) matches
 * the server render, then switches to the real viewport width.
 */
export function useIsLargeScreen(): boolean {
  const { width } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? width >= LARGE_SCREEN_BREAKPOINT : false;
}

/**
 * Content height of the sticky top bars — taller on desktop (≥768px), compact
 * otherwise. Shared by the browse bridge/page bar and the series-detail bar so
 * the two stay the same height and resize together (just change the
 * `TopBarHeight` / `DesktopTopBarHeight` constants).
 *
 * Hydration-safe like `useIsCompact`: holds the compact height until mount so
 * the static web export's first client render matches the (viewport-less)
 * server render.
 */
export function useTopBarHeight(): number {
  const { width } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated && width >= LARGE_SCREEN_BREAKPOINT ? DesktopTopBarHeight : TopBarHeight;
}
