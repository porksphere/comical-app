/**
 * Which scope groups are expanded in the rail, keyed by the destination that owns them.
 *
 * Independent of selection, deliberately. Open used to mean "this row is active", which made the two
 * inseparable: you could never see Browse's bridges and Library's collections at once, and switching
 * tabs silently collapsed whatever you had been looking at. They are different questions — which
 * screen am I on, and which lists do I want to see — so they get different state.
 *
 * Persisted, like every other device-local preference (reader settings, the rail's width): a group
 * you collapsed to get the destinations back above the fold should stay collapsed, or the next
 * launch buries them again.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** Open by default: the groups are the reason the rail is worth its width, and a first run that
 *  hides them looks like the feature isn't there. */
const sections$ = persisted$('comical:sidebarSections', {} as Record<string, boolean>);

/** A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
function useSections(): Record<string, boolean> {
  return use$(sections$);
}

/**
 * Read by the row and the group THEMSELVES, one component instance each, rather than read once
 * higher up and passed down. The record's identity is stable across an `assign`, so a parent that
 * memoized over it kept handing the old flag down: the toggle persisted and the rail didn't move
 * until a reload. Subscribing per consumer sidesteps the question entirely.
 */
export function useSectionOpen(name: string): boolean {
  return useSections()[name] ?? true;
}

export function toggleSection(name: string): void {
  const open = sections$.peek()[name] ?? true;
  sections$.assign({ [name]: !open });
}
