/**
 * The rail's search field and the results pane it opens over the content region.
 *
 * WEB ONLY, at the widths that show an expanded rail. Search there is a field you stay beside rather
 * than a screen you go to: the results cover the grid the way an open series does, and the rail —
 * the field included — stays lit beside them, so refining a search never means finding your way back
 * to it. Collapsed, there is no room for a field, so the rail's icon expands the rail to reach it.
 *
 * `typed` is the field as it stands, `query` what was last submitted: the library answers from the
 * first as you type, every bridge from the second on Enter (see app/search). The pane is open while
 * either holds something, so emptying the field is how it closes.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import { activePaneTab, usePaneTab } from '@/lib/pane-tab';

type Search = { typed: string; query: string };

const NO_SEARCH: Search = { typed: '', query: '' };

// A pending flag rather than a counter: the field may not exist when focus is asked for (the rail is
// collapsed, and expands to answer), and a counter would refocus it on every later remount too.
// `searches` has one entry per tab (see `lib/pane-tab`), so the field shows the search of the tab
// you are on, and each tab's results pane lists its own.
type SidebarSearchState = { searches: Record<string, Search>; focusPending: boolean };

const sidebarSearch$ = observable<SidebarSearchState>({ searches: {}, focusPending: false });

export function useSidebarSearch(): Search & { focusPending: boolean } {
  const search = useTabSearch(usePaneTab());
  const focusPending = useFocusPending();
  return { ...search, focusPending };
}

export function useSidebarSearchOpen(): boolean {
  return useTabSearchOpen(usePaneTab());
}

// `use`-prefixed wrappers, never a bare `use$` at a call site — see `sidebar-bridges.tsx` — and
// holding nothing BUT `use$` (see `useSeriesPaneParams`), so the tab comes in from the caller.

function useTabSearch(tab: string): Search {
  return use$(() => sidebarSearch$.searches[tab].get() ?? NO_SEARCH);
}

function useTabSearchOpen(tab: string): boolean {
  return use$(() => isOpen(sidebarSearch$.searches[tab].get()));
}

function useFocusPending(): boolean {
  return use$(sidebarSearch$.focusPending);
}

export function isSidebarSearchOpen(tab = activePaneTab()): boolean {
  return isOpen(sidebarSearch$.searches[tab].peek());
}

function isOpen(search: Search | undefined): boolean {
  return !!search && (!!search.typed.trim() || !!search.query);
}

export function setSidebarSearchTyped(typed: string): void {
  const tab = activePaneTab();
  sidebarSearch$.searches[tab].set({ ...(sidebarSearch$.searches[tab].peek() ?? NO_SEARCH), typed });
}

export function submitSidebarSearch(text: string): void {
  sidebarSearch$.searches[activePaneTab()].set({ typed: text, query: text.trim() });
}

export function closeSidebarSearch(tab = activePaneTab()): void {
  sidebarSearch$.searches[tab].set({ typed: '', query: '' });
}

/** Every tab's — for when the field itself goes away (a collapsed rail has none). */
export function clearSidebarSearches(): void {
  sidebarSearch$.searches.set({});
}

export function focusSidebarSearch(): void {
  sidebarSearch$.focusPending.set(true);
}

export function sidebarSearchFocused(): void {
  sidebarSearch$.focusPending.set(false);
}

/** Every key with a search up — what `AppTabs` mounts a pane for. */
export function sidebarSearchKeys(): string[] {
  return openKeys(sidebarSearch$.searches.peek());
}

/** A `use`-prefixed wrapper holding nothing but `use$` — see `useSeriesPaneParams`. */
export function useSidebarSearchKeys(): string[] {
  return use$(() => openKeys(sidebarSearch$.searches.get()));
}

function openKeys(searches: Record<string, Search>): string[] {
  return Object.keys(searches).filter((key) => isOpen(searches[key]));
}
