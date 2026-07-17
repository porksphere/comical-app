/**
 * The AsyncStorage downloads store's serialization guarantee: every op is an async read-modify-write
 * on a shared doc, and callers run concurrently (a bulk series download's many enqueues) — without
 * the queue, interleaved writers lost records (the "chapter not downloaded" crash after pausing a
 * series mid-collection). The mock's async tick opens exactly that interleaving window.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { DownloadedChapter, DownloadedPage } from '@comical/downloads';

const mem = new Map<string, string>();
const tick = () => new Promise((r) => setTimeout(r, 0));
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      await tick(); // the interleaving window: another writer can slip in between read and write
      return mem.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      await tick();
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      await tick();
      mem.delete(k);
    },
    getAllKeys: async () => [...mem.keys()],
    multiGet: async (keys: string[]) => keys.map((k) => [k, mem.get(k) ?? null]),
  },
}));

const { AsyncStorageDownloadsStore } = await import('./async-store');

const chapter = (id: string): DownloadedChapter =>
  ({ bridgeId: 'b', seriesId: 's', chapterId: id, pageCount: 1, completedPages: 0, bytes: 0, state: 'queued', addedAt: 1 }) as DownloadedChapter;
const page = (index: number): DownloadedPage => ({ index, sourceUrl: `/img/${index}`, file: '', bytes: 0, state: 'queued' });

describe('AsyncStorageDownloadsStore serialization', () => {
  test('concurrent putChapter calls never drop records', async () => {
    mem.clear();
    const store = new AsyncStorageDownloadsStore();
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.putChapter(chapter(`c${i}`))));
    const all = await store.listChapters('b:s');
    expect(all.map((c) => c.chapterId).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}`).sort());
  });

  test('concurrent page writes to one chapter all land', async () => {
    mem.clear();
    const store = new AsyncStorageDownloadsStore();
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.putPage('b:s', 'c1', page(i))));
    expect((await store.listPages('b:s', 'c1')).map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('a delete interleaved with puts leaves a consistent doc', async () => {
    mem.clear();
    const store = new AsyncStorageDownloadsStore();
    await store.putChapter(chapter('keep'));
    await Promise.all([
      store.putChapter(chapter('a')),
      store.deleteChapter('b:s', 'keep'),
      store.putChapter(chapter('b')),
    ]);
    const ids = (await store.listChapters('b:s')).map((c) => c.chapterId).sort();
    expect(ids).toEqual(['a', 'b']);
  });
});
