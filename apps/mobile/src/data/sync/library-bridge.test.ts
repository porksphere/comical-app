/**
 * Phase-1b bridge tests, against the REAL `@comical/library` `InMemoryLibraryStore` (not a fake).
 * Proves the whole stack — store → hydrate → engine/backend → apply → store — converges, and that
 * the monotonic-progress guarantee holds at the actual `ChapterProgress` level, not just in the
 * replica. Run: `bun test src/data/sync/library-bridge.test.ts` from apps/mobile.
 *
 * Usage pattern shown here: `hydrate` is a one-time bootstrap of existing store data; subsequent
 * live edits are written through to the replica directly (as a write-through store layer would),
 * NOT by re-hydrating — re-hydrating would re-stamp unchanged rows and could clobber remote edits.
 */
import { describe, expect, test } from 'bun:test';
import { InMemoryLibraryStore, entryKey, type ChapterProgress, type LibraryEntry } from '@comical/library';
import { Clock, compositeId , Replica , MemoryBackend , SyncEngine, MemoryCursor , LibraryStoreBridge } from '@comical/sync';





const time = { t: 1000 };
function device(node: string, backend: MemoryBackend) {
  const store = new InMemoryLibraryStore();
  const replica = new Replica(new Clock(node, () => time.t));
  const bridge = new LibraryStoreBridge(store);
  const engine = new SyncEngine(replica, backend, new MemoryCursor());
  return { store, replica, bridge, engine };
}
const mkEntry = (bridgeId: string, seriesId: string, title: string, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  bridgeId, seriesId, title, listIds: [], addedAt: time.t, updatedAt: time.t, ...over,
});
const mkProgress = (chapterId: string, over: Partial<ChapterProgress> = {}): ChapterProgress => ({
  chapterId, read: false, lastPage: 0, pageCount: 20, number: 1, updatedAt: time.t, ...over,
});

describe('LibraryStoreBridge (real InMemoryLibraryStore)', () => {
  test('an existing library replicates in full to a fresh device', async () => {
    const backend = new MemoryBackend();
    const A = device('A', backend);
    time.t = 1000;
    await A.store.putEntry(mkEntry('md', 's1', 'One'));
    await A.store.putProgress('md:s1', mkProgress('c1', { read: true, lastPage: 5 }));
    await A.store.putList({ id: 'l1', name: 'Reading', order: 0 });
    await A.bridge.hydrate(A.replica);
    await A.engine.sync();

    const B = device('B', backend);
    await B.engine.sync();
    await B.bridge.apply(B.replica);

    expect((await B.store.listEntries()).map((e) => e.title)).toEqual(['One']);
    expect((await B.store.listLists()).map((l) => l.name)).toEqual(['Reading']);
    const prog = await B.store.listProgress('md:s1');
    expect(prog[0]?.lastPage).toBe(5);
    expect(prog[0]?.read).toBe(true);
  });

  test('hydrate projects chapters as their own records; apply reassembles the list', async () => {
    const backend = new MemoryBackend();
    const A = device('A', backend);
    time.t = 1000;
    await A.store.putEntry(mkEntry('md', 's1', 'One'));
    await A.store.putChapters('md:s1', [
      { id: 'c1', number: 1, languageCode: 'en' },
      { id: 'c2', number: 2, languageCode: 'en' },
    ]);
    await A.bridge.hydrate(A.replica);

    // One record per chapter — and the entry register does NOT carry the list.
    expect(A.replica.liveIds('chapters')).toHaveLength(2);
    expect(A.replica.registerValue<Record<string, unknown>>('entries', 'md:s1')).not.toHaveProperty('knownChapters');

    await A.engine.sync();
    const B = device('B', backend);
    await B.engine.sync();
    await B.bridge.apply(B.replica);

    const chapters = await B.store.listChapters('md:s1');
    expect(chapters.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(chapters.find((c) => c.id === 'c2')?.number).toBe(2);
  });

  test('concurrent stale progress does NOT roll back the stored read position', async () => {
    const backend = new MemoryBackend();
    const A = device('A', backend);
    const B = device('B', backend);

    // Seed the entry on A and replicate it to B.
    time.t = 1000;
    await A.store.putEntry(mkEntry('md', 's1', 'One'));
    await A.bridge.hydrate(A.replica);
    await A.engine.sync();
    await B.engine.sync();
    await B.bridge.apply(B.replica);

    // Concurrent reads, written through to each replica; B's is LATER but shorter.
    const pid = compositeId.progress(entryKey('md', 's1'), 'c1');
    time.t = 2000; A.replica.putProgress(pid, { read: false, lastPage: 10, pageCount: 20, number: 1 });
    time.t = 2001; B.replica.putProgress(pid, { read: false, lastPage: 3, pageCount: 20, number: 1 });

    // Exchange and write back to both stores.
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    await A.bridge.apply(A.replica);
    await B.bridge.apply(B.replica);

    expect((await A.store.listProgress('md:s1'))[0]?.lastPage).toBe(10);
    expect((await B.store.listProgress('md:s1'))[0]?.lastPage).toBe(10); // furthest read wins in the STORE
  });

  test('a removal propagates and cascades to progress', async () => {
    const backend = new MemoryBackend();
    const A = device('A', backend);
    const B = device('B', backend);

    time.t = 1000;
    await A.store.putEntry(mkEntry('md', 's1', 'One'));
    await A.store.putProgress('md:s1', mkProgress('c1', { read: true, lastPage: 9 }));
    await A.bridge.hydrate(A.replica);
    await A.engine.sync();
    await B.engine.sync();
    await B.bridge.apply(B.replica);
    expect(await B.store.listEntries()).toHaveLength(1);

    // A removes the entry (write-through to the replica), then sync.
    time.t = 2000; A.replica.deleteRegister('entries', entryKey('md', 's1'));
    await A.engine.sync();
    await B.engine.sync();
    await B.bridge.apply(B.replica);

    expect(await B.store.listEntries()).toHaveLength(0);
    expect(await B.store.listProgress('md:s1')).toHaveLength(0); // cascade
  });
});
