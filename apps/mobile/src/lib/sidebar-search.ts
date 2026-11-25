/**
 * The desktop's search field and the results pane it opens over the content region.
 *
 * WEB ONLY, at the widths that show the sidebar. Search there is a field you stay beside rather
 * than a screen you go to: it stands at the end of every tab's bar (`ShellSearchField`), the results
 * cover the grid the way an open series does, and the field stays over them, so refining a search
 * never means finding your way back to it.
 *
 * `typed` is the field as it stands, `query` what was last submitted: the library answers from the
 * first as you type, every bridge from the second on Enter (see app/search). The pane is open while
 * either holds something, so emptying the field is how it closes.
 *
 * On Library, History and Activity what is typed NARROWS THE TAB IN PLACE instead (`useTabFilter`
 * reads it as the tab's filter), since the rows that answer it are already on screen, and the pane
 * waits for Enter. It is one field doing both: a filter field of the tab's own beside this one was
 * two search bars on one screen.
 */
import { observable } from '@legendapp/state';
import { use$, useSelector } from '@legendapp/state/react';

import { activePaneTab, paneKeyTab, usePaneTab } from '@/lib/pane-tab';

type Search = { typed: string; query: string };

const NO_SEARCH: Search = { typed: '', query: '' };

// A pending flag rather than a counter: a counter would refocus the field on every later remount too.
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
  return use$(() => isOpen(sidebarSearch$.searches[tab].get(), tab));
}

/** What is typed for `key`, read by a tab that narrows itself by it. */
export function useSidebarSearchTyped(key: string): string {
  return useSelector(() => sidebarSearch$.searches[key].get()?.typed ?? '');
}

function useFocusPending(): boolean {
  return use$(sidebarSearch$.focusPending);
}

export function isSidebarSearchOpen(tab = activePaneTab()): boolean {
  return isOpen(sidebarSearch$.searches[tab].peek(), tab);
}

const NARROWED_IN_PLACE = new Set(['library', 'history', 'activity']);

function isOpen(search: Search | undefined, key: string): boolean {
  if (!search) return false;
  return !!search.query || (!NARROWED_IN_PLACE.has(paneKeyTab(key)) && !!search.typed.trim());
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

/** Every tab's — for when the field itself goes away (a window too narrow for the sidebar). */
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
  return Object.keys(searches).filter((key) => isOpen(searches[key], key));
}
