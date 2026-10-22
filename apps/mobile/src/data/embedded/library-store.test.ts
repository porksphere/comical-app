/**
 * The store contract sync and id migrations lean on: an activity row is recorded once, a drop takes
 * exactly the rows it names, and a progress delete takes exactly the chapters it names.
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

const progress = (chapterId: string) => ({ chapterId, read: true, lastPage: 1, pageCount: 1, updatedAt: 1 });

describe('AsyncStorageLibraryStore progress', () => {
  test('a delete takes the chapters it names, and the last one takes the document', async () => {
    mem.clear();
    const store = new AsyncStorageLibraryStore();
    await store.putProgress('bridge-a:s1', progress('ch1'));
    await store.putProgress('bridge-a:s1', progress('ch2'));
    await store.deleteProgress('bridge-a:s1', ['ch1', 'missing']);
    expect((await store.listProgress('bridge-a:s1')).map((p) => p.chapterId)).toEqual(['ch2']);
    await store.deleteProgress('bridge-a:s1', ['ch2']);
    expect([...mem.keys()].some((k) => k.startsWith('comical:lib:progress:'))).toBe(false);
  });
});

describe('AsyncStorageLibraryStore id-migration marks', () => {
  test('are kept per bridge until cleared', async () => {
    mem.clear();
    const store = new AsyncStorageLibraryStore();
    expect(await store.getIdMigrationMark('bridge-a')).toBeUndefined();
    await store.setIdMigrationMark('bridge-a', '1.2.0');
    await store.setIdMigrationMark('bridge-b', '3.0.0');
    expect(await store.getIdMigrationMark('bridge-a')).toBe('1.2.0');
    await store.clearIdMigrationMarks();
    expect(await store.getIdMigrationMark('bridge-b')).toBeUndefined();
  });
});
