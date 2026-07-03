/**
 * A global "data epoch" counter. Screens fetch through `useDataSource()`, keying their effects on
 * the returned `ds`. That reference is otherwise stable, so a change that invalidates all data but
 * isn't a mock↔real switch — swapping the active transport (remote↔embedded) or editing the on-device
 * registry list — wouldn't otherwise re-run those effects. Bumping the epoch makes `useDataSource()`
 * hand back a fresh reference, so every mounted screen refetches.
 */
import { useSyncExternalStore } from 'react';

let epoch = 0;
const listeners = new Set<() => void>();

/** Invalidate all data-source-backed screens (they refetch on their next render). */
export function bumpDataEpoch(): void {
  epoch += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDataEpoch(): number {
  return useSyncExternalStore(subscribe, () => epoch, () => 0);
}
