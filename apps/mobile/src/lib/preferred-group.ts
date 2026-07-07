/**
 * The scanlation group the user last opened, remembered across the series↔reader
 * route hop so chapter-to-chapter navigation keeps the same source. Mirrors
 * comical-web's module-level `preferredGroupName`. It's a single ephemeral value
 * (not per-series persisted): `resetPreferredGroup()` clears it when a different
 * series is opened, `setPreferredGroup(group)` records the team when a chapter opens,
 * and the ordering helpers in `@/lib/chapter-order` read it via `usePreferredGroup()`
 * to pick which version of a logical chapter to show/advance to.
 *
 * Uses the app's `useSyncExternalStore` external-store convention (see
 * `data/data-epoch.ts`) rather than hand-rolled useState+listeners.
 */
import { useSyncExternalStore } from 'react';

let preferredGroup: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Record the scanlation group of the chapter the user just opened. No-op when it's
 *  already the current value, so it won't needlessly re-render subscribers. */
export function setPreferredGroup(group: string | undefined): void {
  if (group === preferredGroup) return;
  preferredGroup = group;
  emit();
}

/** Clear the remembered group — call when a different series is opened. */
export function resetPreferredGroup(): void {
  setPreferredGroup(undefined);
}

/** Non-reactive read, for use outside React (e.g. navigation helpers). */
export function getPreferredGroup(): string | undefined {
  return preferredGroup;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive read: components re-render when the preferred group changes. */
export function usePreferredGroup(): string | undefined {
  return useSyncExternalStore(subscribe, () => preferredGroup, () => undefined);
}
