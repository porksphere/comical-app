import { use$ } from '@legendapp/state/react';

import type { CollectedItemsQuery } from '@/data/api';
import type { SavedKind } from '@/data/selected-collection';
import { persisted$ } from '@/lib/observable';

/** Server-side ordering for a collected listing — maps 1:1 to `/library/collected?sort=`. */
export type CollectedSort = 'added' | 'series' | 'chapter';
/** Direction, a SEPARATE param from `sort` (there is no "oldest" key). */
export type CollectedDir = 'asc' | 'desc';
/** Client-side sectioning applied over whatever order the server returned. */
export type CollectedGrouping = 'none' | 'series' | 'date';

export type CollectedViewPrefs = {
  sort: CollectedSort;
  dir: CollectedDir;
  grouping: CollectedGrouping;
};

/** Newest-first, ungrouped — the ordering people expect from a "things I saved" surface. */
const DEFAULTS: CollectedViewPrefs = { sort: 'added', dir: 'desc', grouping: 'none' };

/**
 * How a saved chapters/pages view is ordered and sectioned. Device-local UI preference, so Legend
 * State — it is not a copy of anything on the server, even though `sort`/`dir` are sent to it.
 *
 * Remembered per VIEW (the same treatment the library sort gets): a reading queue browses
 * oldest-first, a favorites album newest-first, and switching between them restores each one's
 * last-used axes rather than dragging one habit across all of them.
 */
const prefsByCollection$ = persisted$<Record<string, CollectedViewPrefs>>('comical:collectedViewByCollection', {});

// All's views keep the `@chapters` / `@pages` keys they had when they were views of their own.
const prefsKey = (collection: string | null, kind: SavedKind) => `${collection ?? ''}@${kind}s`;

export function useCollectedView(
  collection: string | null,
  kind: SavedKind,
): [CollectedViewPrefs, (patch: Partial<CollectedViewPrefs>) => void] {
  const map = use$(prefsByCollection$);
  const key = prefsKey(collection, kind);
  // Spread over the defaults so a stored value written before a field existed still reads complete.
  const value = { ...DEFAULTS, ...map[key] };
  // Writes REPLACE the whole record (new reference) so `use$` subscribers re-render — a nested
  // `store$[key].set()` can leave the root snapshot's identity unchanged.
  const set = (patch: Partial<CollectedViewPrefs>) => {
    const current = prefsByCollection$.peek();
    prefsByCollection$.set({ ...current, [key]: { ...DEFAULTS, ...current[key], ...patch } });
  };
  return [value, set];
}

/**
 * THE listing behind a saved view. The grid and the reader's page sequence both build their query
 * here, so a page opened from the grid pages through exactly the grid's order — and hits the query
 * the grid already warmed.
 */
export function collectedListing(
  collection: string | null,
  kind: SavedKind,
  { sort, dir }: Pick<CollectedViewPrefs, 'sort' | 'dir'>,
  q: string,
): CollectedItemsQuery {
  return { type: kind, ...(collection ? { collection } : {}), sort, dir, ...(q ? { q } : {}) };
}

/** The direction a given sort defaults to, matching the runtime: newest-first for `added`,
 *  ascending for the positional ones. Used when switching sort so the result reads sensibly
 *  without the user also having to flip direction. */
export function defaultDirFor(sort: CollectedSort): CollectedDir {
  return sort === 'added' ? 'desc' : 'asc';
}
