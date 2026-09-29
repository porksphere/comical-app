/**
 * The device side of library sync: pairing, recording through the router's store, and the order a
 * fresh pairing takes (pull first, then adopt), against an in-process hub.
 */
import { describe, expect, test } from 'bun:test';
import { InMemoryLibraryStore, Library } from '@comical/library';
import { MemorySegmentStore, SyncHub, type SyncBackend } from '@comical/sync';

import { createLibrarySync, type LibrarySyncOptions, type SyncDoc } from './controller';

let ids = 0;

function device(hub: SyncBackend, overrides: Partial<LibrarySyncOptions> = {}) {
  const raw = new InMemoryLibraryStore();
  let saved: SyncDoc | null = null;
  const sync = createLibrarySync({
    raw,
    load: async () => saved,
    save: async (doc) => {
      saved = doc;
    },
    backend: () => hub,
    canSync: () => true,
    newDeviceId: () => `dev-${++ids}`,
    onApplied: () => {},
    onStatus: () => {},
    log: () => {},
    debounceMs: 60_000,
    ...overrides,
  });
  return { raw, sync, library: new Library(sync.store), saved: () => saved };
}

const names = async (lib: Library) => (await lib.getCollections()).map((c) => c.name).sort();

describe('createLibrarySync', () => {
  test("pairing sends this device's library, and a second device receives it", async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.library.createCollection('Before pairing');
    await a.sync.enable();
    await a.library.createCollection('After pairing');
    await a.sync.syncNow();

    const b = device(hub);
    await b.sync.enable();
    expect(await names(b.library)).toEqual(['After pairing', 'Before pairing']);
  });

  test('is off until enabled, and records nothing meanwhile', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.library.createCollection('Local');
    expect(a.sync.status().enabled).toBe(false);
    expect(await a.sync.syncNow()).toBeUndefined();
    expect(a.saved()).toBeNull();
    expect((await hub.pull({})).segments).toHaveLength(0);
  });

  test("what the hub holds wins over this device's copy when pairing", async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    const c = await a.library.createCollection('Hub name');
    await a.sync.syncNow();

    // b already has the same collection under an older name.
    const b = device(hub);
    await b.raw.putCollections([{ ...c, name: 'Stale name' }]);
    await b.sync.enable();
    expect(await names(b.library)).toEqual(['Hub name']);
  });

  test('adopts only after a pull has succeeded', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    const c = await a.library.createCollection('Hub name');
    await a.sync.syncNow();

    let online = false;
    const flaky: SyncBackend = {
      push: (s) => (online ? hub.push(s) : Promise.reject(new Error('offline'))),
      pull: (have, limit) => (online ? hub.pull(have, limit) : Promise.reject(new Error('offline'))),
    };
    const b = device(flaky);
    await b.raw.putCollections([{ ...c, name: 'Stale name' }]);
    await b.sync.enable();
    expect(b.sync.status().lastError).toBe('offline');
    expect(b.saved()?.adopted).toBe(false);

    online = true;
    await b.sync.syncNow();
    expect(b.saved()?.adopted).toBe(true);
    expect(b.sync.status().lastError).toBeUndefined();
    expect(await names(b.library)).toEqual(['Hub name']);
  });

  test('a write made before the saved state loads is still recorded', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    await a.sync.syncNow();

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const doc = a.saved();
    const restarted = device(hub, { load: async () => (await gate, doc) });
    const write = restarted.library.createCollection('Written during load');
    release();
    await write;
    await restarted.sync.syncNow();

    const b = device(hub);
    await b.sync.enable();
    expect(await names(b.library)).toEqual(['Written during load']);
  });

  test('turning sync off forgets the pairing; turning it back on starts a new device', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    const first = a.saved()!.state.device;
    await a.sync.disable();
    expect(a.saved()).toBeNull();
    expect(a.sync.status().enabled).toBe(false);

    await a.sync.enable();
    expect(a.saved()!.state.device).not.toBe(first);
  });

  test('holds rounds while the app is on a remote server', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    let embedded = false;
    const a = device(hub, { canSync: () => embedded });
    await a.sync.enable();
    await a.library.createCollection('Held');
    expect(await a.sync.syncNow()).toBeUndefined();

    embedded = true;
    expect((await a.sync.syncNow())?.pushed).toBeGreaterThan(0);
  });
});
