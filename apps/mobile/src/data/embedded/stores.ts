/**
 * The app's AsyncStorage-backed persistence for the on-device registry model — the two stores
 * `@comical/host-rn`'s `EmbeddedRegistryProvider` / `ManifestBundleSource` read and write:
 *
 *   - `savedRegistryStore`  — the bridge registries the user has added (browsable catalogs).
 *   - `installedStore`      — the *installed* bridges (pinned records). Only these load; adding a
 *                             registry no longer activates all its bridges.
 *
 * Published builds start empty. For local dev, `EXPO_PUBLIC_COMICAL_REGISTRY` (a gitignored
 * `.env.local` value) pre-*adds* that registry so you can browse and install from it — but nothing is
 * installed by default (start-empty). Each store keeps an in-memory mirror hydrated from AsyncStorage
 * once; every method awaits that hydration, so reads always reflect persisted state even though the
 * runtime installs its transport before AsyncStorage resolves.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registryDisplayName, resolveRegistryUrl } from '@comical/registry/url';
import type { SavedRegistry } from '@comical/registry/schema';
import type { InstalledBridgeRecord, InstalledStore, SavedRegistryStore } from '@comical/host-rn';

const REGISTRIES_KEY = 'comical:embedded:registries';
const INSTALLED_KEY = 'comical:embedded:installed';

/** Dev-only: pre-add the configured registry (browsable), without installing any of its bridges. */
const ENV_REGISTRY = process.env.EXPO_PUBLIC_COMICAL_REGISTRY;
function seedRegistries(): SavedRegistry[] {
  if (!ENV_REGISTRY) return [];
  const url = resolveRegistryUrl(ENV_REGISTRY);
  return [{ url, name: registryDisplayName(url), requireSignature: false }];
}

/**
 * A minimal AsyncStorage-backed keyed list. `add` is an upsert by key; every accessor awaits the
 * one-time hydration so a store never reports empty just because AsyncStorage hasn't resolved yet.
 */
class AsyncKeyedStore<T> {
  private items: T[];
  private readonly hydrated: Promise<void>;

  constructor(
    private readonly storageKey: string,
    private readonly keyOf: (item: T) => string,
    seed: T[],
  ) {
    this.items = seed;
    this.hydrated = AsyncStorage.getItem(storageKey)
      .then((stored) => {
        if (stored === null) return; // nothing persisted yet — keep the seed
        try {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) this.items = parsed as T[];
        } catch {
          /* ignore malformed persisted value */
        }
      })
      .catch(() => {});
  }

  private persist(): void {
    AsyncStorage.setItem(this.storageKey, JSON.stringify(this.items)).catch(() => {});
  }

  async all(): Promise<T[]> {
    await this.hydrated;
    return [...this.items];
  }

  async get(key: string): Promise<T | null> {
    await this.hydrated;
    return this.items.find((i) => this.keyOf(i) === key) ?? null;
  }

  async add(item: T): Promise<void> {
    await this.hydrated;
    this.items = [...this.items.filter((i) => this.keyOf(i) !== this.keyOf(item)), item];
    this.persist();
  }

  async remove(key: string): Promise<void> {
    await this.hydrated;
    this.items = this.items.filter((i) => this.keyOf(i) !== key);
    this.persist();
  }
}

export const savedRegistryStore: SavedRegistryStore = new AsyncKeyedStore<SavedRegistry>(
  REGISTRIES_KEY,
  (r) => r.url,
  seedRegistries(),
);

export const installedStore: InstalledStore = new AsyncKeyedStore<InstalledBridgeRecord>(
  INSTALLED_KEY,
  (b) => b.id,
  [],
);
