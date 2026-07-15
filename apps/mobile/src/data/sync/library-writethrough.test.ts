/**
 * Write-through wrapper tests. Mutating through the wrapped store must (a) hit the real store AND
 * (b) mirror into the replica so the change is queued for sync — the steady-state alternative to
 * re-hydrating. Verified end-to-end: edits made through device A's wrapped store land in device B's
 * store after a sync, with progress still monotonic.
 */
import { describe, expect, test } from 'bun:test';
import { InMemoryLibraryStore, type ChapterProgress, type LibraryEntry } from '@comical/library';
import { Clock, compositeId , Replica , MemoryBackend , SyncEngine, MemoryCursor , LibraryStoreBridge , wrapLibraryStore } from '@comical/sync';






const time = { t: 1000 };
const mkEntry = (bridgeId: string, seriesId: string, title: string): LibraryEntry =>
  ({ bridgeId, seriesId, title, listIds: [], addedAt: time.t, updatedAt: time.t });
const mkProgress = (chapterId: string, lastPage: number): ChapterProgress =>
  ({ chapterId, read: false, lastPage, pageCount: 20, number: 1, updatedAt: time.t });

describe('wrapLibraryStore', () => {
  test('a write through the wrapper is queued in the replica outbox', async () => {
    const replica = new Replica(new Clock('A', () => time.t));
    const store = wrapLibraryStore(new InMemoryLibraryStore(), replica);
    time.t = 1000;
    await store.putEntry(mkEntry('md', 's1', 'One'));
    await store.putProgress('md:s1', mkProgress('c1', 7));
    expect(replica.liveIds('entries')).toEqual(['md:s1']);
    expect(replica.progress(compositeId.progress('md:s1', 'c1'))?.lastPage).toBe(7);
    expect(replica.outbox().length).toBe(2); // both changes queued for the next push
  });

  test('edits through device A propagate to device B, progress stays monotonic', async () => {
    const backend = new MemoryBackend();
    const repA = new Replica(new Clock('A', () => time.t));
    const repB = new Replica(new Clock('B', () => time.t));
    const rawA = new InMemoryLibraryStore();
    const rawB = new InMemoryLibraryStore();
    const storeA = wrapLibraryStore(rawA, repA);
    const engA = new SyncEngine(repA, backend, new MemoryCursor());
    const engB = new SyncEngine(repB, backend, new MemoryCursor());
    const bridgeB = new LibraryStoreBridge(rawB);

    // App on A edits through the wrapped store; no explicit hydrate needed.
    time.t = 1000; await storeA.putEntry(mkEntry('md', 's1', 'One'));
    time.t = 1100; await storeA.putProgress('md:s1', mkProgress('c1', 10));
    await engA.sync();
    await engB.sync();
    await bridgeB.apply(repB);

    expect((await rawB.listEntries()).map((e) => e.title)).toEqual(['One']);
    expect((await rawB.listProgress('md:s1'))[0]?.lastPage).toBe(10);

    // A stale, lower read on A must not roll back what B already has.
    time.t = 900; await storeA.putProgress('md:s1', mkProgress('c1', 4)); // earlier stamp, fewer pages
    await engA.sync();
    await engB.sync();
    await bridgeB.apply(repB);
    expect((await rawB.listProgress('md:s1'))[0]?.lastPage).toBe(10); // furthest read holds
  });
});

describe('chapters sync per chapter, not per list', () => {
  const chapters = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, number: i + 1, languageCode: 'en' }));
  const outboxBytes = (r: Replica) => JSON.stringify(r.outbox()).length;

  test('a refresh that adds ONE chapter to a huge series queues one record', async () => {
    const replica = new Replica(new Clock('A', () => time.t++));
    const store = wrapLibraryStore(new InMemoryLibraryStore(), replica);
    await store.putEntry(mkEntry('md', 's1', 'Long Series'));
    await store.putChapters('md:s1', chapters(2000));
    replica.clearOutbox(); // pretend the first sync happened

    await store.putChapters('md:s1', [...chapters(2000), { id: 'c2000', number: 2001, languageCode: 'en' }]);

    // The whole point: 1 record, not 2000. Unchanged chapters are not re-stamped.
    expect(replica.outbox()).toHaveLength(1);
    expect(replica.outbox()[0]!.id).toBe(compositeId.chapter('md:s1', 'c2000'));
  });

  test('THE REGRESSION THIS EXISTS TO PREVENT: a page turn does not push the chapter list', async () => {
    const replica = new Replica(new Clock('A', () => time.t++));
    const store = wrapLibraryStore(new InMemoryLibraryStore(), replica);
    const entry = mkEntry('md', 's1', 'Long Series');
    await store.putEntry(entry);
    await store.putChapters('md:s1', chapters(2000));
    replica.clearOutbox();

    // A page turn: progress, plus the entry's resume cache. Neither may carry the chapter list.
    await store.putProgress('md:s1', mkProgress('c1', 12));
    await store.putEntry({ ...entry, lastReadChapterId: 'c1', lastReadAt: time.t, updatedAt: time.t });

    expect(replica.outbox()).toHaveLength(2); // the progress record and the entry — no chapters
    expect(replica.outbox().some((r) => r.table === 'chapters')).toBe(false);
    // Chapter lists used to ride along inside the entry register: ~73KB for a series this long.
    expect(outboxBytes(replica)).toBeLessThan(1000);
  });

  test('a delisted chapter is tombstoned, so it does not come back on the next merge', async () => {
    const backend = new MemoryBackend();
    const repA = new Replica(new Clock('A', () => time.t++));
    const repB = new Replica(new Clock('B', () => time.t++));
    const rawA = new InMemoryLibraryStore();
    const rawB = new InMemoryLibraryStore();
    const storeA = wrapLibraryStore(rawA, repA);
    const engA = new SyncEngine(repA, backend, new MemoryCursor());
    const engB = new SyncEngine(repB, backend, new MemoryCursor());
    const bridgeB = new LibraryStoreBridge(rawB);

    await storeA.putEntry(mkEntry('md', 's1', 'One'));
    await storeA.putChapters('md:s1', chapters(3));
    await engA.sync();
    await engB.sync();
    await bridgeB.apply(repB);
    expect((await rawB.listChapters('md:s1')).map((c) => c.id).sort()).toEqual(['c0', 'c1', 'c2']);

    // The source drops c1. B must lose it too — not resurrect it from its own copy.
    await storeA.putChapters('md:s1', [{ id: 'c0', number: 1, languageCode: 'en' }, { id: 'c2', number: 3, languageCode: 'en' }]);
    await engA.sync();
    await engB.sync();
    await bridgeB.apply(repB);
    expect((await rawB.listChapters('md:s1')).map((c) => c.id).sort()).toEqual(['c0', 'c2']);
  });

  test('removing the series on A drops its chapters on B', async () => {
    const backend = new MemoryBackend();
    const repA = new Replica(new Clock('A', () => time.t++));
    const repB = new Replica(new Clock('B', () => time.t++));
    const rawA = new InMemoryLibraryStore();
    const rawB = new InMemoryLibraryStore();
    const storeA = wrapLibraryStore(rawA, repA);
    const engA = new SyncEngine(repA, backend, new MemoryCursor());
    const engB = new SyncEngine(repB, backend, new MemoryCursor());
    const bridgeB = new LibraryStoreBridge(rawB);

    await storeA.putEntry(mkEntry('md', 's1', 'One'));
    await storeA.putChapters('md:s1', chapters(3));
    await engA.sync();
    await engB.sync();
    await bridgeB.apply(repB);

    await storeA.deleteEntry('md:s1');
    await engA.sync();
    await engB.sync();
    await bridgeB.apply(repB);

    expect(await rawB.listEntries()).toEqual([]);
    expect(await rawB.listChapters('md:s1')).toEqual([]); // cascaded, not orphaned
  });

  test('a replica with no chapter records does not wipe a store that has them', async () => {
    // The dangerous case during rollout: B has chapters locally but has never seen a chapter record.
    // apply() must leave them alone rather than "converge" them to empty.
    const rawB = new InMemoryLibraryStore();
    await rawB.putEntry(mkEntry('md', 's1', 'One'));
    await rawB.putChapters('md:s1', chapters(3));

    const repB = new Replica(new Clock('B', () => time.t++));
    repB.putRegister('entries', 'md:s1', mkEntry('md', 's1', 'One'));
    await new LibraryStoreBridge(rawB).apply(repB);

    expect((await rawB.listChapters('md:s1')).map((c) => c.id).sort()).toEqual(['c0', 'c1', 'c2']);
  });
});
