import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * EXPERIMENTAL feature toggles, surfaced in Settings → General → Experimental. Each flag here is a
 * self-contained experiment; keep this file to flags only so ripping an experiment out stays a
 * three-touch removal (its flag, its Settings row, its feature code).
 *
 * ── Series reader page ───────────────────────────────────────────────────────
 * When on, tapping a series card anywhere (browse, search, rails, library) opens `/series-reader`
 * — one screen holding both the series details and an in-place reader, with the pages as a faded
 * strip forming the top of the details page — instead of the `/series` detail screen. Off by
 * default.
 *
 * The whole experiment is:
 *   - this flag,
 *   - the Settings row in `app/settings-general.tsx`,
 *   - the route target switch in `components/series-card.tsx` (`buildHref`),
 *   - the screen itself, `app/series-reader.tsx` (+ its Stack.Screen entry in `app/_layout.tsx`).
 *
 * Persisted as an OBJECT, not a bare boolean (same reasoning as perf-flags.ts): Legend State's
 * `safeStringify` hands a falsy value to AsyncStorage unstringified, which crashes native
 * RNCAsyncStorage when the toggle is off. An object is always truthy → serialized.
 */
export const seriesReaderPage$ = persisted$('comical:experimental-series-reader', {
  enabled: false,
});

/** Reactive read via `useSyncExternalStore` — NOT a bare `use$()`; see perf-flags.ts for why
 *  (React Compiler doesn't recognize `use$` as a hook and mis-memoizes its internals). */
export function useSeriesReaderPage(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => seriesReaderPage$.enabled.onChange(onStoreChange),
    () => seriesReaderPage$.enabled.peek(),
    () => seriesReaderPage$.enabled.peek(),
  );
}
