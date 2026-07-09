/**
 * A global "data epoch" counter. Screens fetch through `useDataSource()`, keying their effects on
 * the returned `ds`. That reference is otherwise stable, so a change that invalidates all data but
 * isn't a mock↔real switch — swapping the active transport (remote↔embedded) or editing the on-device
 * registry list — wouldn't otherwise re-run those effects. Bumping the epoch makes `useDataSource()`
 * hand back a fresh reference, so every mounted screen refetches.
 *
 * A Legend State observable (see `lib/observable.ts`) — in-memory only, no persistence.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

const epoch$ = observable(0);

/** Invalidate all data-source-backed screens (they refetch on their next render). */
export function bumpDataEpoch(): void {
  epoch$.set((n) => n + 1);
}

export function useDataEpoch(): number {
  return use$(epoch$);
}
