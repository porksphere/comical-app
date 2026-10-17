import { use$ } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';

import { libraryMemberKey, libraryMembershipQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const libraryMarker$ = persisted$('comical:libraryMarker', { enabled: true });

/** Whether browse cards mark a series that's already in the library (Settings → General).
 *  A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useLibraryMarker(): boolean {
  return use$(libraryMarker$.enabled) ?? true;
}

export function setLibraryMarker(enabled: boolean): void {
  libraryMarker$.enabled.set(enabled);
}

// Every card asks the same question of the same list; build its lookup once per fetched list
// rather than once per card.
const memberSets = new WeakMap<readonly string[], Set<string>>();
function memberSet(keys: readonly string[]): Set<string> {
  let set = memberSets.get(keys);
  if (!set) {
    set = new Set(keys);
    memberSets.set(keys, set);
  }
  return set;
}

/** Whether this series is in the library and the card should say so. One shared query backs every
 *  card, so marking a grid costs one library fetch, never one per card. */
export function useSavedInLibrary(bridgeId: string | undefined, seriesId: string, wanted: boolean): boolean {
  const on = useLibraryMarker();
  const ds = useDataSource();
  const mock = useMockActive();
  const enabled = wanted && on && !!bridgeId;
  const { data } = useQuery({
    ...libraryMembershipQuery(ds, mock),
    enabled,
    select: (keys) => memberSet(keys).has(libraryMemberKey(bridgeId ?? '', seriesId)),
  });
  // A disabled query still hands back what's cached.
  return enabled && data === true;
}
