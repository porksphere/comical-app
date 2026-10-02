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

// A pending flag rather than a counter: the field may not exist when focus is asked for (the rail is
// collapsed, and expands to answer), and a counter would refocus it on every later remount too.
type SidebarSearchState = { typed: string; query: string; focusPending: boolean };

const sidebarSearch$ = observable<SidebarSearchState>({ typed: '', query: '', focusPending: false });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useSidebarSearch(): SidebarSearchState {
  return use$(sidebarSearch$);
}

export function useSidebarSearchOpen(): boolean {
  return use$(() => !!sidebarSearch$.typed.get().trim() || !!sidebarSearch$.query.get());
}

export function setSidebarSearchTyped(typed: string): void {
  sidebarSearch$.typed.set(typed);
}

export function submitSidebarSearch(text: string): void {
  sidebarSearch$.assign({ typed: text, query: text.trim() });
}

export function closeSidebarSearch(): void {
  sidebarSearch$.assign({ typed: '', query: '' });
}

export function focusSidebarSearch(): void {
  sidebarSearch$.focusPending.set(true);
}

export function sidebarSearchFocused(): void {
  sidebarSearch$.focusPending.set(false);
}
