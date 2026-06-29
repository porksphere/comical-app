import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

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
