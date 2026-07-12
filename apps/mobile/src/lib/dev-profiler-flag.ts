import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * DEV-only toggle for the on-device Hermes profiler button (see
 * `components/dev-profiler.tsx`). Kept in its own tiny module — with no
 * `react-native-release-profiler` import — so the Settings screen can read/write
 * it without dragging the native profiler dependency into the production bundle.
 *
 * Persisted as an OBJECT, not a bare boolean: Legend State's `safeStringify` is
 * `v ? stringify(v) : v`, so a falsy bare value (`false`) reaches AsyncStorage
 * unstringified and crashes native RNCAsyncStorage — the exact trap documented
 * in `lib/perf-flags.ts`.
 */
export const devProfiler$ = persisted$('comical:dev-profiler', { enabled: false });

/**
 * Reactive read via `useSyncExternalStore` — NOT a bare `use$(devProfiler$)`. A
 * `use$` call isn't recognized as a hook (name isn't `useX`), so React Compiler
 * (enabled here) memoizes/skips its internal hooks and crashes with "rendered
 * fewer hooks than expected" — see `useLightCards` in `lib/perf-flags.ts`.
 */
export function useDevProfilerEnabled(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => devProfiler$.enabled.onChange(onStoreChange),
    () => devProfiler$.enabled.peek(),
    () => devProfiler$.enabled.peek(),
  );
}
