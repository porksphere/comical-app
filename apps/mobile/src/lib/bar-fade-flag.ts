import { useSyncExternalStore } from 'react';

import { persisted$ } from '@/lib/observable';

/**
 * TEMPORARY, for comparing the two series-bar fades (`components/series/details-native-bar.tsx`):
 * on, the bar switches at the page's title and `modules/nav-bar-fade` crossfades the switch; off,
 * the material is UIKit's own scroll-edge crossfade. An object, not a bare boolean: see
 * `lib/dev-profiler-flag.ts`.
 */
export const barFade$ = persisted$('comical:dev-bar-fade', { enabled: false });

export function useBarFadeExperiment(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => barFade$.enabled.onChange(onStoreChange),
    () => barFade$.enabled.peek(),
    () => barFade$.enabled.peek(),
  );
}
