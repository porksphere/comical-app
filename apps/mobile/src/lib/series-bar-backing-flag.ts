import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * THROWAWAY: which backing the series bar draws on the folded Duo, to compare on a device
 * (Settings > Developer). `own`: the bar's own view, faded by the scroll as its title is.
 * `edge`: the list's scroll edge, with the title registered to it once the page's title is past.
 * See `components/series/details-native-bar.tsx`; the decision retires this file.
 *
 * Persisted as an object, like `dev-profiler-flag`, and read through `useSyncExternalStore`,
 * which the React Compiler knows as a hook where `use$` isn't one to it.
 */
export type SeriesFoldedBacking = 'own' | 'edge';

export const seriesFoldedBacking$ = persisted$('comical:dev-series-folded-backing', {
  mode: 'own' as SeriesFoldedBacking,
});

export function useSeriesFoldedBacking(): SeriesFoldedBacking {
  return useSyncExternalStore(
    (onStoreChange) => seriesFoldedBacking$.mode.onChange(onStoreChange),
    () => seriesFoldedBacking$.mode.peek(),
    () => seriesFoldedBacking$.mode.peek(),
  );
}
