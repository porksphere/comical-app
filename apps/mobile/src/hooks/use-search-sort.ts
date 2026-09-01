import { useCallback, useMemo } from 'react';

import { use$ } from '@legendapp/state/react';

import type { SortOption, SortState } from '@/components/filters/filter-demo';
import { persisted$ } from '@/lib/observable';

/**
 * The Search screen's sort choice, remembered **per bridge** and persisted to AsyncStorage.
 *
 * Per bridge is forced, not preferred: sort keys are the bridge's own vocabulary (`GET
 * /bridges/:id/sort`, capability-gated), so one bridge's `followedCount` means nothing to a bridge
 * offering `popular`. A single remembered sort would push a dead key at the next bridge and the
 * search would come back empty or 400.
 *
 * Deliberately NOT split any finer than that — not per search kind. A search here is a free-text
 * query plus a bag of bridge filters, and a "tag search" is one of those filters holding a value;
 * there is no kind to key on without inventing a taxonomy the data model doesn't have. (Sort is
 * also an ordering rather than a refinement, which is why the Series→Search intent clears the
 * filters but leaves this alone — see search.tsx.)
 *
 * Stored as one `{ bridgeId → sort }` record under one key, mirroring `useLibrarySort`.
 */
const sortByBridge$ = persisted$<Record<string, SortState>>('comical:searchSortByBridge', {});

/**
 * Isolated because the React Compiler detects hooks by name (`use` + an uppercase letter), so it
 * doesn't recognise `use$` (the `$` isn't a letter) and treats it as a plain call. Calling `use$`
 * directly before another hook like `useMemo` in the same compiled function throws off the
 * compiler's hook-slot accounting and crashes at runtime ("Should have a queue..."). Nesting it
 * here — with nothing after it — keeps the caller's hook accounting correct, the same safe shape
 * `useSelectedBridgeId` uses (see selected-bridge.ts).
 */
function useSortByBridgeMap(): Record<string, SortState> {
  return use$(sortByBridge$);
}

/**
 * `[sort, setSort]` for the given bridge. `setSort` records the choice for *that* bridge only.
 *
 * The remembered sort is VALIDATED against the options the bridge currently advertises rather than
 * trusted: a bridge that drops or renames a key would otherwise have every later search carry the
 * dead one, and the fetch is the place that failure would surface. An empty `sortOptions` — the
 * capability is absent, or the options query hasn't landed yet — fails that check and reads as no
 * sort, which is the same thing the screen shows (`SortControl` only renders once there are
 * options), so there is no state visible without a control to change it.
 *
 * The returned sort is taken apart into primitives and re-formed through a memo, so its IDENTITY is
 * stable for as long as the CHOICE is. That is not tidiness: `useBridgeFilters` debounces the
 * snapshot the fetch depends on in an effect keyed on this value, so a fresh object every render
 * would restart that timer every render and the sort would never reach a request at all.
 * `useLibrarySort` needs none of this because its value is a string.
 *
 * Writes REPLACE the whole record (new reference) so `use$` subscribers re-render immediately — a
 * nested `store$[key].set()` can leave the root snapshot's identity unchanged (see useLibrarySort).
 */
export function useSearchSort(
  bridgeId: string | undefined,
  sortOptions: SortOption[],
): [SortState, (sort: SortState) => void] {
  const map = useSortByBridgeMap();
  const remembered = bridgeId ? map[bridgeId] : null;
  const key = remembered && sortOptions.some((o) => o.key === remembered.key) ? remembered.key : null;
  const ascending = remembered?.ascending ?? false;
  const sort = useMemo<SortState>(() => (key === null ? null : { key, ascending }), [key, ascending]);
  const setSort = useCallback(
    (next: SortState) => {
      if (!bridgeId) return;
      sortByBridge$.set({ ...sortByBridge$.peek(), [bridgeId]: next });
    },
    [bridgeId],
  );
  return [sort, setSort];
}
