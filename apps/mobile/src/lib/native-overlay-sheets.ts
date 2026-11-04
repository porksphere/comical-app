import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { reportStuck } from '@/lib/pushback-watchdog';

/**
 * The overlay stack's items as system form sheets, on iOS.
 *
 * The shared overlay system (components/overlay/overlay) draws its own bottom sheet everywhere
 * else. On iOS each item is presented by UIKit instead: `OverlayProvider` keeps the item in its
 * stack, so `topId`, `closeTop` and a trigger's toggle work as they always have, and hands its
 * content here; the `/overlay-sheet` route (app/overlay-sheet) renders it inside a native sheet.
 * A sheet is its own view controller, so the content cannot be passed down as a prop or through
 * context — the route reads it from this map by id, as the search filters sheet reads its own
 * one-slot store (data/filter-sheet).
 *
 * Either side can end it. Closing from JS (`closeTop`, a pick that closes its menu) asks the route
 * to pop itself; the user swiping the sheet away pops it natively. Both end the same way, with the
 * route unmounting, which is what removes the item from the stack.
 */
export const NATIVE_OVERLAY_SHEETS = Platform.OS === 'ios';

type Sheet = {
  node: ReactNode;
  /** Takes the item out of the overlay stack. */
  onGone: () => void;
  /** Pops the route; null until the route has mounted. */
  close: (() => void) | null;
  closeAsked: boolean;
  backstop: ReturnType<typeof setTimeout> | null;
  /** The route's unmount, held a tick so StrictMode's remount can take it back. */
  leaving: ReturnType<typeof setTimeout> | null;
};

const sheets = new Map<number, Sheet>();

// A route that has not mounted by now was never pushed. The item is dropped rather than left in the
// stack, where it would read as open for good: a trigger toggling it shut, the reader holding its
// chrome up.
const MOUNT_BACKSTOP_MS = 2000;

/** Registers an item's content, before its route is pushed. */
export function holdNativeSheet(id: number, node: ReactNode, onGone: () => void): void {
  const backstop = setTimeout(() => {
    const sheet = sheets.get(id);
    if (!sheet || sheet.close) return;
    reportStuck('overlay-native-sheet', `sheet ${id} never mounted after ${MOUNT_BACKSTOP_MS}ms — dropped`);
    gone(id);
  }, MOUNT_BACKSTOP_MS);
  sheets.set(id, { node, onGone, close: null, closeAsked: false, backstop, leaving: null });
}

// Form sheets of the app's own (`/reader-settings`), counted beside the overlay items.
let formSheets = 0;

/**
 * Counts a form sheet route as a system sheet until the returned release is called. Taken BEFORE
 * its push: the blur the push causes is when the screen under it asks `isNativeSheetUp`.
 */
export function holdSystemSheet(): () => void {
  formSheets += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    formSheets -= 1;
  };
}

/**
 * Whether a system sheet is up, an overlay item's or a form sheet route. Pushing one blurs the
 * screen it covers, and a screen that acts on its blur (the reader giving the tab bar back) asks
 * this to tell a sheet from leaving.
 */
export function isNativeSheetUp(): boolean {
  return sheets.size > 0 || formSheets > 0;
}

/** The content of sheet `id`, or undefined when there is none (a stale route). */
export function nativeSheetContent(id: number): ReactNode | undefined {
  return sheets.get(id)?.node;
}

/**
 * The route, on mount: how to pop it. Returns its unmount. A route with nothing to show pops at
 * once, and one whose close was asked for before it mounted (a trigger pressed twice) pops too.
 */
export function attachNativeSheet(id: number, close: () => void): () => void {
  const sheet = sheets.get(id);
  if (!sheet) {
    close();
    return () => {};
  }
  if (sheet.backstop) clearTimeout(sheet.backstop);
  if (sheet.leaving) clearTimeout(sheet.leaving);
  sheet.backstop = null;
  sheet.leaving = null;
  sheet.close = close;
  if (sheet.closeAsked) close();
  return () => {
    sheet.leaving = setTimeout(() => gone(id), 0);
  };
}

/** Closes sheet `id` from JS: the overlay stack's closer for it. */
export function closeNativeSheet(id: number): void {
  const sheet = sheets.get(id);
  if (!sheet || sheet.closeAsked) return;
  sheet.closeAsked = true;
  sheet.close?.();
}

function gone(id: number): void {
  const sheet = sheets.get(id);
  if (!sheet) return;
  if (sheet.backstop) clearTimeout(sheet.backstop);
  sheets.delete(id);
  sheet.onGone();
}
