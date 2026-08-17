import { use$ } from '@legendapp/state/react';

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
 * How the saved-pages view is ordered and sectioned. Device-local UI preference, so Legend State —
 * it is not a copy of anything on the server, even though `sort`/`dir` are sent to it.
 *
 * One setting for the whole view rather than per collection: sort is a *habit* ("I browse newest
 * first"), unlike the library's sort, which is per list because a list is a context. Splitting it
 * per collection would mean the same person's saved pages sort differently depending on which
 * collection they opened, which is surprising rather than helpful.
 */
const prefs$ = persisted$<CollectedViewPrefs>('comical:collectedView', DEFAULTS);

export function useCollectedView(): [CollectedViewPrefs, (patch: Partial<CollectedViewPrefs>) => void] {
  // Spread over the defaults so a stored value written before a field existed still reads complete.
  const stored = use$(prefs$);
  const value = { ...DEFAULTS, ...stored };
  // Writes REPLACE the whole object (new reference) so `use$` subscribers re-render — a nested
  // `prefs$.sort.set()` can leave the root snapshot's identity unchanged.
  const set = (patch: Partial<CollectedViewPrefs>) => prefs$.set({ ...DEFAULTS, ...prefs$.peek(), ...patch });
  return [value, set];
}

/** The direction a given sort defaults to, matching the runtime: newest-first for `added`,
 *  ascending for the positional ones. Used when switching sort so the result reads sensibly
 *  without the user also having to flip direction. */
export function defaultDirFor(sort: CollectedSort): CollectedDir {
  return sort === 'added' ? 'desc' : 'asc';
}
