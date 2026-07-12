import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * Perf toggle: when on, a card pays for no animation machinery at all — the reanimated aspect
 * "shrink" illusion isn't even ALLOCATED (its hooks live in a child component that only mounts when
 * this is off), expo-image's cross-fade is dropped, and the pulsing skeleton goes with it, along with
 * the `loaded` state flip whose only job was to hide that skeleton (the clip's own grey backing is
 * the placeholder, and the picture paints over it natively).
 *
 * Honoured by BOTH card surfaces: `SeriesCard` (browse/library covers) and `PageThumb` (the series
 * page's thumbnail grid, and the card popup's page rail). A long page grid mounts more tiles than a
 * browse grid mounts cards, so the argument is if anything stronger there.
 *
 * Surfaced as a Settings switch; persisted. Default on.
 *
 * Persisted as an OBJECT, not a bare boolean: Legend State's `safeStringify` is `v ? stringify(v) : v`,
 * so a falsy value (`false`) is handed to AsyncStorage UNstringified, which crashes native RNCAsyncStorage
 * (`-[__NSCFBoolean length]`) when the toggle is turned off. An object is always truthy → serialized.
 */
export const lightCards$ = persisted$('comical:perf-cards', { light: true });

/**
 * Reactive read, via `useSyncExternalStore` — NOT a bare `use$(lightCards$)` in a component. A bare
 * `use$` call isn't recognized as a hook (name isn't `useX`), so under React Compiler its internal
 * hooks get memoized/skipped, which crashed Settings with "rendered fewer hooks than expected."
 * `useSyncExternalStore` is a real, compiler-recognized hook and the app's preferred external read.
 */
export function useLightCards(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => lightCards$.light.onChange(onStoreChange),
    () => lightCards$.light.peek(),
    () => lightCards$.light.peek(),
  );
}
