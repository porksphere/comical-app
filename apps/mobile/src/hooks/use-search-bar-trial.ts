import { useSelector } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';
import { PROFILING_ENABLED } from '@/lib/profiling';

/**
 * What the iOS search tab's bar does while its field is in use (Settings → Developer, a trial):
 * `hides`, the system's default, with the source, filters and sort in a row under the field;
 * `titled`, the bar kept with a small "Search" in it; `kept`, the bar kept with only its buttons.
 */
export type SearchBarTrial = 'hides' | 'titled' | 'kept';

/** An object, not a bare value: see lib/dev-profiler-flag. */
const trial$ = persisted$<{ bar?: SearchBarTrial }>('comical:searchBarTrial', {});

/** Only in a build that has the Developer screen, as the home hero's trial is. */
export function useSearchBarTrial(): SearchBarTrial {
  return useSelector(() => (PROFILING_ENABLED ? (trial$.bar.get() ?? 'hides') : 'hides'));
}

export function setSearchBarTrial(bar: SearchBarTrial): void {
  trial$.bar.set(bar);
}
