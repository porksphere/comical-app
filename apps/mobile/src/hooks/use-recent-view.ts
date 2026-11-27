/**
 * Which list the Recent tab shows: what you have read, or the new chapters of what you follow.
 *
 * One tab with two views rather than two tabs, so a phone's bar has room for Settings and, on iOS,
 * the search tab. The view is a scope of the tab, the way a bridge is Browse's: the labelled
 * sidebar lists both as rows, every other nav shows the tab once and the screen switches between
 * them (`RecentSwitch`). Persisted, so the tab reopens on the list you left it on.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

export type RecentView = 'history' | 'new';

export const RECENT_VIEWS: readonly { id: RecentView; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'new', label: 'New chapters' },
];

export const recentViewLabel = (view: RecentView): string => RECENT_VIEWS.find((v) => v.id === view)!.label;

/** A view named in a link (`/recent?view=new`), or null for anything else. */
export const parseRecentView = (raw: unknown): RecentView | null =>
  RECENT_VIEWS.some((v) => v.id === raw) ? (raw as RecentView) : null;

const recentView$ = persisted$<RecentView>('comical:recentView', 'history');

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useRecentView(): RecentView {
  return use$(recentView$);
}

export function recentView(): RecentView {
  return recentView$.peek();
}

export function setRecentView(view: RecentView): void {
  recentView$.set(view);
}
