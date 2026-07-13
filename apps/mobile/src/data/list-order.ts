/**
 * User-chosen ordering for bridges and trackers — a device-local preference (like `nsfw` /
 * reader-settings), so the same order drives every surface that lists them: the Browse bridge
 * selector, the Bridges page, and (later) the tracker selector.
 *
 * Each store is an **ordered array of ids**. `applyOrder` sorts any `{id}`-bearing list by it, so a
 * newly installed bridge (an id not yet in the array) falls to the end in its natural order and a
 * removed one simply drops out — the array is a preference layered over the live list, never the
 * source of truth for which bridges exist. Reordering the UI writes the full new id order back.
 */
import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

const bridgeOrder$ = persisted$<string[]>('comical:bridgeOrder', []);
const trackerOrder$ = persisted$<string[]>('comical:trackerOrder', []);

/**
 * Return `items` sorted by the saved `order` (an id list). Items whose id is in `order` come first,
 * in that order; the rest keep their incoming (server/discovery) order at the end — so a just-added
 * bridge appears without needing an explicit position. Stable and non-mutating.
 */
export function applyOrder<T>(items: T[], order: string[], idOf: (item: T) => string): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
      if (a.r !== undefined) return -1; // ranked before unranked
      if (b.r !== undefined) return 1;
      return a.i - b.i; // both unranked → preserve original order
    })
    .map((x) => x.item);
}

/** Reactive saved bridge order. Isolated (like `useSelectedBridgeId`) so `use$` is the whole body —
 *  the React Compiler doesn't recognise `use$` as a hook, so it must not precede another hook. */
export function useBridgeOrder(): string[] {
  return use$(bridgeOrder$);
}
export function setBridgeOrder(ids: string[]): void {
  bridgeOrder$.set(ids);
}

export function useTrackerOrder(): string[] {
  return use$(trackerOrder$);
}
export function setTrackerOrder(ids: string[]): void {
  trackerOrder$.set(ids);
}
