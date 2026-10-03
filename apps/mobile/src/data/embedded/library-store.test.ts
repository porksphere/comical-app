/**
 * The activity feed's store contract, which sync leans on: a row is recorded once, and a drop takes
 * exactly the rows it names.
 */
import { describe, expect, mock, test } from 'bun:test';

const mem = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      mem.delete(k);
    },
  },
}));

const { AsyncStorageLibraryStore } = await import('./library-store');

const row = (chapterId: string, detectedAt = 1) => ({ bridgeId: 'bridge-a', seriesId: 's1', chapterId, title: 'One', detectedAt });

describe('AsyncStorageLibraryStore activity', () => {
  test('a row is put once: a second put of it keeps the first and says so', async () => {
    mem.clear();
    const store = new AsyncStorageLibraryStore();
    expect(await store.putActivity(row('ch1', 1))).toBe(true);
    expect(await store.putActivity(row('ch1', 9))).toBe(false);
    expect(await store.listActivity()).toEqual([row('ch1', 1)]);
  });

  test('a drop takes the rows it names and ignores ones it does not hold', async () => {
    mem.clear();
    const store = new AsyncStorageLibraryStore();
    await store.putActivity(row('ch1'));
    await store.putActivity(row('ch2'));
    await store.dropActivity(['bridge-a:s1:ch1', 'bridge-a:s1:missing']);
    expect((await store.listActivity()).map((a) => a.chapterId)).toEqual(['ch2']);
    expect(await store.putActivity(row('ch1'))).toBe(true);
  });
});
