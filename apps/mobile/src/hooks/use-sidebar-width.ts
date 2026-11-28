/**
 * The rail's width — a device-local preference, not a constant.
 *
 * `SidebarWidth` is now only the DEFAULT. The live value has to be state because two places read it
 * and they must agree: the rail draws itself at it, and the tab slot pads by exactly the same number
 * (see `contentInset` in `app-tabs`). Persisted, because a width you dragged and lost on relaunch is
 * worse than one you can't change at all.
 */
import { use$ } from '@legendapp/state/react';

import { SidebarWidth } from '@/constants/theme';
import { persisted$ } from '@/lib/observable';

/** Floor: below this the labels truncate and the sidebar stops being readable. Ceiling: past this
 *  it is taking space from a content column that is the point of the screen. */
export const SidebarMinWidth = 180;
export const SidebarMaxWidth = 400;

/** The icon rail's width: the nav of a regular width too narrow for the labelled sidebar (see
 *  `navModeFor`). The layout's choice, never the user's, so it is not a state of the width below. */
export const SidebarRailWidth = 64;

const sidebarWidth$ = persisted$('comical:sidebarWidth', SidebarWidth);

export const clampSidebarWidth = (w: number): number =>
  Math.round(Math.min(SidebarMaxWidth, Math.max(SidebarMinWidth, w)));

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useSidebarWidth(): number {
  return use$(sidebarWidth$);
}

export function setSidebarWidth(w: number): void {
  sidebarWidth$.set(clampSidebarWidth(w));
}
