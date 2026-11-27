/**
 * Which list the Reading tab shows: what you have read, or the new chapters of what you follow.
 *
 * One tab with two views rather than two tabs, so a phone's bar has room for Settings and, on iOS,
 * the search tab. The view is a scope of the tab, the way a bridge is Browse's: the labelled
 * sidebar lists both as rows, every other nav shows the tab once and the screen switches between
 * them (`ReadingSwitch`). Persisted, so the tab reopens on the list you left it on.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

export type ReadingView = 'history' | 'new';

export const READING_VIEWS: readonly { id: ReadingView; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'new', label: 'New chapters' },
];

export const readingViewLabel = (view: ReadingView): string => READING_VIEWS.find((v) => v.id === view)!.label;

/** A view named in a link (`/reading?view=new`), or null for anything else. */
export const parseReadingView = (raw: unknown): ReadingView | null =>
  READING_VIEWS.some((v) => v.id === raw) ? (raw as ReadingView) : null;

const readingView$ = persisted$<ReadingView>('comical:readingView', 'history');

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useReadingView(): ReadingView {
  return use$(readingView$);
}

export function readingView(): ReadingView {
  return readingView$.peek();
}

export function setReadingView(view: ReadingView): void {
  readingView$.set(view);
}
