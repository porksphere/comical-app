import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

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
 * natively and reports only the crossings. Read by `NativeTabHeader` and `TopBar`, which also
 * say they switch the bar (`useManagesBar`): only then is the list's own edge hidden, so a screen
 * with a bar of its own — a search — keeps the system's edge. The series page's bar backs itself
 * (`useManagesBar(true, 'bar')`): the list's edge is hidden for it, and the anchor reports nothing.
 */
export const BAR_SCROLLED_AT = 8;

/** Who switches the screen's bar: its list's crossings (the anchor's reports), or the bar itself. */
export type BarManager = 'list' | 'bar' | null;

type BarScrolled = {
  scrolled: boolean;
  report: (scrolled: boolean) => void;
  managed: BarManager;
  manage: (managed: BarManager) => void;
};

const BarScrolledContext = createContext<BarScrolled | null>(null);

export function BarScrolledProvider({ children }: { children: ReactNode }) {
  const [scrolled, report] = useState(false);
  const [managed, manage] = useState<BarManager>(null);
  const value = useMemo(() => ({ scrolled, report, managed, manage }), [scrolled, managed]);
  return <BarScrolledContext.Provider value={value}>{children}</BarScrolledContext.Provider>;
}

/**
 * Said by the bar that switches its backing from `useBarScrolled`, while it is mounted: switched
 * at the list's crossings by default, or a bar that backs itself (`'bar'`), which reports nothing.
 */
export function useManagesBar(enabled = true, by: Exclude<BarManager, null> = 'list'): void {
  const manage = use(BarScrolledContext)?.manage;
  useEffect(() => {
    if (!enabled || !manage) return;
    manage(by);
    return () => manage(null);
  }, [enabled, by, manage]);
}

/** Who switches the screen's bar, so the list's own edge is to be hidden; null for nobody. */
export function useBarManaged(): BarManager {
  return use(BarScrolledContext)?.managed ?? null;
}

/** Whether the screen's list is past the top; false outside a stack's screen. */
export function useBarScrolled(): boolean {
  return use(BarScrolledContext)?.scrolled ?? false;
}

/** The screen's reporter, for the view that holds its list; undefined outside a stack's screen. */
export function useReportBarScrolled(): ((scrolled: boolean) => void) | undefined {
  return use(BarScrolledContext)?.report;
}
