/**
 * StoreBridge over the app's *embedded* stores — the ones that live outside `LibraryStore`:
 *
 *   - saved registries  (`SavedRegistryStore`, embedded/stores.ts)      → set (add/remove)
 *   - installed bridges (`InstalledStore`,     embedded/stores.ts)      → set (add/remove)
 *   - per-bridge settings (`SettingsStore`,    embedded/settings-store) → register
 *
 * The installed *bundles* are not synced — only the decision to install (the record); each device
 * re-downloads and re-verifies from the registry. Settings and installed records have no enumerate
 * beyond `all()`/the installed set, so bridge-settings are keyed off the installed bridge ids.
 *
 * Depends only on the three tiny store interfaces (from `@comical/host-rn`), so it works against the
 * real AsyncStorage-backed stores or any fake.
 */
import type { InstalledBridgeRecord, InstalledStore, SavedRegistryStore, SettingsStore } from '@comical/host-rn';
import type { SavedRegistry } from '@comical/registry/schema';
import type { SettingValue } from '@comical/contract';
import type { Replica , StoreBridge } from '@comical/sync';


type RegistryMeta = { name: string; requireSignature: boolean };
type Settings = Record<string, SettingValue>;

export class EmbeddedStoresBridge implements StoreBridge {
  constructor(
    private readonly registries: SavedRegistryStore,
    private readonly installed: InstalledStore,
    private readonly settings: SettingsStore,
  ) {}

  async hydrate(replica: Replica): Promise<void> {
    for (const r of await this.registries.all()) {
      replica.putSet('registries', r.url, true, { name: r.name, requireSignature: r.requireSignature } satisfies RegistryMeta);
    }
    for (const b of await this.installed.all()) {
      replica.putSet('installed', b.id, true, b as unknown as Record<string, unknown>);
      const s = await this.settings.get(b.id);
      if (Object.keys(s).length > 0) replica.putRegister('bridgeSettings', b.id, s);
    }
  }

  async apply(replica: Replica): Promise<void> {
    await this.applyRegistries(replica);
    await this.applyInstalled(replica);
    await this.applySettings(replica);
  }

  private async applyRegistries(replica: Replica): Promise<void> {
    const live = new Set(replica.liveIds('registries'));
    for (const url of live) {
      const meta = replica.setMeta<RegistryMeta>('registries', url);
      await this.registries.add({ url, name: meta?.name ?? '', requireSignature: meta?.requireSignature ?? false } satisfies SavedRegistry);
    }
    for (const r of await this.registries.all()) {
      if (!live.has(r.url)) await this.registries.remove(r.url);
    }
  }

  private async applyInstalled(replica: Replica): Promise<void> {
    const live = new Set(replica.liveIds('installed'));
    for (const id of live) {
      const record = replica.setMeta<InstalledBridgeRecord>('installed', id);
      if (record) await this.installed.add(record);
    }
    for (const b of await this.installed.all()) {
      if (!live.has(b.id)) await this.installed.remove(b.id);
    }
  }

  // Settings have no delete; upsert live values (a cleared bridge syncs as an empty object).
  private async applySettings(replica: Replica): Promise<void> {
    for (const id of replica.liveIds('bridgeSettings')) {
      const values = replica.registerValue<Settings>('bridgeSettings', id);
      if (values) await this.settings.set(id, values);
    }
  }
}
