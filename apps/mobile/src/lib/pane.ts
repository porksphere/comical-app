/**
 * A screen that is being RENDERED as a pane rather than navigated to.
 *
 * Two surfaces do this — the settings modal and the series pane — and they hit the same two
 * problems, so the contracts live here rather than being copied into each.
 *
 * - **Params.** A pane-rendered screen was never pushed, so `useLocalSearchParams` describes
 *   whatever route is actually showing: the settings modal's `bridge-settings` would read the
 *   Browse tab's params, and a series pane would read nothing at all. The pane supplies them, and
 *   `@/lib/nav`'s `useLocalSearchParams` prefers this whenever it is set.
 * - **Navigation.** A push from inside a pane must stay inside it where the pane can render the
 *   target, and a `back` must unwind the pane rather than the app underneath it. The pane gets
 *   first refusal on both; anything it declines goes to the router as usual.
 */
import { createContext, useContext } from 'react';

export type PaneParams = Record<string, string | undefined>;

export const PaneParamsContext = createContext<PaneParams | null>(null);

export const usePaneParams = (): PaneParams | null => useContext(PaneParamsContext);

export type PaneNav = {
  /** Returns true when the pane took the navigation, false to let it go to the router. */
  push: (pathname: string, params: PaneParams) => boolean;
  /** Returns true when the pane popped something, false to let `back` reach the router. */
  back: () => boolean;
  /**
   * Whether `back` has anything to do — folded into the router's `canGoBack`.
   *
   * Not a detail: screens ask before they go, and the honest answer differs from the router's. A
   * pane opened from the grid sits on a history entry that never moved, so the real router says
   * there is nowhere to go back to and the caller does something else instead — the series page
   * replaces the route with `/`, which is the whole tab tree reloading behind a pane that never
   * closed.
   */
  canGoBack: () => boolean;
};

export const PaneNavContext = createContext<PaneNav | null>(null);

export const usePaneNav = (): PaneNav | null => useContext(PaneNavContext);
