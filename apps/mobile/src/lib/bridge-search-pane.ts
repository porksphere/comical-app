/**
 * Search as a pane over the content region rather than a full-screen route — the Search screen
 * Browse's bar opens on its bridge, and a series page's tag opens on a tag.
 *
 * The same layout, and the same reasons, as `lib/results-pane`: WEB ONLY, at the widths that show the
 * rail, with no URL of its own. It is the rail's own search pane's twin — the same layer, the bottom
 * one, under "See all" and the series pane — so one search closes the other, and a series opened from
 * its results opens over it.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import { activePaneTab, usePaneTab } from '@/lib/pane-tab';
import { closeResultsPane } from '@/lib/results-pane';
import { closeSeriesPane } from '@/lib/series-pane';
import { closeSidebarSearch } from '@/lib/sidebar-search';

/** `open` has one entry per tab — see `lib/pane-tab`. */
const bridgeSearchPane$ = observable({ available: false, open: {} as Record<string, boolean> });

export function useBridgeSearchPaneOpen(): boolean {
  return useTabOpen(usePaneTab());
}

/** A `use`-prefixed wrapper holding nothing but `use$`, so the tab comes in from the caller — see
 *  `useSeriesPaneParams`. */
function useTabOpen(tab: string): boolean {
  return use$(() => !!bridgeSearchPane$.open[tab].get());
}

/** Called by `AppTabs` with whether it is currently rendering a pane at all. */
export function setBridgeSearchPaneAvailable(available: boolean): void {
  bridgeSearchPane$.available.set(available);
  if (!available) bridgeSearchPane$.open.set({});
}

/**
 * Show Search in the pane, reporting whether the pane took it. False means there is no pane — the
 * caller navigates as it always did.
 *
 * Already open, it stays mounted: the search intent that came with this open is answered by the
 * screen's own subscription, the way a pushed Search already on screen answers one.
 */
export function openBridgeSearchPane(): boolean {
  if (!bridgeSearchPane$.available.peek()) return false;
  closeSeriesPane();
  closeResultsPane();
  closeSidebarSearch();
  bridgeSearchPane$.open[activePaneTab()].set(true);
  return true;
}

export function isBridgeSearchPaneOpen(tab = activePaneTab()): boolean {
  return !!bridgeSearchPane$.open[tab].peek();
}

export function closeBridgeSearchPane(tab = activePaneTab()): void {
  bridgeSearchPane$.open[tab].set(false);
}

/** Every key with Search open — what `AppTabs` mounts a pane for. */
export function bridgeSearchPaneKeys(): string[] {
  return openKeys(bridgeSearchPane$.open.peek());
}

/** A `use`-prefixed wrapper holding nothing but `use$` — see `useSeriesPaneParams`. */
export function useBridgeSearchPaneKeys(): string[] {
  return use$(() => openKeys(bridgeSearchPane$.open.get()));
}

function openKeys(open: Record<string, boolean>): string[] {
  return Object.keys(open).filter((key) => open[key]);
}
