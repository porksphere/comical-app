import { use$ } from '@legendapp/state/react';

import type { LibrarySort } from '@/data/api';
import type { LibraryGrouping } from '@/data/library-grouping';
import type { CollectionFilter } from '@/data/queries';
import type { ReadState } from '@/data/types';
import { persisted$ } from '@/lib/observable';

/**
 * The Library tab's sort choice, remembered **per collection** and persisted to AsyncStorage — so
 * each collection (and the default "Library" view) keeps its own last-used ordering across switches
 * and app restarts. Stored as a `{ collectionKey → sort }` map under one key; `null` (all entries)
 * maps to `'all'`. Unknown keys fall back to `DEFAULT_SORT`.
 *
 * Keeps its original AsyncStorage key so the "all" view's remembered sort survives the lists →
 * collections migration. Entries keyed by long-dead list ids are inert and just fall back.
 */
const DEFAULT_SORT: LibrarySort = 'added';
const sortByCollection$ = persisted$<Record<string, LibrarySort>>('comical:librarySortByList', {});

const keyFor = (collection: CollectionFilter): string => collection ?? 'all';

/** `[sort, setSort]` for the given collection filter. `setSort` records the choice for *that*
 *  collection only.
 *  Writes REPLACE the whole record (new reference) so `use$` subscribers re-render immediately — a
 *  nested `store$[key].set()` can leave the root snapshot's identity unchanged (see comical-home). */
export function useLibrarySort(collection: CollectionFilter): [LibrarySort, (sort: LibrarySort) => void] {
  const map = use$(sortByCollection$);
  const key = keyFor(collection);
  const sort = map[key] ?? DEFAULT_SORT;
  const setSort = (next: LibrarySort) =>
    sortByCollection$.set({ ...sortByCollection$.peek(), [key]: next });
  return [sort, setSort];
}

/** The series views' GROUPING choice, persisted. One value for every view (not per-collection like
 *  the sort): how you like series sectioned doesn't depend on which shelf they're on. */
const libraryGrouping$ = persisted$<LibraryGrouping>('comical:libraryGrouping', 'none');

export function useLibraryGrouping(): [LibraryGrouping, (g: LibraryGrouping) => void] {
  const grouping = use$(libraryGrouping$);
  return [grouping, (next) => libraryGrouping$.set(next)];
}

/** The series views' "Show" filter — one derived reading state, or `'all'`. One value for every
 *  view, like the grouping. A string rather than `null` for "all" so the persisted value is never a
 *  falsy/nullish primitive. */
export type LibraryShow = ReadState | 'all';
const libraryShow$ = persisted$<LibraryShow>('comical:libraryShow', 'all');

export function useLibraryShow(): [LibraryShow, (s: LibraryShow) => void] {
  const show = use$(libraryShow$);
  return [show, (next) => libraryShow$.set(next)];
}

/** The Library's source filter — one bridge id, or `'all'`. Shared by every view and kind, like the
 *  Show filter: narrowing to a source is about which source you're reading, not which shelf. */
export type LibraryBridge = string;
export const ALL_BRIDGES: LibraryBridge = 'all';
const libraryBridge$ = persisted$<LibraryBridge>('comical:libraryBridge', ALL_BRIDGES);

export function useLibraryBridge(): [LibraryBridge, (b: LibraryBridge) => void] {
  const bridge = use$(libraryBridge$);
  return [bridge, (next) => libraryBridge$.set(next)];
}

export function onlyBridge<T extends { bridgeId: string }>(items: T[], bridge: LibraryBridge): T[] {
  return bridge === ALL_BRIDGES ? items : items.filter((i) => i.bridgeId === bridge);
}
