import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * EXPERIMENTAL feature toggles, surfaced in Settings → General → Experimental. Each flag here is a
 * self-contained experiment; keep this file to flags only so ripping an experiment out stays a
 * three-touch removal (its flag, its Settings row, its feature code).
 *
 * ── Series reader page ───────────────────────────────────────────────────────
 * When on, tapping a series card anywhere (browse, search, rails, library) opens `/series-reader`
 * — a screen that starts straight in the reader, with the series info (tags, meta, description,
 * chapter list, related rails) revealed by scrolling past the pages — instead of the `/series`
 * detail screen. Off by default.
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
export type SeriesReaderVariant = 'card' | 'header';

export const seriesReaderPage$ = persisted$('comical:experimental-series-reader', {
  enabled: false,
  /** Which layout /series-reader uses:
   *  - 'card':   the reader is the top layer (shadowed, device-cornered card docked below the safe
   *              area) and swipes away to reveal the details beneath — opens reading.
   *  - 'header': the reader sits as a SHORT, faded strip above the details (background-image-like),
   *              and expands to full screen on demand — opens on the details. */
  variant: 'card' as SeriesReaderVariant,
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

export function useSeriesReaderVariant(): SeriesReaderVariant {
  return useSyncExternalStore(
    (onStoreChange) => seriesReaderPage$.variant.onChange(onStoreChange),
    () => seriesReaderPage$.variant.peek() ?? 'card',
    () => seriesReaderPage$.variant.peek() ?? 'card',
  );
}
