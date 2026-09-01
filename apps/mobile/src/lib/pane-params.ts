/**
 * Params for a screen that is being RENDERED as a pane rather than navigated to.
 *
 * A pane-rendered screen was never pushed, so `useLocalSearchParams` describes whatever route is
 * actually showing — the settings modal's `bridge-settings` would read the Browse tab's params, and
 * a series pane would read nothing at all. The pane supplies them instead, and `@/lib/nav`'s
 * `useLocalSearchParams` prefers this whenever it is set.
 *
 * Shared by both panes on purpose: they are the same problem, and a second copy would be a second
 * thing to remember when a screen learns to appear in either.
 */
import { createContext, useContext } from 'react';

export type PaneParams = Record<string, string | undefined>;

export const PaneParamsContext = createContext<PaneParams | null>(null);

export const usePaneParams = (): PaneParams | null => useContext(PaneParamsContext);
