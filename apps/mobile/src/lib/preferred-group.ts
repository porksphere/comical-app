/**
 * The scanlation group the user last opened, remembered across the series↔reader
 * route hop so chapter-to-chapter navigation keeps the same source. Mirrors
 * comical-web's module-level `preferredGroupName`. It's a single ephemeral value
 * (not per-series persisted): `resetPreferredGroup()` clears it when a different
 * series is opened, `setPreferredGroup(group)` records the team when a chapter opens,
 * and the ordering helpers in `@/lib/chapter-order` read it via `usePreferredGroup()`
 * to pick which version of a logical chapter to show/advance to.
 *
 * A Legend State observable (see `lib/observable.ts`) — in-memory only, no persistence.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';

const preferredGroup$ = observable<string | undefined>(undefined);

/** Record the scanlation group of the chapter the user just opened. Legend State no-ops a
 *  set to the current value, so this won't needlessly re-render subscribers. */
export function setPreferredGroup(group: string | undefined): void {
  preferredGroup$.set(group);
}

/** Clear the remembered group — call when a different series is opened. */
export function resetPreferredGroup(): void {
  preferredGroup$.set(undefined);
}

/** Non-reactive read, for use outside React (e.g. navigation helpers). */
export function getPreferredGroup(): string | undefined {
  return preferredGroup$.peek();
}

/** Reactive read: components re-render when the preferred group changes. */
export function usePreferredGroup(): string | undefined {
  return use$(preferredGroup$);
}
