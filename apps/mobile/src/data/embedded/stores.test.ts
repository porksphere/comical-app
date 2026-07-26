/**
 * `AsyncKeyedStore`'s read-failure contract. The store writes its whole in-memory mirror on every
 * `add`, so treating a failed read as "empty" is silent, permanent data loss: the mirror sits at its
 * seed, every screen reports nothing installed, and the next install persists a one-item array over
 * the real list. These tests pin the two halves — a transient read failure must propagate and retry,
 * a malformed value must be quarantined rather than overwritten unseen.
 */
import { describe, expect, mock, test } from 'bun:test';

const mem = new Map<string, string>();
let failNextReads = 0;

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      if (failNextReads > 0) {
        failNextReads -= 1;
        throw new Error('AsyncStorage unavailable');
      }
      return mem.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      mem.delete(k);
    },
  },
}));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: () => {} }));

const { AsyncKeyedStore } = await import('./stores');

type Rec = { id: string; version: string };
const rec = (id: string, version = '1.0.0'): Rec => ({ id, version });
const newStore = (key = 'k', seed: Rec[] = []) => new AsyncKeyedStore<Rec>(key, (r) => r.id, seed);

describe('AsyncKeyedStore', () => {
  test('round-trips through storage', async () => {
    mem.clear();
    const a = newStore();
    await a.add(rec('alpha'));
    await a.add(rec('beta'));
    expect((await newStore().all()).map((r) => r.id).sort()).toEqual(['alpha', 'beta']);
  });

  test('a failed read propagates instead of reporting an empty store', async () => {
    mem.clear();
    mem.set('k', JSON.stringify([rec('alpha'), rec('beta')]));
    failNextReads = 1;
    const store = newStore();
    // The regression: this used to resolve to [] — indistinguishable from "you have none installed",
    // which is what made two installed bridges show as never-installed.
    await expect(store.all()).rejects.toThrow(/unavailable/);
  });

  test('retries the read on the next access, and recovers', async () => {
    mem.clear();
    mem.set('k', JSON.stringify([rec('alpha')]));
    failNextReads = 1;
    const store = newStore();
    await expect(store.all()).rejects.toThrow(/unavailable/);
    expect((await store.all()).map((r) => r.id)).toEqual(['alpha']);
  });

  test('a write is refused while the mirror is unhydrated, leaving stored data intact', async () => {
    mem.clear();
    const stored = JSON.stringify([rec('alpha'), rec('beta')]);
    mem.set('k', stored);
    failNextReads = 1;
    const store = newStore();
    // The data-loss path: one transient read failure + one install used to persist `[gamma]`
    // over both existing records, unrecoverably.
    await expect(store.add(rec('gamma'))).rejects.toThrow(/unavailable/);
    expect(mem.get('k')).toBe(stored);
    // …and once the read succeeds, the install lands on top of the real list.
    await store.add(rec('gamma'));
    expect((await store.all()).map((r) => r.id).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('remove is refused while unhydrated too', async () => {
    mem.clear();
    const stored = JSON.stringify([rec('alpha')]);
    mem.set('k', stored);
    failNextReads = 1;
    const store = newStore();
    await expect(store.remove('alpha')).rejects.toThrow(/unavailable/);
    expect(mem.get('k')).toBe(stored);
  });

  test('a malformed value is quarantined, not silently overwritten', async () => {
    mem.clear();
    mem.set('k', '{"not":"an array"');
    const store = newStore();
    expect(await store.all()).toEqual([]); // unrecoverable bytes — start fresh rather than wedge
    await store.add(rec('gamma'));
    expect(mem.get('k:corrupt')).toBe('{"not":"an array"');
  });

  test('a non-array JSON value is quarantined as well', async () => {
    mem.clear();
    mem.set('k', '{"id":"alpha"}');
    const store = newStore();
    expect(await store.all()).toEqual([]);
    expect(mem.get('k:corrupt')).toBe('{"id":"alpha"}');
  });

  test('keeps the seed when nothing is persisted yet', async () => {
    mem.clear();
    expect((await newStore('k', [rec('seeded')]).all()).map((r) => r.id)).toEqual(['seeded']);
  });

  test('concurrent adds all survive (each write persists the full mirror, in order)', async () => {
    mem.clear();
    const store = newStore();
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.add(rec(`b${i}`))));
    expect(JSON.parse(mem.get('k')!)).toHaveLength(10);
    expect((await newStore().all()).map((r) => r.id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `b${i}`).sort(),
    );
  });

  test('add upserts by key', async () => {
    mem.clear();
    const store = newStore();
    await store.add(rec('alpha', '0.2.2'));
    await store.add(rec('alpha', '0.2.3'));
    expect(await store.all()).toEqual([rec('alpha', '0.2.3')]);
    expect(await store.get('alpha')).toEqual(rec('alpha', '0.2.3'));
  });
});
