import { observable } from '@legendapp/state';
import { useSyncExternalStore } from 'react';
import { makeMutable } from 'react-native-reanimated';

import type { SeriesEntry } from '@/data/types';

/** On-screen rect of the pressed card (window coords, from `measureInWindow`). */
export type CardRect = { x: number; y: number; width: number; height: number };

export type SeriesCardMenuRequest = {
  entry: SeriesEntry;
  bridgeId: string;
  /** The bridge's display name — carried so a tapped tag can drive a Browse search on that bridge. */
  bridge?: string;
  /** Whether the bridge serves "direct" (chapterless, page-thumbnail) series — the preview shows a
   *  horizontal page-thumbnail rail for these. */
  direct?: boolean;
  /** The cover's real (capped) aspect ratio, so the lifted preview matches the card's shape. */
  coverAspect?: number;
  /** The VISUAL corner radius the lifted preview STARTS at, so it matches the source it lifts from (a
   *  card cover is 10; a smaller thumbnail like History's is 6). It morphs to the resting radius (10)
   *  as the preview opens. Defaults to 10. */
  startRadius?: number;
  rect: CardRect;
  /** Called when the menu finishes closing — the source card uses it to un-hide itself (it hides
   *  while the menu is open so it doesn't show behind the lifted preview). */
  onClose?: () => void;
};

/**
 * The currently-open native card context menu (the iOS/X-style hold-down), or null. In-memory local
 * UI state (Legend State, per the app's state split) — a single root-mounted host
 * (`SeriesCardContextMenuHost`) renders it, and any card opens it on long-press. Kept out of the
 * generic overlay because it's a bespoke presentation (dimmed backdrop + lifted card preview + menu),
 * not a sheet/popover.
 */
export const seriesCardMenu$ = observable<SeriesCardMenuRequest | null>(null);

export function openSeriesCardMenu(req: SeriesCardMenuRequest): void {
  seriesCardMenu$.set(req);
}

export function closeSeriesCardMenu(): void {
  seriesCardMenu$.set(null);
}

/**
 * Reactive read of the open request, via `useSyncExternalStore` — NOT a bare `use$(seriesCardMenu$)`
 * in the host. A bare `use$` call isn't recognized as a hook (name isn't `useX`), so under React
 * Compiler it gets memoized and the host never re-renders when the store is set — the long-press
 * fired but no menu appeared. `useSyncExternalStore` is a real, compiler-recognized hook.
 */
export function useSeriesCardMenu(): SeriesCardMenuRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => seriesCardMenu$.onChange(onStoreChange),
    () => seriesCardMenu$.peek(),
    () => seriesCardMenu$.peek(),
  );
}

// ── Peek and commit (the iOS hold-down) ──────────────────────────────────────
/**
 * Keep holding after the menu opens, slide onto a row, lift to run it — without ever releasing the
 * finger you long-pressed with.
 *
 * This has to live in a module, and it has to be shared values, because of who owns the touch: the
 * finger is still held down inside the CARD's gesture (`series-card-menu.tsx`), and a root overlay
 * that mounts mid-touch can never be handed an in-flight one. So the card's gesture keeps reporting
 * the finger, and the popup — which knows where its rows are — reads it and decides what's under it.
 * The two never meet; they only share these values.
 *
 * All UI-thread: the card writes `holdPoint` from its gesture worklet, the popup reacts on the UI
 * thread and writes back `hoveredRow`, and the card reads THAT back when the finger lifts to decide
 * what to run. Nothing round-trips through JS until something is actually chosen.
 */
export const holdActive = makeMutable(false);
export const holdX = makeMutable(0);
export const holdY = makeMutable(0);
/**
 * Whether the hold has MOVED enough to be picking something.
 *
 * Selection stays dormant until the finger has actually travelled (see HOLD_ARM_DISTANCE). Without
 * this, a plain long-press-and-release — the way you open the menu just to look at it — lifts over
 * whatever row happened to be under your thumb and runs it. You'd have chosen something by doing
 * nothing. Arming on movement means picking a row is always a deliberate act: you have to reach for it.
 *
 * Latching, not a live test: once you've reached, small jitter mustn't disarm you mid-pick.
 */
export const holdArmed = makeMutable(false);
/** How far the held finger must travel before it starts selecting anything (px). Deliberately well
 *  past a touch-slop: this is the line between "resting on the card" and "reaching for a row", and
 *  it's cheap to be generous — you're going to travel a long way to the row you actually want. */
export const HOLD_ARM_DISTANCE = 32;
/** Index of the menu row the held finger is currently over, or -1. Written by the popup. */
export const hoveredRow = makeMutable(-1);

/** What each row does, in render order — registered by the popup so a lift can run the right one. */
let rowActions: (() => void)[] = [];
export function setMenuRowActions(actions: (() => void)[]): void {
  rowActions = actions;
}

/** Called on release of the original long-press. Runs the row the finger was over, if any. */
export function commitHoveredRow(index: number): void {
  const action = rowActions[index];
  if (action) action();
}
