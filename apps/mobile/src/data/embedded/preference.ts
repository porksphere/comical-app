/**
 * The persisted "use on-device runtime" preference — the user-facing half of the remote↔embedded
 * swap. A Legend State observable persisted to AsyncStorage (see `lib/observable.ts`).
 *
 * The preference only takes effect when the native runtime is actually available; on web (and until
 * the native module ships) the resolved mode is always 'remote'. This module is pure state — the
 * swap side effects (installing the transport, clearing the query cache) are applied by the caller
 * that flips it (see settings.tsx / bootstrap.ts), keeping this free of transport/query-client deps.
 */
import { syncState, when, type ObservableParam } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { isEmbeddedRuntimeAvailable } from '@comical/host-rn';
import { persisted$ } from '@/lib/observable';

export type DataSourceMode = 'embedded' | 'remote';

const PREF_KEY = 'comical:embeddedEnabled';

// Tri-state: true / false / unset (null). Unset means "default to whether the native runtime is
// available" — and that availability MUST be read lazily, never captured, because it flips false→true
// during bootstrap when `setNativeBridgeRuntime` runs (see embedded/startup.ts). Baking it into the
// persisted initial would freeze the pre-bootstrap `false` and strand the app in remote mode even
// with the toggle on. Wrapped in an object so the null/unset state round-trips (a persisted primitive
// reads back as `{}` before anything is stored).
type EmbeddedPref = { enabled: boolean | null };
const pref$ = persisted$<EmbeddedPref>(PREF_KEY, { enabled: null });

/** The user's explicit choice, or null when they've never set it. */
function storedPref(): boolean | null {
  return (pref$.peek() as Partial<EmbeddedPref>).enabled ?? null;
}

/** Enabled-by-preference, resolving an unset choice to live runtime availability (evaluated now). */
function resolvedEnabled(pref: boolean | null): boolean {
  return pref ?? isEmbeddedRuntimeAvailable();
}

/** Persist + broadcast the preference. Side effects (transport swap, cache clear) are the caller's. */
export function setEmbeddedEnabled(enabled: boolean): void {
  pref$.set({ enabled });
}

/** `[enabled, setEnabled]` for the Settings toggle. */
export function useEmbeddedEnabled(): [boolean, (enabled: boolean) => void] {
  const pref = (use$(pref$) as Partial<EmbeddedPref>).enabled ?? null;
  return [resolvedEnabled(pref), setEmbeddedEnabled];
}

/** The resolved transport mode: 'embedded' only when both enabled AND the native runtime exists. */
export function getResolvedModeSync(): DataSourceMode {
  return resolvedEnabled(storedPref()) && isEmbeddedRuntimeAvailable() ? 'embedded' : 'remote';
}

/**
 * Resolves once the persisted preference has rehydrated from AsyncStorage. Until then,
 * `getResolvedModeSync()` sees the unset default (embedded whenever the native runtime exists) —
 * so any decision taken synchronously at boot must be re-checked after this (see startup.ts).
 */
export function whenEmbeddedPrefLoaded(): Promise<unknown> {
  return when(syncState(pref$ as ObservableParam).isPersistLoaded);
}
