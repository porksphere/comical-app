/**
 * Which tab the content panes belong to.
 *
 * The rail stays lit beside an open pane, so switching tabs there is a press away while a series or
 * a search is still up — and what you opened on Browse is still Browse's when you come back to it,
 * the way a tab's pushed pages are on any tabbed app. So each tab keeps its own panes: every pane
 * store holds one entry per tab, `AppTabs` mounts every tab's panes and shows the active tab's
 * alone, and the hidden ones stay mounted so they come back with their stacks, queries and scroll.
 *
 * Imperative callers (the router guard, the desktop's back, the rail's field) act on the ACTIVE tab;
 * a pane's own screen acts on the tab it was mounted for, which it learns from `PaneTabContext`.
 *
 * Native never sees any of this: there are no panes there, and a pushed page covers the bar.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { createContext, useContext } from 'react';

const paneTab$ = observable('browse');

export const PaneTabContext = createContext<string | null>(null);

/** Called by `AppTabs` with the tab the slot is showing — kept, not cleared, over a pushed screen. */
export function setPaneTab(tab: string): void {
  paneTab$.set(tab);
}

export function activePaneTab(): string {
  return paneTab$.peek();
}

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useActivePaneTab(): string {
  return use$(paneTab$);
}

/** The tab whose panes this subtree belongs to: its own inside a pane, the active one elsewhere. */
export function usePaneTab(): string {
  const own = useContext(PaneTabContext);
  const active = useActivePaneTab();
  return own ?? active;
}

/** False inside a pane mounted for a tab you aren't on — it is hidden, and must not answer input. */
export function usePaneTabLive(): boolean {
  const own = useContext(PaneTabContext);
  const active = useActivePaneTab();
  return own === null || own === active;
}

/** The same test, read outside render (subscriptions); `tab` is the subtree's `PaneTabContext`. */
export function isPaneTabLive(tab: string | null): boolean {
  return tab === null || tab === paneTab$.peek();
}
