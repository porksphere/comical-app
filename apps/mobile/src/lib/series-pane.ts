/**
 * The series page as a right-hand PANE rather than a full-screen route.
 *
 * WEB ONLY, and only at the widths that show the rail. A series is something you look at *from* a
 * grid — you open one, decide, and go back to the list you were reading — so covering the whole
 * window to show it makes the list you were browsing into something you have to navigate back to.
 * At rail widths there is room to keep both, and the browse grid simply narrows by the pane's width
 * the same way it already narrows by the rail's.
 *
 * The URL is deliberately NOT part of this. A pane is not a route: an addressable series would have
 * to be a route that renders inside the tabs' subtree, which is the change this exists to avoid.
 * Deep links still land on the full-screen route — nothing about `/series` changed — they just
 * aren't what a card produces at these widths.
 *
 * `available` is published by `AppTabs` rather than derived here because whether a pane exists is a
 * fact about what is MOUNTED, not about the viewport: `openSeriesPane` is called from
 * `@/lib/nav`'s router guard, outside React, where there is no width to read and no provider to
 * consult. It answers false on native and at every viewport below the rail's, which is what makes
 * the interception a no-op there rather than a branch at eleven call sites.
 *
 * One pane per TAB (see `lib/pane-tab`): the open functions act on the active tab's, the hooks on
 * the tab of the subtree that calls them.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import type { PaneParams } from '@/lib/pane';
import { activePaneTab, usePaneTab, usePaneTabLive } from '@/lib/pane-tab';

type SeriesPaneState = {
  available: boolean;
  params: Record<string, PaneParams | null>;
  /** How many full-screen series pages are open over the pane (see `coverSeriesPane`). */
  covered: number;
  /** `bridgeId:id` of the series on top of each tab's pane stack; null while a search is on top. */
  top: Record<string, string | null>;
};

const seriesPane$ = observable<SeriesPaneState>({ available: false, params: {}, covered: 0, top: {} });

export function useSeriesPaneParams(): PaneParams | null {
  return useTabParams(usePaneTab());
}

// The `use$` wrappers below hold nothing BUT `use$`: one with a real hook beside it gets compiled,
// and the compiler then memoizes the `use$` call out of the hook order. So the tab is read by the
// caller and passed in.

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
function useTabParams(tab: string): PaneParams | null {
  return use$(() => seriesPane$.params[tab].get() ?? null);
}

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useSeriesPaneAvailable(): boolean {
  return use$(seriesPane$.available);
}

/** Called by `AppTabs` with whether it is currently rendering a pane at all. */
export function setSeriesPaneAvailable(available: boolean): void {
  seriesPane$.available.set(available);
  if (!available) seriesPane$.params.set({});
}

/**
 * Show a series in the pane, reporting whether the pane took it. False means there is no pane —
 * the caller navigates as it always did.
 *
 * A navigation that opens straight into the READER is declined even when a pane is up. A reader is
 * the one thing on web that still wants the whole window: a page rendered 500pt wide is a page you
 * cannot read. That covers the History and Activity rows (`reader=1`), a collection tile's album
 * (`seq=1`), and the pane's OWN handover when you start reading in it — which is why that handover
 * is an ordinary push rather than a special exit.
 *
 * The pane stays MOUNTED under that reader rather than giving way to it, so closing the reader
 * comes back to the pane exactly as it was — every series and search stacked in it, with their
 * queries, filters and scroll. Covered, it answers nothing (see `coverSeriesPane`).
 */
export function openSeriesPane(params: PaneParams): boolean {
  if (!seriesPane$.available.peek()) return false;
  if (params.reader === '1' || params.seq === '1') return false;
  seriesPane$.params[activePaneTab()].set(params);
  return true;
}

export function isSeriesPaneOpen(tab = activePaneTab()): boolean {
  return (seriesPane$.params[tab].peek() ?? null) !== null;
}

export function closeSeriesPane(tab = activePaneTab()): void {
  seriesPane$.params[tab].set(null);
}

/**
 * Called by a full-screen series page while it is mounted. The pane beneath goes on rendering but
 * must stop ANSWERING — keys, search intents, drills — or the hidden page would act on input meant
 * for the one over it. Returns the uncover.
 */
export function coverSeriesPane(): () => void {
  seriesPane$.covered.set(seriesPane$.covered.peek() + 1);
  return () => seriesPane$.covered.set(seriesPane$.covered.peek() - 1);
}

/** Also true of a pane kept for a tab you aren't on: hidden is covered, by the same rule. */
export function useSeriesPaneCovered(): boolean {
  const live = usePaneTabLive();
  return useCoveredByPage() || !live;
}

function useCoveredByPage(): boolean {
  return use$(() => seriesPane$.covered.get() > 0);
}

export function isSeriesPaneCovered(): boolean {
  return seriesPane$.covered.peek() > 0;
}

/** Published by the pane's screen for the tab it was mounted for; returns the retraction. */
export function setSeriesPaneTop(tab: string, key: string | null): () => void {
  seriesPane$.top[tab].set(key);
  return () => {
    if (seriesPane$.top[tab].peek() === key) seriesPane$.top[tab].set(null);
  };
}

/**
 * Whether the pane beneath already shows this series on top — in which case a reader over it has
 * its details right underneath, and stepping back from the reader is leaving it.
 */
export function useSeriesPaneShowsTop(key: string): boolean {
  return useTabShowsTop(usePaneTab(), key);
}

function useTabShowsTop(tab: string, key: string): boolean {
  return use$(() => (seriesPane$.params[tab].get() ?? null) !== null && seriesPane$.top[tab].get() === key);
}

/** Every key with a series open — what `AppTabs` mounts a pane for. */
export function seriesPaneKeys(): string[] {
  return openKeys(seriesPane$.params.peek());
}

/** A `use`-prefixed wrapper holding nothing but `use$` — see `useSeriesPaneParams`. */
export function useSeriesPaneKeys(): string[] {
  return use$(() => openKeys(seriesPane$.params.get()));
}

function openKeys(params: Record<string, PaneParams | null>): string[] {
  return Object.keys(params).filter((key) => params[key] != null);
}
