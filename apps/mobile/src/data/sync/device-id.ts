/**
 * A stable per-install device id — the `node` half of every HLC this device stamps. It MUST be
 * stable across restarts (a new id each launch would break tie-breaks and make this device look like
 * a different peer), so it's generated once and persisted. Not secret.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'comical:sync:device-id';

function randomId(): string {
  // Prefer crypto.randomUUID (WebCrypto shim on RN); fall back to random bytes → hex.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = c?.getRandomValues ? c.getRandomValues(new Uint8Array(8)) : new Uint8Array(8);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: string | undefined;

/** Get (or lazily create + persist) this install's device id. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(KEY);
  if (stored) return (cached = stored);
  const id = randomId();
  await AsyncStorage.setItem(KEY, id);
  return (cached = id);
}
