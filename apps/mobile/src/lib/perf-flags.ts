import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * Perf toggle: when on, `SeriesCard` skips the per-card reanimated cover-aspect "shrink" illusion
 * (its animated styles are left unattached, so no per-frame worklets run per card) and expo-image's
 * cover cross-fade on (re)load. Surfaced as a Settings switch; persisted. Default on.
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
