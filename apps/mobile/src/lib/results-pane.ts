/**
 * A rail's "See all" as a pane over the content region rather than a full-screen route.
 *
 * The same layout, and the same reasons, as `lib/series-pane`: WEB ONLY, at the widths that show the
 * rail, with no URL of its own. A rail's full list is still somewhere you go FROM the page you were
 * browsing, so it covers that page and leaves the rail beside it lit.
 *
 * It stacks between the rail's search results and the series pane: "See all" on a search rail opens
 * over the results it came from, and a series opened from it opens over it, each back returning to
 * the layer below.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import type { PaneParams } from '@/lib/pane';
import { activePaneTab, usePaneTab } from '@/lib/pane-tab';
import { closeSeriesPane } from '@/lib/series-pane';

/** One entry per tab — see `lib/pane-tab`. */
type ResultsPaneState = { available: boolean; params: Record<string, PaneParams | null> };

const resultsPane$ = observable<ResultsPaneState>({ available: false, params: {} });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useResultsPaneOpen(): boolean {
  return useResultsPaneParams() !== null;
}

export function useResultsPaneParams(): PaneParams | null {
  return useTabParams(usePaneTab());
}

/** Nothing but `use$`, so the tab comes in from the caller — see `useSeriesPaneParams`. */
function useTabParams(tab: string): PaneParams | null {
  return use$(() => resultsPane$.params[tab].get() ?? null);
}

/** Called by `AppTabs` with whether it is currently rendering a pane at all. */
export function setResultsPaneAvailable(available: boolean): void {
  resultsPane$.available.set(available);
  if (!available) resultsPane$.params.set({});
}

/**
 * Show a rail's results in the pane, reporting whether the pane took them. False means there is no
 * pane — the caller navigates as it always did.
 *
 * Opened from a series page's own rails, the series pane gives way: it is the layer ABOVE this one,
 * so leaving it up would open the results somewhere nobody can see them.
 */
export function openResultsPane(params: PaneParams): boolean {
  if (!resultsPane$.available.peek()) return false;
  closeSeriesPane();
  resultsPane$.params[activePaneTab()].set(params);
  return true;
}

export function isResultsPaneOpen(tab = activePaneTab()): boolean {
  return (resultsPane$.params[tab].peek() ?? null) !== null;
}

export function closeResultsPane(tab = activePaneTab()): void {
  resultsPane$.params[tab].set(null);
}

/** Every key with results open — what `AppTabs` mounts a pane for. */
export function resultsPaneKeys(): string[] {
  return openKeys(resultsPane$.params.peek());
}

/** A `use`-prefixed wrapper holding nothing but `use$` — see `useSeriesPaneParams`. */
export function useResultsPaneKeys(): string[] {
  return use$(() => openKeys(resultsPane$.params.get()));
}

function openKeys(params: Record<string, PaneParams | null>): string[] {
  return Object.keys(params).filter((key) => params[key] != null);
}
