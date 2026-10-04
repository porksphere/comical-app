/**
 * The device side of library sync: pairing, recording through the router's store, and the order a
 * fresh pairing takes (pull first, then adopt), against an in-process hub.
 */
import { describe, expect, test } from 'bun:test';
import type { SettingDescriptor, SettingValue } from '@comical/contract';
import { entryKey, InMemoryLibraryStore, Library } from '@comical/library';
import {
  MemorySegmentStore,
  SyncHub,
  SyncUnlinkedError,
  type BridgeSettingsProvider,
  type SyncBackend,
  type SyncedRegistry,
} from '@comical/sync';

import { createLibrarySync, type LibrarySyncOptions, type SyncDoc } from './controller';

let ids = 0;

const REG = 'https://example.test/index.json';
/** A look at the hub from the test itself, which has to say who it is like any device. */
const PROBE = { device: 'probe', name: 'A probe', have: {} };

/** The app's registry stores and provider, over maps: an install is a record of where it came from. */
function fakeRegistry() {
  const registries = new Map<string, { url: string; requireSignature: boolean }>();
  const installed = new Map<string, { id: string; registryUrl: string }>();
  const trackers = new Map<string, { id: string; registryUrl: string }>();
  const calls: string[] = [];
  const reg: SyncedRegistry & { calls: string[] } = {
    calls,
    registries: async () => [...registries.values()],
    installed: async () => [...installed.values()],
    installedTrackers: async () => [...trackers.values()],
    add: async (url, o) => {
      calls.push(`add ${url}`);
      registries.set(url, { url, requireSignature: o?.requireSignature ?? false });
    },
    remove: async (url) => void registries.delete(url),
    install: async (url, id) => {
      calls.push(`install ${id}`);
      installed.set(id, { id, registryUrl: url });
    },
    uninstall: async (id) => void installed.delete(id),
    installTracker: async (url, id) => void trackers.set(id, { id, registryUrl: url }),
    uninstallTracker: async (id) => void trackers.delete(id),
  };
  return reg;
}

const BRIDGE_SETTINGS: SettingDescriptor[] = [
  { type: 'boolean', key: 'dataSaver', label: 'Data saver' },
  { type: 'string', key: 'password', label: 'Password', secret: true },
];

/** The app's bridge provider, over maps: `declares` is what can be loaded, `stored` what is saved. */
function fakeBridges() {
  const declares = new Map([['bridge-a', BRIDGE_SETTINGS]]);
  const stored = new Map<string, Record<string, SettingValue>>();
  const invalidated: string[] = [];
  const provider: BridgeSettingsProvider & { invalidate(id: string): void } = {
    get: async (id) => {
      const descriptors = declares.get(id);
      if (!descriptors) throw new Error(`bridge not found: ${id}`);
      return { getSettings: () => descriptors };
    },
    storedSettings: async (id) => ({ ...stored.get(id) }),
    updateSettings: async (id, values) => {
      const next = { ...stored.get(id), ...values };
      stored.set(id, next);
      return { ...next };
    },
    invalidate: (id) => void invalidated.push(id),
  };
  return { provider, declares, stored, invalidated };
}

function device(hub: SyncBackend, overrides: Partial<LibrarySyncOptions> = {}) {
  const raw = overrides.raw ?? new InMemoryLibraryStore();
  const held = fakeRegistry();
  const heldBridges = fakeBridges();
  let saved: SyncDoc | null = null;
  const sync = createLibrarySync({
    raw,
    registry: held,
    load: async () => saved,
    save: async (doc) => {
      saved = doc;
    },
    backend: () => hub,
    canSync: () => true,
    newDeviceId: () => `dev-${++ids}`,
    deviceName: () => 'A phone',
    onApplied: () => {},
    onStatus: () => {},
    log: () => {},
    debounceMs: 60_000,
    ...overrides,
  });
  return {
    raw,
    sync,
    library: new Library(sync.store),
    saved: () => saved,
    held,
    registry: sync.decorateRegistry(held),
    heldBridges,
    bridges: sync.decorateBridges(heldBridges.provider),
  };
}

const SERIES = { bridgeId: 'bridge-a', seriesId: 's1' };
const KEY = entryKey(SERIES.bridgeId, SERIES.seriesId);
const chapters = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ch${i + 1}`, name: `Chapter ${i + 1}`, number: i + 1 }));

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
    expect((await hub.pull(PROBE)).segments).toHaveLength(0);
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
      pull: (request) => (online ? hub.pull(request) : Promise.reject(new Error('offline'))),
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

  test("a new chapter one device noticed is in the other's feed, which has nothing left to announce", async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    const b = device(hub);
    await a.sync.enable();
    await a.library.collectSeries(SERIES, { seriesTitle: 'One' });
    await a.sync.syncNow();
    await b.sync.enable();
    for (const d of [a, b]) await d.library.syncChapters(KEY, chapters(1));

    expect((await a.library.syncChapters(KEY, chapters(2))).fresh.map((c) => c.id)).toEqual(['ch2']);
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(await b.raw.listActivity()).toEqual(await a.raw.listActivity());
    expect((await b.library.syncChapters(KEY, chapters(2))).fresh).toEqual([]);

    await b.library.clearActivity();
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await a.raw.listActivity()).toEqual([]);
  });

  test('a device paired before the feed synced sends the feed it already had, once', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    await a.library.collectSeries(SERIES, { seriesTitle: 'One' });
    await a.sync.syncNow();

    // As an older build left it: a row sync never recorded, and a saved state with no list of
    // adopted tables.
    const row = { bridgeId: SERIES.bridgeId, seriesId: SERIES.seriesId, chapterId: 'ch2', title: 'One', detectedAt: 5 };
    await a.raw.putActivity(row);
    const doc = structuredClone(a.saved()!);
    delete doc.state.adopted;

    const upgraded = device(hub, { raw: a.raw, load: async () => doc });
    await upgraded.sync.syncNow();
    expect(upgraded.saved()?.state.adopted).toContain('activity');

    const b = device(hub);
    await b.sync.enable();
    expect(await b.raw.listActivity()).toEqual([row]);

    // Adopted once: a later round has nothing more to send.
    const before = (await hub.pull(PROBE)).segments.length;
    await upgraded.sync.syncNow();
    expect((await hub.pull(PROBE)).segments).toHaveLength(before);
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

  test('a hub that unlinked this device turns sync off, says so, and leaves the library alone', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    let unlinked = false;
    const gated: SyncBackend = {
      push: (segment) => (unlinked ? Promise.reject(new SyncUnlinkedError()) : hub.push(segment)),
      pull: (request) => (unlinked ? Promise.reject(new SyncUnlinkedError()) : hub.pull(request)),
    };
    let told = 0;
    const a = device(gated, { onUnlinked: () => told++ });
    await a.sync.enable();
    await a.library.createCollection('Mine');

    unlinked = true;
    expect(await a.sync.syncNow()).toBeUndefined();
    expect(a.sync.status()).toMatchObject({ enabled: false, running: false, unlinked: true });
    expect(a.sync.status().lastError).toBeUndefined();
    expect(a.saved()).toBeNull();
    expect(told).toBe(1);
    expect(await names(a.library)).toEqual(['Mine']);
  });

  test('turning sync back on after being unlinked no longer says so', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    let unlinked = true;
    const gated: SyncBackend = {
      push: (segment) => (unlinked ? Promise.reject(new SyncUnlinkedError()) : hub.push(segment)),
      pull: (request) => (unlinked ? Promise.reject(new SyncUnlinkedError()) : hub.pull(request)),
    };
    const a = device(gated);
    await a.sync.enable();
    expect(a.sync.status()).toMatchObject({ enabled: false, unlinked: true });

    unlinked = false;
    await a.sync.enable();
    expect(a.sync.status().enabled).toBe(true);
    expect(a.sync.status().unlinked).toBeUndefined();
    expect(a.sync.status().lastError).toBeUndefined();
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

  test('a registry added and a bridge installed on one device are installed on another', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    await a.registry.add(REG, { requireSignature: true });
    await a.registry.install(REG, 'bridge-one');
    await a.sync.syncNow();

    const b = device(hub);
    await b.sync.enable();
    expect(await b.held.registries()).toEqual([{ url: REG, requireSignature: true }]);
    expect(await b.held.installed()).toEqual([{ id: 'bridge-one', registryUrl: REG }]);
    expect(b.held.calls).toEqual([`add ${REG}`, 'install bridge-one']);

    await b.registry.uninstall('bridge-one');
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(await a.held.installed()).toEqual([]);
  });

  test("pairing sends what this device already has installed, and doesn't reinstall what it holds", async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.held.add(REG);
    await a.held.install(REG, 'bridge-one');
    a.held.calls.length = 0;
    await a.sync.enable();
    expect(a.held.calls).toEqual([]);

    const b = device(hub);
    await b.held.add(REG);
    await b.held.install(REG, 'bridge-one');
    b.held.calls.length = 0;
    await b.sync.enable();
    expect(b.held.calls).toEqual([]);
    expect((await b.held.installed()).map((x) => x.id)).toEqual(['bridge-one']);
  });

  test('an install that arrives before the provider is bound is performed once it is', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    await a.registry.add(REG);
    await a.registry.install(REG, 'bridge-one');
    await a.sync.syncNow();

    // b's runtime hasn't started: its stores are readable but nothing can install yet.
    const raw = new InMemoryLibraryStore();
    const held = fakeRegistry();
    const sync = createLibrarySync({
      raw,
      registry: held,
      load: async () => null,
      save: async () => {},
      backend: () => hub,
      canSync: () => true,
      newDeviceId: () => `dev-${++ids}`,
      deviceName: () => 'A phone',
      onApplied: () => {},
      onStatus: () => {},
      log: () => {},
      debounceMs: 60_000,
    });
    await sync.enable();
    expect(sync.status().lastError).toBeUndefined();
    expect(await held.installed()).toEqual([]);

    sync.decorateRegistry(held);
    await sync.syncNow();
    expect(await held.installed()).toEqual([{ id: 'bridge-one', registryUrl: REG }]);
  });

  test("a bridge preference changed on one device is stored on another, and a login isn't", async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    const b = device(hub);
    await a.sync.enable();
    await b.sync.enable();

    await a.bridges.updateSettings('bridge-a', { dataSaver: true, password: "a's", excludedTags: ['gore'] });
    await a.sync.syncNow();
    expect((await b.sync.syncNow())?.applied).toBe(2);
    expect(b.heldBridges.stored.get('bridge-a')).toEqual({ dataSaver: true, excludedTags: ['gore'] });
    expect(JSON.stringify(await hub.pull(PROBE))).not.toContain("a's");

    await b.bridges.updateSettings('bridge-a', { dataSaver: false });
    await b.sync.syncNow();
    await a.sync.syncNow();
    expect(a.heldBridges.stored.get('bridge-a')).toEqual({ dataSaver: false, password: "a's", excludedTags: ['gore'] });
  });

  test('pairing sends the preferences this device already has for its installed bridges', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.held.add(REG);
    await a.held.install(REG, 'bridge-a');
    await a.heldBridges.provider.updateSettings('bridge-a', { dataSaver: true, password: "a's" });
    await a.sync.enable();

    const b = device(hub);
    await b.sync.enable();
    expect(b.heldBridges.stored.get('bridge-a')).toEqual({ dataSaver: true });
  });

  test('a device paired before preferences synced sends the ones it already had, once', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.held.add(REG);
    await a.held.install(REG, 'bridge-a');
    await a.sync.enable();

    // As an older build left it: a preference sync never recorded, and a saved state from before
    // the table existed.
    const doc = structuredClone(a.saved()!);
    doc.state.adopted = doc.state.adopted?.filter((t) => t !== 'bridgeSettings');
    const upgraded = device(hub, { raw: a.raw, registry: a.held, load: async () => doc });
    await upgraded.heldBridges.provider.updateSettings('bridge-a', { dataSaver: true });
    await upgraded.sync.syncNow();
    expect(upgraded.saved()?.state.adopted).toContain('bridgeSettings');

    const b = device(hub);
    await b.sync.enable();
    expect(b.heldBridges.stored.get('bridge-a')).toEqual({ dataSaver: true });

    const before = (await hub.pull(PROBE)).segments.length;
    await upgraded.sync.syncNow();
    expect((await hub.pull(PROBE)).segments).toHaveLength(before);
  });

  test('a preference for a bridge this device cannot load yet is stored once it can', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.sync.enable();
    await a.bridges.updateSettings('bridge-a', { dataSaver: true });
    await a.sync.syncNow();

    let applied = 0;
    const b = device(hub, { onApplied: () => applied++ });
    b.heldBridges.declares.clear();
    await b.sync.enable();
    expect(b.heldBridges.stored.has('bridge-a')).toBe(false);
    expect(b.sync.status().lastError).toBeUndefined();
    const before = applied;

    b.heldBridges.declares.set('bridge-a', BRIDGE_SETTINGS);
    await b.sync.syncNow();
    expect(b.heldBridges.stored.get('bridge-a')).toEqual({ dataSaver: true });
    expect(applied).toBe(before + 1);
    // Stored from a's record, so b has nothing of its own to send.
    const segments = (await hub.pull(PROBE)).segments.length;
    await b.sync.syncNow();
    expect((await hub.pull(PROBE)).segments).toHaveLength(segments);
  });

  test('a round that needs the bridges before they are bound fails, and the next one after carries on', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const held = fakeRegistry();
    await held.add(REG);
    await held.install(REG, 'bridge-a');
    let saved: SyncDoc | null = null;
    const sync = createLibrarySync({
      raw: new InMemoryLibraryStore(),
      registry: held,
      load: async () => saved,
      save: async (doc) => {
        saved = doc;
      },
      backend: () => hub,
      canSync: () => true,
      newDeviceId: () => `dev-${++ids}`,
      deviceName: () => 'A phone',
      onApplied: () => {},
      onStatus: () => {},
      log: () => {},
      debounceMs: 60_000,
    });
    await sync.enable();
    expect(sync.status().lastError).toBe('bridges not available yet');

    const bridges = fakeBridges();
    await bridges.provider.updateSettings('bridge-a', { dataSaver: true });
    sync.decorateBridges(bridges.provider);
    await sync.syncNow();
    expect(sync.status().lastError).toBeUndefined();

    const b = device(hub);
    await b.sync.enable();
    expect(b.heldBridges.stored.get('bridge-a')).toEqual({ dataSaver: true });
    expect(await b.held.installed()).toEqual([{ id: 'bridge-a', registryUrl: REG }]);
  });

  test('preferences changed while sync is off are not recorded, and the rest of the provider is untouched', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    expect(await a.bridges.updateSettings('bridge-a', { dataSaver: true })).toEqual({ dataSaver: true });
    expect((await hub.pull(PROBE)).segments).toHaveLength(0);

    // Synchronous on the provider, so synchronous through the wrapper.
    expect(a.bridges.invalidate('bridge-a')).toBeUndefined();
    expect(a.heldBridges.invalidated).toEqual(['bridge-a']);
    expect(await a.bridges.storedSettings('bridge-a')).toEqual({ dataSaver: true });
  });

  test('installs made while sync is off are not recorded, and go through the plain provider', async () => {
    const hub = await SyncHub.open(new MemorySegmentStore());
    const a = device(hub);
    await a.registry.add(REG);
    await a.registry.install(REG, 'bridge-one');
    expect(a.held.calls).toEqual([`add ${REG}`, 'install bridge-one']);
    expect((await hub.pull(PROBE)).segments).toHaveLength(0);
  });
});
