import { use$ } from '@legendapp/state/react';

import type { LibrarySort } from '@/data/api';
import type { CollectionFilter } from '@/data/queries';
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
