/**
 * EmbeddedStoresBridge tests — registries/installed (sets) and bridge-settings (register) replicate
 * between devices, and a removal propagates. Uses small in-memory fakes of the real host-rn store
 * interfaces (SavedRegistryStore / InstalledStore / SettingsStore).
 */
import { describe, expect, test } from 'bun:test';
import type { InstalledBridgeRecord, InstalledStore, SavedRegistryStore, SettingsStore } from '@comical/host-rn';
import type { SavedRegistry } from '@comical/registry/schema';
import type { SettingValue } from '@comical/contract';
import { Clock , Replica , MemoryBackend , SyncEngine, MemoryCursor } from '@comical/sync';



import { EmbeddedStoresBridge } from './embedded-bridge';

class FakeKeyed<T> {
  readonly map = new Map<string, T>();
  constructor(private readonly keyOf: (v: T) => string) {}
  async all(): Promise<T[]> { return [...this.map.values()]; }
  async get(k: string): Promise<T | null> { return this.map.get(k) ?? null; }
  async add(v: T): Promise<void> { this.map.set(this.keyOf(v), v); }
  async remove(k: string): Promise<void> { this.map.delete(k); }
}
class FakeSettings implements SettingsStore {
  readonly map = new Map<string, Record<string, SettingValue>>();
  async get(id: string) { return this.map.get(id) ?? {}; }
  async set(id: string, v: Record<string, SettingValue>) { this.map.set(id, v); }
}
const installedRecord = (id: string): InstalledBridgeRecord =>
  ({ id, registryUrl: 'https://r1', version: '1.0.0', contractVersion: '1', url: `https://r1/${id}.js`, sha256: 'abc', info: { id, name: id } } as unknown as InstalledBridgeRecord);

const time = { t: 1000 };
function device(node: string, backend: MemoryBackend) {
  const registries = new FakeKeyed<SavedRegistry>((r) => r.url);
  const installed = new FakeKeyed<InstalledBridgeRecord>((b) => b.id);
  const settings = new FakeSettings();
  const replica = new Replica(new Clock(node, () => time.t));
  const bridge = new EmbeddedStoresBridge(registries as SavedRegistryStore, installed as InstalledStore, settings);
  const engine = new SyncEngine(replica, backend, new MemoryCursor());
  return { registries, installed, settings, replica, bridge, engine };
}

describe('EmbeddedStoresBridge', () => {
  test('registries, installed bridges, and settings replicate to a fresh device', async () => {
    const backend = new MemoryBackend();
    const A = device('A', backend);
    time.t = 1000;
    await A.registries.add({ url: 'https://r1', name: 'R1', requireSignature: false });
    await A.installed.add(installedRecord('example-bridge'));
    await A.settings.set('example-bridge', { lang: 'en' as unknown as SettingValue });
    await A.bridge.hydrate(A.replica);
    await A.engine.sync();

    const B = device('B', backend);
    await B.engine.sync();
    await B.bridge.apply(B.replica);

    expect((await B.registries.all()).map((r) => r.url)).toEqual(['https://r1']);
    expect((await B.installed.all()).map((b) => b.id)).toEqual(['example-bridge']);
    expect(await B.settings.get('example-bridge')).toEqual({ lang: 'en' as unknown as SettingValue });
  });

  test('removing a registry on one device removes it on the other', async () => {
    const backend = new MemoryBackend();
    const A = device('A', backend);
    const B = device('B', backend);
    time.t = 1000;
    await A.registries.add({ url: 'https://r1', name: 'R1', requireSignature: false });
    await A.registries.add({ url: 'https://r2', name: 'R2', requireSignature: false });
    await A.bridge.hydrate(A.replica);
    await A.engine.sync();
    await B.engine.sync();
    await B.bridge.apply(B.replica);
    expect((await B.registries.all()).map((r) => r.url).sort()).toEqual(['https://r1', 'https://r2']);

    // A removes r1 (write-through to the replica), sync, B applies.
    time.t = 2000; A.replica.putSet('registries', 'https://r1', false);
    await A.engine.sync();
    await B.engine.sync();
    await B.bridge.apply(B.replica);
    expect((await B.registries.all()).map((r) => r.url)).toEqual(['https://r2']);
  });
});
