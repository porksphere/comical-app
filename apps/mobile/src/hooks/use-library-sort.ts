import { observable } from '@legendapp/state';
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
/** The Library's sort choices: the server's orders plus `'random'`, which the app applies itself
 *  (see `shuffleLibrary`) over a server fetch in `serverSort` order. */
export type LibraryViewSort = LibrarySort | 'random';

const DEFAULT_SORT: LibraryViewSort = 'added';
const sortByCollection$ = persisted$<Record<string, LibraryViewSort>>('comical:librarySortByList', {});

/** The random order's seed. Deliberately NOT persisted: each launch deals a fresh order, and picking
 *  Random again (even while it's already the sort) deals another. */
const newSeed = () => Math.floor(Math.random() * 0x100000000);
const shuffleSeed$ = observable(newSeed());

const keyFor = (collection: CollectionFilter): string => collection ?? 'all';

/** `[sort, setSort]` for the given collection filter. `setSort` records the choice for *that*
 *  collection only.
 *  Writes REPLACE the whole record (new reference) so `use$` subscribers re-render immediately — a
 *  nested `store$[key].set()` can leave the root snapshot's identity unchanged (see comical-home). */
export function useLibrarySort(collection: CollectionFilter): [LibraryViewSort, (sort: LibraryViewSort) => void] {
  const map = use$(sortByCollection$);
  const key = keyFor(collection);
  const sort = map[key] ?? DEFAULT_SORT;
  const setSort = (next: LibraryViewSort) => {
    if (next === 'random') shuffleSeed$.set(newSeed());
    sortByCollection$.set({ ...sortByCollection$.peek(), [key]: next });
  };
  return [sort, setSort];
}

/** The order to fetch in for a view sort. Random shuffles over `added` — any stable order would do,
 *  and sharing one keeps a single cached query for it. */
export const serverSort = (sort: LibraryViewSort): LibrarySort => (sort === 'random' ? 'added' : sort);

export function useShuffleSeed(): number {
  return use$(shuffleSeed$);
}

/**
 * `items` in the seed's random order. Each series sorts by a hash of (seed, identity) rather than a
 * Fisher–Yates pass over the list, so the order is a property of the series, not of its neighbours:
 * a refetch, a filter, or a series joining or leaving never reshuffles the rest.
 */
export function shuffleLibrary<T extends { bridgeId: string; seriesId: string }>(items: T[], seed: number): T[] {
  const rank = new Map(items.map((i) => [i, hash32(`${i.bridgeId}/${i.seriesId}`, seed)]));
  return [...items].sort((a, b) => rank.get(a)! - rank.get(b)!);
}

/** FNV-1a over the string, seeded, with a final avalanche so near-identical ids scatter. */
function hash32(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The series views' GROUPING choice, persisted. One value for every view (not per-collection like
 *  the sort): how you like series sectioned doesn't depend on which shelf they're on. */
const libraryGrouping$ = persisted$<LibraryGrouping>('comical:libraryGrouping', 'none');

export function useLibraryGrouping(): [LibraryGrouping, (g: LibraryGrouping) => void] {
  const grouping = use$(libraryGrouping$);
  return [grouping, (next) => libraryGrouping$.set(next)];
}

/** Every reading state, in the order the filter lists them. */
export const READ_STATES: readonly ReadState[] = ['unstarted', 'behind', 'caught-up', 'finished'];

/** The series views' "Show" filter — the reading states to keep, empty for every one. One value for
 *  every view, like the grouping. */
const libraryShow$ = persisted$<ReadState[]>('comical:libraryShowStates', []);

export function useLibraryShow(): ReadState[] {
  return use$(libraryShow$);
}

export function clearLibraryShow() {
  libraryShow$.set([]);
}

export function toggleLibraryShow(state: ReadState) {
  const next = toggled(libraryShow$.peek(), state);
  // Every state ticked is no filter at all, and is shown as one — "Everything" takes the check.
  libraryShow$.set(next.length === READ_STATES.length ? [] : READ_STATES.filter((s) => next.includes(s)));
}

export function onlyReadStates<T extends { readState: ReadState }>(items: T[], states: readonly ReadState[]): T[] {
  return states.length ? items.filter((i) => states.includes(i.readState)) : items;
}

/** The series views' "removed from its source" filter. An object, not a bare boolean — see
 *  `lightCards$` for why a persisted `false` crashes. */
const libraryRemovedOnly$ = persisted$('comical:libraryRemovedOnly', { on: false });

export function useLibraryRemovedOnly(): boolean {
  return use$(libraryRemovedOnly$).on;
}

export function setLibraryRemovedOnly(on: boolean) {
  libraryRemovedOnly$.set({ on });
}

export function onlyRemoved<T extends { removed?: boolean }>(items: T[], removedOnly: boolean): T[] {
  return removedOnly ? items.filter((i) => i.removed) : items;
}

/** The Library's source filter — the bridge ids to keep, empty for every source. Shared by every
 *  view and kind, like the Show filter: narrowing to sources is about what you're reading, not which
 *  shelf. Unlike the states, ticking every source on offer is NOT normalised to "all": the next
 *  bridge installed would be filtered out of a library it was never excluded from on purpose. */
const libraryBridges$ = persisted$<string[]>('comical:libraryBridges', []);

export function useLibraryBridges(): string[] {
  return use$(libraryBridges$);
}

export function clearLibraryBridges() {
  libraryBridges$.set([]);
}

export function toggleLibraryBridge(bridgeId: string) {
  libraryBridges$.set(toggled(libraryBridges$.peek(), bridgeId).sort());
}

export function onlyBridges<T extends { bridgeId: string }>(items: T[], bridges: readonly string[]): T[] {
  return bridges.length ? items.filter((i) => bridges.includes(i.bridgeId)) : items;
}

const toggled = <T>(set: readonly T[], value: T): T[] =>
  set.includes(value) ? set.filter((v) => v !== value) : [...set, value];
