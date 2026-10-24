/**
 * Which tab — and which of its scopes — the content panes belong to.
 *
 * The rail stays lit beside an open pane, so switching tabs there is a press away while a series or
 * a search is still up — and what you opened on Browse is still Browse's when you come back to it,
 * the way a tab's pushed pages are on any tabbed app. So each tab keeps its own panes: every pane
 * store holds one entry per PANE KEY, `AppTabs` mounts the panes of every key with something open
 * and shows the active key's alone, and the hidden ones stay mounted so they come back with their
 * stacks, queries and scroll.
 *
 * A key is the tab's name alone for a tab with no scope (History, Activity), and `tab/scope` for one
 * the rail subdivides: Browse's bridges and Library's collections. A bridge is a sub-tab there — the
 * series you opened on one bridge is still that bridge's when you come back to it, exactly as it is
 * Browse's when you come back from History. The separator is safe: bridge ids are kebab-case with
 * dots (`BRIDGE_ID_PATTERN`) and collection ids are the server's, neither of which carries a slash.
 *
 * Imperative callers (the router guard, the desktop's back, the rail's field) act on the ACTIVE key;
 * a pane's own screen acts on the key it was mounted for, which it learns from `PaneTabContext`.
 *
 * Native never sees any of this: there are no panes there, and a pushed page covers the bar.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { createContext, useContext } from 'react';

const PANE_KEY_SEPARATOR = '/';

const paneTab$ = observable('browse');

/** Each tab's CURRENT key — the one its destination row leads to right now — published by
 *  `AppTabs`, which is the only place the tab's scope and the pane layout are both known. */
const tabKeys$ = observable<Record<string, string>>({});

export const PaneTabContext = createContext<string | null>(null);

/** The key of a tab at one of its scopes; the bare tab name for a tab that has none. */
export function paneKey(tab: string, scope?: string | null): string {
  return scope == null ? tab : `${tab}${PANE_KEY_SEPARATOR}${scope}`;
}

export function paneKeyTab(key: string): string {
  const at = key.indexOf(PANE_KEY_SEPARATOR);
  return at === -1 ? key : key.slice(0, at);
}

/** The scope part of a key, or null for a tab without one. */
export function paneKeyScope(key: string): string | null {
  const at = key.indexOf(PANE_KEY_SEPARATOR);
  return at === -1 ? null : key.slice(at + 1);
}

/** Called by `AppTabs` with the key the slot is showing — kept, not cleared, over a pushed screen. */
export function setPaneTab(key: string): void {
  paneTab$.set(key);
}

export function activePaneTab(): string {
  return paneTab$.peek();
}

/** Called by `AppTabs` whenever a tab's scope moves, so a press on a destination row can ask what
 *  that row currently leads to without knowing how the tab is scoped. */
export function setTabPaneKeys(keys: Record<string, string>): void {
  tabKeys$.set(keys);
}

/** The key a tab's destination row leads to right now — the tab name itself until published. */
export function paneKeyOf(tab: string): string {
  return tabKeys$[tab].peek() ?? tab;
}

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useActivePaneTab(): string {
  return use$(paneTab$);
}

/** The key whose panes this subtree belongs to: its own inside a pane, the active one elsewhere. */
export function usePaneTab(): string {
  const own = useContext(PaneTabContext);
  const active = useActivePaneTab();
  return own ?? active;
}

/** False inside a pane mounted for a key you aren't on — it is hidden, and must not answer input. */
export function usePaneTabLive(): boolean {
  const own = useContext(PaneTabContext);
  const active = useActivePaneTab();
  return own === null || own === active;
}

/** The same test, read outside render (subscriptions); `key` is the subtree's `PaneTabContext`. */
export function isPaneTabLive(key: string | null): boolean {
  return key === null || key === paneTab$.peek();
}
