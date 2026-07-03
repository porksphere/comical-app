/**
 * The persisted list of on-device bridge-registry URLs (each an `index.json` the embedded runtime
 * downloads bridge bundles from). The user adds/removes them in Settings; published builds ship with
 * none. `EXPO_PUBLIC_COMICAL_REGISTRY` (a gitignored `.env.local` value) seeds one for local dev only.
 * Persisted in AsyncStorage; same `useSyncExternalStore` shape as `preference.ts`.
 *
 * `startEmbeddedRuntime` runs before AsyncStorage resolves, so the list isn't known synchronously at
 * launch — the runtime subscribes via `subscribeRegistryUrls` to (re)configure once it hydrates and
 * whenever the user edits it. `getRegistryUrlsSync` returns a stable array reference between changes
 * (required by `useSyncExternalStore`).
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'comical:embedded:registryUrls';
const ENV_DEFAULT = process.env.EXPO_PUBLIC_COMICAL_REGISTRY;
const INITIAL: string[] = ENV_DEFAULT ? [ENV_DEFAULT] : [];

let urls: string[] = INITIAL;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function persist(): void {
  AsyncStorage.setItem(KEY, JSON.stringify(urls)).catch(() => {});
}

// Hydrate the persisted list once (overrides the env seed, including an explicit empty list).
AsyncStorage.getItem(KEY)
  .then((stored) => {
    if (stored === null) return;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        urls = parsed.filter((u): u is string => typeof u === 'string');
        notify();
      }
    } catch {
      /* ignore malformed persisted value */
    }
  })
  .catch(() => {});

/** The current registry URLs (stable reference between changes). */
export function getRegistryUrlsSync(): string[] {
  return urls;
}

/** Add a registry URL (trimmed, de-duplicated). No-op for blanks/duplicates. */
export function addRegistryUrl(url: string): void {
  const u = url.trim();
  if (!u || urls.includes(u)) return;
  urls = [...urls, u];
  notify();
  persist();
}

/** Remove a registry URL. */
export function removeRegistryUrl(url: string): void {
  if (!urls.includes(url)) return;
  urls = urls.filter((u) => u !== url);
  notify();
  persist();
}

/** Fired when the list hydrates from AsyncStorage and on every add/remove. */
export function subscribeRegistryUrls(listener: () => void): () => void {
  return subscribe(listener);
}

/** The registry URLs for the Settings manager. */
export function useRegistryUrls(): string[] {
  return useSyncExternalStore(subscribe, getRegistryUrlsSync, () => INITIAL);
}
