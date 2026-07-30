/**
 * AsyncStorage-backed `SettingsStore` factory — the on-device analog of the server's file-backed
 * per-bridge / per-tracker settings. One JSON blob per id under a namespaced key. Bridges and
 * trackers get separate namespaces (`asyncStorageSettings` / `asyncStorageTrackerSettings`) so a
 * bridge id and a tracker id that happen to collide (not guaranteed distinct — different registries)
 * can never cross-write each other's settings.
 *
 * `get`/`set` are each a single AsyncStorage round trip, so they don't need serializing on their
 * own — the actual read-modify-write risk is in the *callers* composing `get` then `set` across two
 * separate calls (`updateSettings`, a tracker's OAuth-token drain). `EmbeddedBridgeProvider`/
 * `EmbeddedTrackerProvider` (host-rn) serialize those per id with `KeyedQueue` — that's the right
 * layer, since serializing here would also block unrelated ids' reads/writes behind each other for
 * no reason.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SettingValue } from '@comical/contract';
import type { SettingsStore } from '@comical/host-rn';

function makeAsyncStorageSettings(namespace: string): SettingsStore {
  const keyFor = (id: string): string => `comical:embedded:${namespace}:${id}`;
  return {
    async get(id) {
      const raw = await AsyncStorage.getItem(keyFor(id));
      if (!raw) return {};
      try {
        return JSON.parse(raw) as Record<string, SettingValue>;
      } catch {
        return {};
      }
    },
    async set(id, values) {
      await AsyncStorage.setItem(keyFor(id), JSON.stringify(values));
    },
  };
}

/** Per-bridge settings. Namespace kept as `settings` (not `bridgeSettings`) for backward
 *  compatibility with already-persisted keys — this predates the tracker namespace existing. */
export const asyncStorageSettings: SettingsStore = makeAsyncStorageSettings('settings');

/** Per-tracker settings (OAuth tokens, form fields) — a separate namespace from bridge settings. */
export const asyncStorageTrackerSettings: SettingsStore = makeAsyncStorageSettings('trackerSettings');
