/**
 * Which view the Library tab is showing — two independent axes. The COLLECTION is `null` for All
 * or a collection's id; the KIND narrows whichever of those is showing to its series, chapters or
 * pages. Series are always the library grid (scoped to the collection); chapters and pages are a
 * collected-items listing scoped by both.
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

export const ALL_VIEW_NAME = 'All';

export type ItemKind = 'series' | 'chapter' | 'page';
export const ITEM_KINDS: readonly ItemKind[] = ['series', 'chapter', 'page'];
export const ITEM_KIND_LABELS: Record<ItemKind, string> = { series: 'Series', chapter: 'Chapters', page: 'Pages' };
/** The kinds that are saved ITEMS rather than library series — what the collected grid shows. */
export type SavedKind = Exclude<ItemKind, 'series'>;

/** Which kinds a view holds anything of; `null` while that is still loading. */
export type KindsPresent = Record<ItemKind, boolean> | null;

/** The kinds a view can be narrowed to — the ones it holds. Nothing known yet keeps the selection
 *  offered, so a view doesn't flash to another kind while its contents load. */
export function itemKindOptions(present: KindsPresent, selected: ItemKind): ItemKind[] {
  if (!present) return [selected];
  return ITEM_KINDS.filter((k) => present[k]);
}

/** The kind a view actually shows: the selection when the view holds any, else the first kind it
 *  does hold. The selection itself is left alone, so a collection of only pages doesn't drag the
 *  next view onto Pages too. */
export function effectiveItemKind(present: KindsPresent, selected: ItemKind): ItemKind {
  const options = itemKindOptions(present, selected);
  return options.includes(selected) ? selected : (options[0] ?? selected);
}

export type LibraryView = { id: string | null; name: string; testKey: string };

/** The Library's views in menu order, for the selector and the sidebar. */
export function libraryViews(collections: Collection[]): LibraryView[] {
  return [
    { id: null, name: ALL_VIEW_NAME, testKey: 'all' },
    ...collections.map((c) => ({ id: c.id, name: c.name, testKey: c.id })),
  ];
}

const selectedCollection$ = observable<string | null>(null);
const selectedKind$ = observable<ItemKind>('series');

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx` for the
 *  crash that shape causes under the React Compiler. */
export function useSelectedCollectionId(): string | null {
  return use$(selectedCollection$);
}

export function setSelectedCollection(id: string | null): void {
  selectedCollection$.set(id);
}

export function useSelectedItemKind(): ItemKind {
  return use$(selectedKind$);
}

export function setSelectedItemKind(kind: ItemKind): void {
  selectedKind$.set(kind);
}
