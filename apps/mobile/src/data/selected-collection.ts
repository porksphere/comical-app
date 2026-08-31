/**
 * Which collection the Library tab is showing — `null` for the library's own series grid, a
 * collection id for that collection's contents.
 *
 * Lifted out of the Library screen's `useState` because the sidebar drives it too, and a selection
 * two surfaces can move is shared state by definition. Same split the bridge selection already makes
 * (see `selected-bridge.ts`): the id is the state, everything else — the collection's name, its
 * contents, its per-collection sort — stays derived from it.
 *
 * In-memory, NOT persisted, which keeps the screen's original semantics: a launch lands on the
 * library grid rather than resuming inside whichever collection was open weeks ago.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

const selectedCollection$ = observable<string | null>(null);

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx` for the
 *  crash that shape causes under the React Compiler. */
export function useSelectedCollectionId(): string | null {
  return use$(selectedCollection$);
}

export function setSelectedCollection(id: string | null): void {
  selectedCollection$.set(id);
}
