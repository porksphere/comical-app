/**
 * The persisted "use on-device runtime" preference — the user-facing half of the remote↔embedded
 * swap. A Legend State observable persisted to AsyncStorage (see `lib/observable.ts`).
 *
 * The preference only takes effect when the native runtime is actually available; on web (and until
 * the native module ships) the resolved mode is always 'remote'. This module is pure state — the
 * swap side effects (installing the transport, clearing the query cache) are applied by the caller
 * that flips it (see settings.tsx / bootstrap.ts), keeping this free of transport/query-client deps.
 */
import { use$ } from '@legendapp/state/react';
import { isEmbeddedRuntimeAvailable } from '@comical/host-rn';
import { persisted$ } from '@/lib/observable';

export type DataSourceMode = 'embedded' | 'remote';

const PREF_KEY = 'comical:embedded:enabled';

// Fresh installs default to "on when the native runtime is available" — availability is fixed for a
// process, so capturing it as the initial matches the old `enabledPref ?? isEmbeddedRuntimeAvailable()`
// fallback. Once the user flips the toggle, their explicit choice is persisted and wins.
//
// The old store wrote this key as '1'/'0'; Legend State now owns it as a JSON boolean. An upgrading
// user's legacy value still parses truthy/falsy (1/0) on the first load, so `Boolean(...)` normalizes
// it — and the next toggle rewrites the key in the new format. Coerced everywhere it's read.
const enabled$ = persisted$<boolean>(PREF_KEY, isEmbeddedRuntimeAvailable());

/** Persist + broadcast the preference. Side effects (transport swap, cache clear) are the caller's. */
export function setEmbeddedEnabled(enabled: boolean): void {
  enabled$.set(enabled);
}

/** `[enabled, setEnabled]` for the Settings toggle. */
export function useEmbeddedEnabled(): [boolean, (enabled: boolean) => void] {
  return [Boolean(use$(enabled$)), setEmbeddedEnabled];
}

/** The resolved transport mode: 'embedded' only when both enabled AND the native runtime exists. */
export function getResolvedModeSync(): DataSourceMode {
  return enabled$.peek() && isEmbeddedRuntimeAvailable() ? 'embedded' : 'remote';
}
