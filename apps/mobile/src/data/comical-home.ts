/**
 * Which bridges the user has excluded from the synthetic "Comical" aggregate HOME. App-local and
 * persisted (Legend State, not a bridge-server pref) — set per-bridge in that bridge's settings. Only
 * the home rails are trimmed; cross-bridge SEARCH still spans every bridge. A bridge is excluded when
 * its id maps to `true`.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

const excludedFromComicalHome$ = persisted$<Record<string, boolean>>('comical:excludedBridges', {});

/** Reactive map of excluded bridge ids — for filtering the Comical home's bridge fan-out. */
export function useComicalExcludedIds(): Record<string, boolean> {
  return use$(excludedFromComicalHome$);
}

/** Reactive `[excluded, setExcluded]` for one bridge — for its settings toggle. Writes REPLACE the
 *  whole record (new reference) so `use$` subscribers on another screen (the Comical home's
 *  `useComicalExcludedIds`) re-render and re-filter immediately — a nested `store$[key].set()` can
 *  leave the root snapshot's identity unchanged, so the home's `useMemo` wouldn't recompute. */
export function useComicalExcluded(bridgeId: string): readonly [boolean, (excluded: boolean) => void] {
  const map = use$(excludedFromComicalHome$);
  return [
    !!map[bridgeId],
    (excluded: boolean) => excludedFromComicalHome$.set({ ...excludedFromComicalHome$.peek(), [bridgeId]: excluded }),
  ] as const;
}
