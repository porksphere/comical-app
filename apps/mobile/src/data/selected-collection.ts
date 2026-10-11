/**
 * Which view the Library tab is showing — `null` for the library's own series grid, `ALL_CHAPTERS` /
 * `ALL_PAGES` for every saved chapter or page whatever its collections, a collection id for that
 * collection's contents.
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

import type { Collection } from '@/data/types';

// `@` can't start a collection id (they are UUIDs), so these can share the id's slot.
export const ALL_CHAPTERS = '@chapters';
export const ALL_PAGES = '@pages';

/** The item type an all-of-a-kind view lists, or `null` for the series grid and for a collection. */
export function allItemsType(view: string | null): 'chapter' | 'page' | null {
  return view === ALL_CHAPTERS ? 'chapter' : view === ALL_PAGES ? 'page' : null;
}

export const ALL_VIEW_NAMES = { series: 'All Series', chapter: 'All Chapters', page: 'All Pages' } as const;

export type LibraryView = { id: string | null; name: string; testKey: string };

/** The Library's views in menu order, for the selector and the sidebar. A kind view is listed once
 *  anything of that kind is saved — and while it is the selection, so emptying it doesn't pull the
 *  row out from under the screen showing it. */
export function libraryViews(
  collections: Collection[],
  kinds: { chapter: boolean; page: boolean },
  selected: string | null,
): LibraryView[] {
  return [
    { id: null, name: ALL_VIEW_NAMES.series, testKey: 'all' },
    ...(kinds.chapter || selected === ALL_CHAPTERS
      ? [{ id: ALL_CHAPTERS, name: ALL_VIEW_NAMES.chapter, testKey: 'chapters' }]
      : []),
    ...(kinds.page || selected === ALL_PAGES ? [{ id: ALL_PAGES, name: ALL_VIEW_NAMES.page, testKey: 'pages' }] : []),
    ...collections.map((c) => ({ id: c.id, name: c.name, testKey: c.id })),
  ];
}

const selectedCollection$ = observable<string | null>(null);

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx` for the
 *  crash that shape causes under the React Compiler. */
export function useSelectedCollectionId(): string | null {
  return use$(selectedCollection$);
}

export function setSelectedCollection(id: string | null): void {
  selectedCollection$.set(id);
}
