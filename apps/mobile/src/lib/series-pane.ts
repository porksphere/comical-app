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
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

import type { PaneParams } from '@/lib/pane';

type SeriesPaneState = { available: boolean; params: PaneParams | null };

const seriesPane$ = observable<SeriesPaneState>({ available: false, params: null });

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useSeriesPane(): SeriesPaneState {
  return use$(seriesPane$);
}

/** Called by `AppTabs` with whether it is currently rendering a pane at all. */
export function setSeriesPaneAvailable(available: boolean): void {
  seriesPane$.available.set(available);
  if (!available) seriesPane$.params.set(null);
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
 */
export function openSeriesPane(params: PaneParams): boolean {
  if (!seriesPane$.available.peek()) return false;
  if (params.reader === '1' || params.seq === '1') {
    // …and the pane gives way rather than sitting behind it. At most ONE series page may be
    // mounted at a time — `registerDrillSeries` is a module singleton and the second page to mount
    // would take the handler off the first (see lib/series-nav) — so a reader route opening over an
    // open pane is not a layering question, it is two series pages.
    seriesPane$.params.set(null);
    return false;
  }
  seriesPane$.params.set(params);
  return true;
}

export function closeSeriesPane(): void {
  seriesPane$.params.set(null);
}
