import { useSyncExternalStore } from 'react';

import type { FilterDef, FilterValue } from '@/components/filters/filter-types';

/**
 * The search filters, handed to the `/search-filters` form sheet on iOS.
 *
 * The sheet is a system-presented modal in the ROOT stack: it cannot reach the Search screen's
 * state through context, and it cannot use the root overlays either — a native sheet is its own
 * view controller, and the app-root overlay host renders behind it. So the screen that opens it
 * publishes its filters here and keeps them current while the sheet is up, and the sheet reads
 * them and writes back through `onChange`. The same shape as `search-intent.ts` — a one-slot
 * module store with a subscription — and not a Legend observable, because it carries callbacks.
 *
 * `owner` is the publishing screen instance: per-tab pushes can leave several Search screens
 * mounted, and only the one that opened the sheet may update or clear what it shows.
 */
export type FilterSheetSession = {
  defs: FilterDef[];
  values: Record<string, FilterValue>;
  onChange: (id: string, v: FilterValue) => void;
  onReset: () => void;
};

let owner: object | null = null;
let session: FilterSheetSession | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

/** Publish `next` and take ownership of the slot — called by the screen as it pushes the sheet. */
export function openFilterSheetSession(by: object, next: FilterSheetSession): void {
  owner = by;
  session = next;
  notify();
}

/** Replace the published session, if `by` still owns it. */
export function updateFilterSheetSession(by: object, next: FilterSheetSession): void {
  if (owner !== by) return;
  session = next;
  notify();
}

/** Clear the slot, if `by` owns it — the screen on unmount. */
export function closeFilterSheetSession(by: object): void {
  if (owner !== by) return;
  owner = null;
  session = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSession(): FilterSheetSession | null {
  return session;
}

/** The published session, or null when no Search screen has one up. */
export function useFilterSheetSession(): FilterSheetSession | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}
