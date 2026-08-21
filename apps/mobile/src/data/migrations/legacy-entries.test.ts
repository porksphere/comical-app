/**
 * The library migration, end to end against a real `Library`.
 *
 * This is the one piece of app code that can lose something irreplaceable: it reads the user's
 * shelf, rebuilds it, and deletes the source. `Library.importLegacyEntries` is covered in the
 * submodule; what is covered HERE is the half this repo owns — finding the document, tolerating
 * what a real one might contain, parking it rather than deleting it, and not running twice.
 */
import { beforeEach, describe, expect, test, mock } from 'bun:test';

// AsyncStorage reaches react-native, which bun can't parse (Flow-typed `react-native/index.js`).
// An in-memory stand-in, as `asset-resolve.test.ts` does. It is the migration's ONLY platform
// dependency — the default collection is reached by name, not through a persisted store.
let disk: Record<string, string> = {};
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk[k] ?? null,
    setItem: async (k: string, v: string) => {
      disk[k] = v;
    },
    removeItem: async (k: string) => {
      delete disk[k];
    },
  },
}));
const { InMemoryLibraryStore } = await import('@comical/library');
const { migrateLegacyEntries } = await import('./legacy-entries');
const { DEFAULT_COLLECTION } = await import('../default-collection');

const ENTRIES = 'comical:lib:entries';
const MIGRATED = 'comical:lib:entries.migrated';

const entry = (over: Record<string, unknown> = {}) => ({
  bridgeId: 'demo',
  seriesId: 's1',
  title: 'Series One',
  addedAt: 500,
  updatedAt: 600,
  knownChapters: [{ id: 'c1', number: 1 }],
  ...over,
});

/** The document as the old store actually wrote it: keyed by `${bridgeId}:${seriesId}`. */
const doc = (...entries: Record<string, unknown>[]) =>
  JSON.stringify(Object.fromEntries(entries.map((e) => [`${e.bridgeId}:${e.seriesId}`, e])));

describe('migrateLegacyEntries', () => {
  beforeEach(() => {
    disk = {};
  });

  test('rebuilds the shelf, parks the source, and files into the default collection', async () => {
    disk[ENTRIES] = doc(entry(), entry({ seriesId: 's2', title: 'Series Two' }));
    const store = new InMemoryLibraryStore();

    const result = await migrateLegacyEntries(store);
    expect(result).toMatchObject({ imported: 2, skipped: 0 });

    const items = await store.listCollectionItems({ type: 'series' });
    expect(items.map((i) => i.seriesId).sort()).toEqual(['s1', 's2']);
    // Filed, because an unfiled series is swept by the next thing that touches it.
    const collections = await store.listCollections();
    expect(collections).toHaveLength(1);
    expect(collections[0]?.name).toBe(DEFAULT_COLLECTION);
    expect(items.every((i) => i.collectionIds.includes(collections[0]!.id))).toBe(true);
    // Filing under the default collection's own NAME is what makes the rebuilt shelf this device's
    // default — `resolveDefaultCollection` finds it there on the first save and pins its id from
    // then on. Deliberately not pinned here: a persisted write at startup lands inside the window
    // where Legend State drops it, silently.

    // The source survives, renamed — it is the only copy of the shelf until a device confirms it.
    expect(disk[ENTRIES]).toBeUndefined();
    expect(disk[MIGRATED]).toBeDefined();
    expect(JSON.parse(disk[MIGRATED]!)['demo:s1']).toMatchObject({ title: 'Series One' });
  });

  test('reattaches the progress the dissolution orphaned', async () => {
    // The entire reason this migration exists rather than a wipe: progress is keyed by entryKey in
    // its own document, so it outlived the entries doc and simply needs its series back.
    const store = new InMemoryLibraryStore();
    await store.putProgress('demo:s1', { chapterId: 'c1', read: true, number: 1, updatedAt: 1 });
    disk[ENTRIES] = doc(entry());

    await migrateLegacyEntries(store);
    expect(await store.listProgress('demo:s1')).toHaveLength(1);
  });

  test('does nothing on a second run', async () => {
    disk[ENTRIES] = doc(entry());
    const store = new InMemoryLibraryStore();
    await migrateLegacyEntries(store);
    expect(await migrateLegacyEntries(store)).toBeUndefined();
    expect((await store.listCollectionItems({ type: 'series' })).length).toBe(1);
  });

  test('does nothing on a fresh install', async () => {
    expect(await migrateLegacyEntries(new InMemoryLibraryStore())).toBeUndefined();
  });

  test('tolerates a bare array, which is the other shape a host may have written', async () => {
    disk[ENTRIES] = JSON.stringify([entry(), entry({ seriesId: 's2' })]);
    expect(await migrateLegacyEntries(new InMemoryLibraryStore())).toMatchObject({ imported: 2 });
  });

  test('imports what it can from a half-corrupt document', async () => {
    // A malformed row costs that row, never the whole shelf.
    disk[ENTRIES] = doc(entry(), { bridgeId: 'demo', seriesId: 's3' } as never);
    expect(await migrateLegacyEntries(new InMemoryLibraryStore())).toMatchObject({ imported: 1, skipped: 1 });
  });

  test('leaves an unreadable document exactly where it is', async () => {
    // Nothing is gained by parking evidence away, and a later version may salvage more.
    disk[ENTRIES] = '{not json';
    expect(await migrateLegacyEntries(new InMemoryLibraryStore())).toBeUndefined();
    expect(disk[ENTRIES]).toBe('{not json');
    expect(disk[MIGRATED]).toBeUndefined();
  });

  test('leaves an empty document alone rather than reporting a migration', async () => {
    disk[ENTRIES] = '{}';
    expect(await migrateLegacyEntries(new InMemoryLibraryStore())).toBeUndefined();
  });
});
