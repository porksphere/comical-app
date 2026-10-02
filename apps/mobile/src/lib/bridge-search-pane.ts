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

import { closeResultsPane } from '@/lib/results-pane';
import { closeSeriesPane } from '@/lib/series-pane';
import { closeSidebarSearch } from '@/lib/sidebar-search';

const bridgeSearchPane$ = observable({ available: false, open: false });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useBridgeSearchPaneOpen(): boolean {
  return use$(bridgeSearchPane$.open);
}

/** Called by `AppTabs` with whether it is currently rendering a pane at all. */
export function setBridgeSearchPaneAvailable(available: boolean): void {
  bridgeSearchPane$.available.set(available);
  if (!available) bridgeSearchPane$.open.set(false);
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
  bridgeSearchPane$.open.set(true);
  return true;
}

export function closeBridgeSearchPane(): void {
  bridgeSearchPane$.open.set(false);
}
