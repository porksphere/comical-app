import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** The three things that can be filed into a collection. Mirrors `CollectionItemType`. */
export type CollectedType = 'series' | 'chapter' | 'page';

/**
 * The collection each item TYPE was last filed into, so a one-tap save has somewhere to go —
 * the Google Maps "Save" behaviour: tapping saves to wherever you last saved that kind of thing,
 * and a long press opens the picker to choose.
 *
 * Kept **per type** deliberately: the collection you file pages into ("panels I like") is rarely the
 * one you file series into ("reading next"), so one shared last-used would send half your taps to
 * the wrong place.
 *
 * Device-local UI preference, not server data — Legend State, not the query cache. The stored id can
 * go stale (the collection was deleted, or the app is pointed at a different server), so every read
 * has to be validated against the live collection list; `resolveLastCollection` does that, and a
 * miss means "ask the user" rather than "invent a collection".
 */
const lastByType$ = persisted$<Partial<Record<CollectedType, string>>>('comical:lastCollectionByType', {});

/** The remembered collection id for a type, or `undefined`. NOT validated — see `resolveLastCollection`. */
export function useLastCollectionId(type: CollectedType): string | undefined {
  return use$(lastByType$)[type];
}

/** Remember where this type was last filed. Writes REPLACE the whole record (new reference) so
 *  `use$` subscribers re-render — a nested set can leave the root snapshot's identity unchanged. */
export function setLastCollectionId(type: CollectedType, collectionId: string): void {
  lastByType$.set({ ...lastByType$.peek(), [type]: collectionId });
}

/** Read outside React (inside a mutation), non-tracking. */
export function peekLastCollectionId(type: CollectedType): string | undefined {
  return lastByType$.peek()[type];
}

/**
 * The collection a one-tap save should file this type into, or `undefined` when there isn't one —
 * either nothing has been filed yet, or the remembered collection has since been deleted.
 *
 * `undefined` is a real answer, not a failure: the caller opens the picker instead of inventing a
 * collection. Nothing is auto-created, so the user's collection list only ever contains collections
 * they made themselves.
 */
export function resolveLastCollection(
  type: CollectedType,
  collections: { id: string }[],
): string | undefined {
  const remembered = peekLastCollectionId(type);
  if (remembered && collections.some((c) => c.id === remembered)) return remembered;
  return undefined;
}
