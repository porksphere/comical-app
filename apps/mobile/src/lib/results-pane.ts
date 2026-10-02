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
import { closeSeriesPane } from '@/lib/series-pane';

type ResultsPaneState = { available: boolean; params: PaneParams | null };

const resultsPane$ = observable<ResultsPaneState>({ available: false, params: null });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useResultsPaneOpen(): boolean {
  return use$(() => resultsPane$.params.get() !== null);
}

export function useResultsPaneParams(): PaneParams | null {
  return use$(resultsPane$.params);
}

/** Called by `AppTabs` with whether it is currently rendering a pane at all. */
export function setResultsPaneAvailable(available: boolean): void {
  resultsPane$.available.set(available);
  if (!available) resultsPane$.params.set(null);
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
  resultsPane$.params.set(params);
  return true;
}

export function closeResultsPane(): void {
  resultsPane$.params.set(null);
}
