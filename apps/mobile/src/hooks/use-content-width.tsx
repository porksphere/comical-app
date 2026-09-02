/**
 * The width a screen actually has to lay content out in.
 *
 * The window's width is not that number once the sidebar exists. `app-tabs` reserves the rail with
 * a `paddingLeft` on `TabSlot` (it has to — the slot must stay a direct child of `Tabs`, so the rail
 * can't be a sibling column in a row), and padding is invisible to the descendants that size
 * themselves: a grid dividing `useWindowDimensions().width` into columns lays out cards for the
 * whole window and is then pushed right by the rail, overhanging the viewport by its width. That
 * was the bug — 224pt of the last column past the right edge at 1180.
 *
 * Why a context rather than `width - navInsetFor(width)` at each call site: whether a screen sits
 * inside the inset region is a fact about WHERE it is, not about how wide the window is. Only the
 * tab screens are inside it — search, results, series and the settings stack are siblings of
 * `(tabs)` in the root stack and cover the rail — so a width-only derivation would be wrong for
 * every one of them, and `useGridLayout` is shared by both kinds. The provider wraps exactly the
 * subtree that is inset, and the default is the window, so a screen outside it needs no opt-out.
 *
 * This is layout geometry read during render, not client state — it is not a fourth home for
 * preferences, and `ZoomSurfaceContext` is the same shape for the same reason.
 */
import { createContext, useContext, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

type NavLayout = {
  /** The width left for content after the rail. */
  contentWidth: number;
  /** Whether the rail is the nav for this subtree — the same latch that reserved the space, never
   *  re-derived from width downstream (see `navInsetFor`). A screen asks this to decide whether a
   *  control of its own is now a duplicate of one the rail is already showing. */
  sidebar: boolean;
};

const NavLayoutContext = createContext<NavLayout | null>(null);

export function ContentWidthProvider({
  width,
  sidebar,
  children,
}: {
  width: number;
  sidebar: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ contentWidth: width, sidebar }), [width, sidebar]);
  return <NavLayoutContext.Provider value={value}>{children}</NavLayoutContext.Provider>;
}

/** The window's width outside a provider, the inset content column inside one. */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return useContext(NavLayoutContext)?.contentWidth ?? width;
}

/** True only where the rail is actually rendered — false on every screen that covers it. */
export function useHasSidebar(): boolean {
  return useContext(NavLayoutContext)?.sidebar ?? false;
}
