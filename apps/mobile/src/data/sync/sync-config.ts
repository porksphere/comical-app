/**
 * Persisted cross-device-sync configuration — a Legend State observable (see `lib/observable.ts`),
 * per the app's local-state convention. Read in a component with `useSyncConfig()`, or outside React
 * with `getSyncConfig()`.
 *
 * This now holds only the user's on/off preference. The *connection* (server URL, session token,
 * account, server identity) lives in the shared `server-session` store — browse and sync always target
 * the same host, so they share one login. Sync being "active" therefore means: the user has it enabled
 * AND this device is signed in (`isSignedIn`).
 */
import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';
import { getServerSession, isSignedIn } from '../server-session';

export type SyncConfig = {
  /** Whether the sync loop should run. The connection details come from `server-session`. */
  enabled: boolean;
};

const KEY = 'comical:syncConfig';
const DEFAULT: SyncConfig = { enabled: false };

const config$ = persisted$<SyncConfig>(KEY, DEFAULT);

/** Non-React read (spread over defaults so a blob persisted before a field existed still has it). */
export function getSyncConfig(): SyncConfig {
  return { ...DEFAULT, ...config$.peek() };
}

/** Patch + persist. Side effects (start/stop the loop) are the caller's. Returns the new config. */
export function setSyncConfig(patch: Partial<SyncConfig>): SyncConfig {
  config$.assign(patch);
  return getSyncConfig();
}

/** `[config, patch]` for the Settings UI. */
export function useSyncConfig(): [SyncConfig, (patch: Partial<SyncConfig>) => SyncConfig] {
  const value = use$(config$);
  return [{ ...DEFAULT, ...value }, setSyncConfig];
}

/** True once sync is enabled AND this device is signed in to a server. */
export function isSyncActive(c: SyncConfig = getSyncConfig()): boolean {
  return c.enabled && isSignedIn(getServerSession());
}
