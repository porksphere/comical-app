import type { HistoryEntry } from './types';

/**
 * The reorder reading causes, as a plain function of the current list.
 *
 * Its own module, with nothing but a type import, so it can be tested without dragging the data
 * layer (and the comical submodule behind it) into a unit test — the same reason `library-grouping`
 * and the other tested `data/` helpers are separate from `queries.ts`.
 *
 * WHY it exists at all: History is ordered by last-read, so reading reorders it. Left to
 * `invalidateQueries`, that reorder lands whenever the refetch resolves — which turned out to
 * include the middle of the collapse back into the card, so the transition aimed at the row's old
 * position and the row moved out from under it in flight. Applying the reorder to the cache the list
 * reads from, at the moment the read happens, puts it behind a full-screen reader where nobody can
 * see it. The debounced write and its refetch still follow and agree; this only decides WHEN the
 * order changes, never what it changes to.
 */
export type HistoryBump = Pick<HistoryEntry, 'bridgeId' | 'seriesId' | 'title'> & Partial<HistoryEntry>;

/**
 * The reorder itself, as a plain function of the current list — separated from the cache write so
 * it can be reasoned about (and tested) without a QueryClient. Returns the SAME array reference when
 * nothing should move, which is what keeps a long read from re-rendering a covered list.
 */
export function historyWithBumped(
  cur: HistoryEntry[] | undefined,
  entry: HistoryBump,
  now: number,
): HistoryEntry[] | undefined {
  if (!cur) return cur;
  const at = cur.findIndex((h) => h.bridgeId === entry.bridgeId && h.seriesId === entry.seriesId);
  if (at === 0) return cur;
  // Not in the list yet (a first read of a series opened from somewhere else) — put it in, so the
  // row exists to collapse onto rather than appearing out of nowhere a moment later.
  const existing = at < 0 ? undefined : cur[at];
  const next: HistoryEntry = { ...existing, ...entry, lastReadAt: now };
  const rest = at < 0 ? cur : [...cur.slice(0, at), ...cur.slice(at + 1)];
  return [next, ...rest];
}

