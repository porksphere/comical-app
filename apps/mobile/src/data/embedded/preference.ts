/**
 * The persisted "use on-device runtime" preference — the user-facing half of the remote↔embedded
 * swap. Mirrors the `useSyncExternalStore` pattern used by `useMockDataToggle`/`useHideNsfw` in
 * source.ts (module state + listeners + AsyncStorage persistence).
 *
 * The preference only takes effect when the native runtime is actually available; on web (and until
 * the native module ships) the resolved mode is always 'remote'. This module is pure state — the
 * swap side effects (installing the transport, clearing the query cache) are applied by the caller
 * that flips it (see settings.tsx / bootstrap.ts), keeping this free of transport/query-client deps.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isEmbeddedRuntimeAvailable } from './native-runtime';

export type DataSourceMode = 'embedded' | 'remote';

const PREF_KEY = 'comical:embedded:enabled';

// Undefined until AsyncStorage hydrates; falls back to "on when available" so a fresh native
// install defaults to the on-device runtime.
let enabledPref: boolean | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the on-device runtime is *enabled by preference* (independent of availability). */
function enabledSnapshot(): boolean {
  return enabledPref ?? isEmbeddedRuntimeAvailable();
}

// Hydrate the persisted value once.
AsyncStorage.getItem(PREF_KEY)
  .then((stored) => {
    if (stored === '1' || stored === '0') {
      enabledPref = stored === '1';
      notify();
    }
  })
  .catch(() => {});

/** Persist + broadcast the preference. Side effects (transport swap, cache clear) are the caller's. */
export function setEmbeddedEnabled(enabled: boolean): void {
  enabledPref = enabled;
  notify();
  AsyncStorage.setItem(PREF_KEY, enabled ? '1' : '0').catch(() => {});
}

/** `[enabled, setEnabled]` for the Settings toggle. */
export function useEmbeddedEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, enabledSnapshot, () => false);
  return [enabled, setEmbeddedEnabled];
}

/** The resolved transport mode: 'embedded' only when both enabled AND the native runtime exists. */
export function getResolvedModeSync(): DataSourceMode {
  return enabledSnapshot() && isEmbeddedRuntimeAvailable() ? 'embedded' : 'remote';
}
