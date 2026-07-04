/**
 * A one-shot "search intent" handed from the Series screen to the Browse tab.
 *
 * Tapping a tag chip on a series should drop Browse into a matching search — but
 * Browse is a separate, already-mounted tab route with its own local state, so we
 * can't pass this as route params to a fresh mount. Instead the Series screen
 * stashes the intent here and navigates to the Browse tab, which subscribes (via
 * `useSyncExternalStore` — the app's shared-module-state pattern) and adopts it.
 *
 * Two shapes, mirroring comical-web's tag chips (app.ts `navigateToQuerySearch` /
 * `navigateToFilteredSearch`): a `query` intent runs a free-text search — for
 * bridges whose tag groups carry `tagQueries` (e.g. example-source); a `tag` intent
 * selects the bridge's tag-multiselect filter by `filterKey` — for bridges whose
 * tag groups carry `tagIds` (e.g. example-bridge's `key: "tag"` filter).
 */
import { useSyncExternalStore } from 'react';

export type BrowseIntent = { bridgeName: string; bridgeId: string } & (
  | { kind: 'query'; query: string }
  | { kind: 'tag'; filterKey: string; tagId: string; label: string }
);

let current: BrowseIntent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Stash an intent and notify the Browse tab (if mounted). */
export function setBrowseIntent(intent: BrowseIntent): void {
  current = intent;
  notify();
}

/** Clear the pending intent — called by Browse once it has adopted it. */
export function clearBrowseIntent(): void {
  if (!current) return;
  current = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot(): BrowseIntent | null {
  return current;
}

/** The pending browse intent, or `null`. Re-renders the caller when it changes. */
export function useBrowseIntent(): BrowseIntent | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
