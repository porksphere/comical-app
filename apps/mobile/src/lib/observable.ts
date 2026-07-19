/**
 * Legend State setup for the app's **local/client state** — the device-local
 * preferences and UI state that TanStack Query deliberately doesn't own. See
 * `docs/ARCHITECTURE.md` → "State management" for the split (server/async cache
 * → TanStack Query; local/UI/preferences → Legend State observables).
 *
 * One place configures the AsyncStorage persistence plugin so individual stores
 * only declare a storage key. `persisted$(name, initial)` returns an observable
 * transparently backed by AsyncStorage under `name`: it starts at `initial`
 * synchronously — so the first render (including the web static export before
 * hydration) is deterministic, the way the old stores' `getServerSnapshot`
 * returned the unpersisted default — then rehydrates from disk once AsyncStorage
 * resolves and writes every later change back.
 *
 * This replaces the hand-rolled "module var + a `Set` of listeners + `notify` +
 * `subscribe` + `useSyncExternalStore` + a one-shot AsyncStorage read +
 * write-through on every setter" that each preference store used to
 * re-implement. Read it in a component with `use$(store$)`; read/write outside
 * React with `store$.peek()` / `store$.set(...)`.
 */
import { observable, syncState, when, type Observable, type ObservableParam } from '@legendapp/state';
import { configureSynced, synced } from '@legendapp/state/sync';
import { observablePersistAsyncStorage } from '@legendapp/state/persist-plugins/async-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// The Node pass of the web static export (`expo export -p web`) evaluates modules with no `window`,
// where the AsyncStorage *web* shim (backed by `window.localStorage`) throws the moment it's
// touched. Legend State activates persistence eagerly (the `onChange` in `persisted$` below, and
// `migrateLegacyKey`), so that throw fires at module load and aborts the whole export. The exported
// HTML can't read a device's storage anyway — it only needs each store's `initial` value — so on
// that pass alone we hand the plugin a no-op storage and skip eager hydration. Real browsers
// (`window` present) and native (not 'web'; native AsyncStorage never touches `window`) are
// unaffected — `Platform.OS !== 'web'` keeps this true on device even if RN leaves `window` unset.
const canPersist = Platform.OS !== 'web' || typeof window !== 'undefined';

const noopAsyncStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
  getAllKeys: async () => [],
  multiGet: async () => [],
  multiSet: async () => {},
  multiRemove: async () => {},
} as unknown as typeof AsyncStorage;

// Upstream wrinkle (@legendapp/state 3.0.0-beta.47): its `safeStringify` is
// `value ? JSON.stringify(value) : value`, so a FALSY primitive store value (false / 0 / '')
// reaches `AsyncStorage.setItem` unstringified — React Native's AsyncStorage rejects the
// non-string write ("value is not a string" warning), silently leaving the previously
// persisted value in place. Observed as the dev "Use mock data" toggle turning itself back
// on after every restart: `set(false)` updated the UI but never storage. Wrapping the store
// guarantees every write is a real string; non-falsy values arrive already stringified by
// the plugin and pass through untouched. (Objects never hit this — `{}` is truthy — which is
// why every object-shaped store persisted fine.)
const baseStorage = canPersist ? AsyncStorage : noopAsyncStorage;
const stringSafeStorage = {
  getItem: (k: string) => baseStorage.getItem(k),
  setItem: (k: string, v: unknown) => baseStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)),
  removeItem: (k: string) => baseStorage.removeItem(k),
  getAllKeys: () => baseStorage.getAllKeys(),
  multiGet: (ks: readonly string[]) => baseStorage.multiGet(ks),
  multiSet: (kvs: [string, string][]) => baseStorage.multiSet(kvs),
  multiRemove: (ks: readonly string[]) => baseStorage.multiRemove(ks),
} as unknown as typeof AsyncStorage;

// Same AsyncStorage the query-client persister (`data/query-client.ts`) and the
// embedded stores use, so all of the app's persistence goes through one backend.
// To get synchronous, flicker-free hydration everywhere, swap this single line
// for `@legendapp/state/persist-plugins/mmkv` — no store needs to change.
const persistedSynced = configureSynced(synced, {
  persist: { plugin: observablePersistAsyncStorage({ AsyncStorage: stringSafeStorage }) },
});

/**
 * An observable persisted to AsyncStorage under `name`, seeded with `initial`
 * until the stored value (if any) rehydrates. Legend State already no-ops sets
 * of an unchanged value, so callers don't need the old "skip if equal" guards.
 *
 * The trailing `onChange` is a **permanent activator**. Legend State persistence
 * is lazy — it only hydrates from disk and flushes writes while the observable
 * has an active observer. A mounted `use$(store$)` is one, but the old
 * hand-rolled stores hydrated at module load and persisted on every set
 * regardless of whether any screen was watching (and `getResolvedModeSync()`
 * reads at bootstrap before any component mounts). Subscribing once here keeps
 * each store eagerly loaded and always saving, matching that behavior. These are
 * a handful of app-lifetime singletons, so the standing subscription is free.
 */
export function persisted$<T>(name: string, initial: T): Observable<T> {
  const store$ = observable(persistedSynced({ initial, persist: { name } }));
  // The permanent activator — but not during the storage-less static export, where activating would
  // reach for `window` (see `canPersist`). There, the store just stays at `initial`, which is all
  // the exported HTML needs.
  if (canPersist) store$.onChange(() => {});
  return store$;
}

/**
 * One-time migration off a legacy AsyncStorage key. The pre–Legend State stores
 * wrote some keys as *bare* strings (e.g. a raw URL, or `'on'`/`'off'`) rather
 * than JSON, which Legend State can't parse — so those stores move to a fresh
 * JSON-owned key and adopt any legacy value once. `adopt` receives the raw
 * legacy string and decides how to interpret it and whether to apply it (it
 * should no-op if `store$` already holds a user-set value, so a stale legacy key
 * never clobbers a newer choice).
 *
 * The wait on `isPersistLoaded` is load-order-critical: writing to `store$`
 * before its own persistence has finished loading drops the write, so the
 * adopted value wouldn't survive the next launch. We remove the legacy key
 * regardless, so this is genuinely one-shot.
 */
export function migrateLegacyKey<T>(
  legacyKey: string,
  store$: Observable<T>,
  adopt: (legacyRawValue: string) => void,
): void {
  if (!canPersist) return; // no storage (nor `window`) during the static export — nothing to migrate
  void AsyncStorage.getItem(legacyKey).then(async (raw) => {
    if (raw == null) return;
    await AsyncStorage.removeItem(legacyKey);
    await when(syncState(store$ as ObservableParam).isPersistLoaded);
    adopt(raw);
  });
}
