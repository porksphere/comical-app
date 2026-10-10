/**
 * Stored bytes a store can't read. Reading them as "empty" is what loses data — the next write
 * replaces the whole document with that empty view — so they are MOVED to a key of their own,
 * logged, and the caller carries on from its fallback. The parked key sits outside every store's
 * listing prefix (`comical:lib:collection-items:`, `comical:lib:progress:`, …), so nothing lists it
 * back in as data.
 *
 * Standalone on purpose: `stores.ts` starts hydrating (and pulls in host-rn) on import.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { logDiagnostic } from '@/lib/diagnostics';

export const CORRUPT_PREFIX = 'comical:corrupt:';

export async function quarantine(storageKey: string, raw: string): Promise<void> {
  const parked = `${CORRUPT_PREFIX}${storageKey}:${Date.now()}`;
  logDiagnostic('storage', `discarded a malformed value for ${storageKey}`, {
    context: `${raw.length} bytes preserved at ${parked}`,
  });
  try {
    await AsyncStorage.setItem(parked, raw);
    // Only what was read: a writer that replaced it in the meantime has already fixed the key.
    if ((await AsyncStorage.getItem(storageKey)) === raw) await AsyncStorage.removeItem(storageKey);
  } catch {
    /* best effort — the caller starts from its fallback either way */
  }
}

/**
 * `raw` parsed, when it is the kind of value `fallback` is — an array for an array, otherwise an
 * object (`undefined` stands in for an optional one). Anything else is quarantined and `fallback`
 * returned.
 */
export async function parseStored<T>(storageKey: string, raw: string, fallback: T): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  if (Array.isArray(fallback) ? Array.isArray(value) : isObject(value)) return value as T;
  await quarantine(storageKey, raw);
  return fallback;
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
