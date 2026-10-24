/**
 * The four panes over a tab's content region, taken together — see `lib/pane-tab` for the keys.
 *
 * In stacking order they are the rail's search results and Browse's Search at the bottom, "See all"
 * over them, and the series over everything; what a tab's destination row clears when pressed on the
 * tab you are already on is all of them at once.
 */
import { useMemo } from 'react';

import { bridgeSearchPaneKeys, closeBridgeSearchPane, isBridgeSearchPaneOpen, useBridgeSearchPaneKeys } from '@/lib/bridge-search-pane';
import { activePaneTab } from '@/lib/pane-tab';
import { closeResultsPane, isResultsPaneOpen, resultsPaneKeys, useResultsPaneKeys } from '@/lib/results-pane';
import { closeSeriesPane, isSeriesPaneOpen, seriesPaneKeys, useSeriesPaneKeys } from '@/lib/series-pane';
import { closeSidebarSearch, isSidebarSearchOpen, sidebarSearchKeys, useSidebarSearchKeys } from '@/lib/sidebar-search';

/** Every pane of one key, the active one unless told otherwise. */
export function closeContentPanes(key: string = activePaneTab()): void {
  closeSeriesPane(key);
  closeResultsPane(key);
  closeSidebarSearch(key);
  closeBridgeSearchPane(key);
}

export function hasContentPanes(key: string): boolean {
  return isSeriesPaneOpen(key) || isResultsPaneOpen(key) || isSidebarSearchOpen(key) || isBridgeSearchPaneOpen(key);
}

/** Every key with any pane open, read outside render. */
export function openContentPaneKeys(): string[] {
  return union(seriesPaneKeys(), resultsPaneKeys(), sidebarSearchKeys(), bridgeSearchPaneKeys());
}

/** The same, subscribed — sorted, so the list is stable for the mounting loop that keys off it. */
export function useOpenContentPaneKeys(): string[] {
  const series = useSeriesPaneKeys();
  const results = useResultsPaneKeys();
  const searches = useSidebarSearchKeys();
  const bridgeSearches = useBridgeSearchPaneKeys();
  return useMemo(() => union(series, results, searches, bridgeSearches), [series, results, searches, bridgeSearches]);
}

function union(...lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}
