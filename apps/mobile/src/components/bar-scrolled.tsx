import { createContext, use, useMemo, useState, type ReactNode } from 'react';

/**
 * Whether a screen's list has scrolled past the top, for the bar over it (iOS): bare over the top
 * of the page, the frosted material once content is a few points under it, the series page's
 * way, with `nav-bar-fade` crossfading the switch. The system's own scroll edge is hidden on
 * these screens: it fades in behind the bar's buttons as content slides under, a half-backed bar
 * for the first points of a scroll, and goes the instant the list is back at the top.
 *
 * Provided per screen by the stacks' `screenLayout` (`barExtentLayout`). Reported by whatever
 * holds the screen's list — `ScreenScrollMarker` for a React Native list, the settings form for
 * its SwiftUI one — through the content-scroll-view anchor, which watches the list's offset
 * natively and reports only the crossings. Read by `NativeTabHeader` and `TopBar`.
 */
export const BAR_SCROLLED_AT = 8;

type BarScrolled = { scrolled: boolean; report: (scrolled: boolean) => void };

const BarScrolledContext = createContext<BarScrolled | null>(null);

export function BarScrolledProvider({ children }: { children: ReactNode }) {
  const [scrolled, report] = useState(false);
  const value = useMemo(() => ({ scrolled, report }), [scrolled]);
  return <BarScrolledContext.Provider value={value}>{children}</BarScrolledContext.Provider>;
}

/** Whether the screen's list is past the top; false outside a stack's screen. */
export function useBarScrolled(): boolean {
  return use(BarScrolledContext)?.scrolled ?? false;
}

/** The screen's reporter, for the view that holds its list; undefined outside a stack's screen. */
export function useReportBarScrolled(): ((scrolled: boolean) => void) | undefined {
  return use(BarScrolledContext)?.report;
}
