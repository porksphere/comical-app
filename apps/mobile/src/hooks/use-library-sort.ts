import { use$ } from '@legendapp/state/react';

import type { LibrarySort } from '@/data/api';
import type { LibraryListFilter } from '@/data/queries';
import { persisted$ } from '@/lib/observable';

/**
 * The Library tab's sort choice, remembered **per list** and persisted to AsyncStorage — so each
 * custom list (and the default "Library" view) keeps its own last-used ordering across switches and
 * app restarts. Stored as a `{ listKey → sort }` map under one key; `null` (all entries) maps to
 * `'all'`. Unknown lists fall back to `DEFAULT_SORT`.
 */
const DEFAULT_SORT: LibrarySort = 'added';
const sortByList$ = persisted$<Record<string, LibrarySort>>('comical:librarySortByList', {});

const keyFor = (list: LibraryListFilter): string => list ?? 'all';

/** `[sort, setSort]` for the given list filter. `setSort` records the choice for *that* list only.
 *  Writes REPLACE the whole record (new reference) so `use$` subscribers re-render immediately — a
 *  nested `store$[key].set()` can leave the root snapshot's identity unchanged (see comical-home). */
export function useLibrarySort(list: LibraryListFilter): [LibrarySort, (sort: LibrarySort) => void] {
  const map = use$(sortByList$);
  const key = keyFor(list);
  const sort = map[key] ?? DEFAULT_SORT;
  const setSort = (next: LibrarySort) => sortByList$.set({ ...sortByList$.peek(), [key]: next });
  return [sort, setSort];
}
