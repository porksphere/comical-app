/**
 * The app's AsyncStorage-backed persistence for the on-device registry model — the stores
 * `@comical/host-rn`'s `EmbeddedRegistryProvider` / `ManifestBundleSource` / `ManifestTrackerBundleSource`
 * read and write:
 *
 *   - `savedRegistryStore`   — the bridge registries the user has added (browsable catalogs).
 *   - `installedStore`       — the *installed* bridges (pinned records). Only these load; adding a
 *                              registry no longer activates all its bridges.
 *   - `installedTrackerStore` — the *installed* trackers (pinned records). Trackers are
 *                              registry-installed exactly like bridges, not a static app-bundled map.
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
import type {
  InstalledBridgeRecord,
  InstalledStore,
  InstalledTrackerRecord,
  InstalledTrackerStore,
  SavedRegistryStore,
} from '@comical/host-rn';

import { logDiagnostic } from '@/lib/diagnostics';

const REGISTRIES_KEY = 'comical:embedded:registries';
const INSTALLED_KEY = 'comical:embedded:installed';
const INSTALLED_TRACKERS_KEY = 'comical:embedded:installed-trackers';

/** Dev-only: pre-add the configured registry (browsable), without installing any of its bridges. */
const ENV_REGISTRY = process.env.EXPO_PUBLIC_COMICAL_REGISTRY;
function seedRegistries(): SavedRegistry[] {
  if (!ENV_REGISTRY) return [];
  const url = resolveRegistryUrl(ENV_REGISTRY);
  return [{ url, name: registryDisplayName(url), requireSignature: false }];
}

/**
 * A minimal AsyncStorage-backed keyed list. `add` is an upsert by key; every accessor awaits
 * hydration so a store never reports empty just because AsyncStorage hasn't resolved yet.
 *
 * A failed *read* is the dangerous case, and it's why this is more than a getItem/setItem pair.
 * `persist()` writes the whole in-memory mirror, so swallowing a read error left that mirror at its
 * (empty) seed and turned the very next `add()` into a full overwrite: one transient read failure
 * plus one install silently destroyed every other installed bridge, with every screen in between
 * reporting "nothing installed" rather than "couldn't read". So a read failure is never reported as
 * emptiness — it propagates to the caller, is retried on the next access, and no write may run
 * against an unhydrated mirror.
 *
 * A *malformed* stored value is the other half, and needs the opposite treatment: those bytes are
 * unrecoverable, so refusing forever would wedge the store permanently. It's quarantined under
 * `<key>:corrupt` (still inspectable, and logged) and the store starts fresh.
 */
export class AsyncKeyedStore<T> {
  private items: T[];
  /** In-flight read, shared by concurrent callers. Cleared when it settles so a failure retries. */
  private hydration: Promise<void> | null = null;
  private hydrated = false;
  /** Tail of the write chain — see `persist`. */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storageKey: string,
    private readonly keyOf: (item: T) => string,
    seed: T[],
  ) {
    this.items = seed;
    // Start reading at construction — the runtime installs its transport before AsyncStorage
    // resolves. The catch only keeps a retryable failure from surfacing as an unhandled rejection;
    // the accessors below re-await and re-throw it.
    void this.hydrate().catch(() => {});
  }

  private hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (this.hydration) return this.hydration;
    const attempt = AsyncStorage.getItem(this.storageKey)
      .then(async (stored) => {
        if (stored !== null) {
          // nothing persisted yet (null) keeps the seed; anything else must parse as an array
          let parsed: unknown;
          try {
            parsed = JSON.parse(stored);
          } catch {
            parsed = undefined;
          }
          if (Array.isArray(parsed)) this.items = parsed as T[];
          else await this.quarantine(stored);
        }
        this.hydrated = true;
      })
      .finally(() => {
        this.hydration = null;
      });
    this.hydration = attempt;
    return attempt;
  }

  /** Park an unparseable stored value under a sibling key rather than overwriting it unseen. */
  private async quarantine(raw: string): Promise<void> {
    logDiagnostic('storage', `discarded a malformed value for ${this.storageKey}`, {
      context: `${raw.length} bytes preserved at ${this.storageKey}:corrupt`,
    });
    try {
      await AsyncStorage.setItem(`${this.storageKey}:corrupt`, raw);
    } catch {
      /* best effort — the store starts fresh either way */
    }
  }

  /**
   * Write the whole mirror, ordered against every other write. Callers commit to the mirror
   * synchronously before getting here, so concurrent writers each serialize a snapshot that already
   * contains the others' items — ordering is all it takes for the last write to be the complete one.
   * The promise is awaited by `add`/`remove` so a failed write surfaces as a failed install rather
   * than a mirror that silently disagrees with storage.
   */
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.items);
    const write = this.writes
      .catch(() => {}) // a failed write must not poison the ones queued behind it
      .then(() => AsyncStorage.setItem(this.storageKey, snapshot));
    this.writes = write.catch(() => {});
    return write;
  }

  async all(): Promise<T[]> {
    await this.hydrate();
    return [...this.items];
  }

  async get(key: string): Promise<T | null> {
    await this.hydrate();
    return this.items.find((i) => this.keyOf(i) === key) ?? null;
  }

  async add(item: T): Promise<void> {
    await this.hydrate(); // never write over state we failed to read
    this.items = [...this.items.filter((i) => this.keyOf(i) !== this.keyOf(item)), item];
    await this.persist();
  }

  async remove(key: string): Promise<void> {
    await this.hydrate();
    this.items = this.items.filter((i) => this.keyOf(i) !== key);
    await this.persist();
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

export const installedTrackerStore: InstalledTrackerStore = new AsyncKeyedStore<InstalledTrackerRecord>(
  INSTALLED_TRACKERS_KEY,
  (t) => t.id,
  [],
);
