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
import { observable, type Observable } from '@legendapp/state';
import { configureSynced, synced } from '@legendapp/state/sync';
import { observablePersistAsyncStorage } from '@legendapp/state/persist-plugins/async-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Same AsyncStorage the query-client persister (`data/query-client.ts`) and the
// embedded stores use, so all of the app's persistence goes through one backend.
// To get synchronous, flicker-free hydration everywhere, swap this single line
// for `@legendapp/state/persist-plugins/mmkv` — no store needs to change.
const persistedSynced = configureSynced(synced, {
  persist: { plugin: observablePersistAsyncStorage({ AsyncStorage }) },
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
  store$.onChange(() => {});
  return store$;
}
