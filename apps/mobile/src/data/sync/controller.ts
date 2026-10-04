/**
 * Library sync on this device — the engine that records every write to the on-device library and
 * trades them with the hub (the host-server's `/sync`). Free of React Native so it runs under
 * `bun test`; `./index.ts` supplies AsyncStorage, `fetch` and the app-lifecycle triggers.
 *
 * Pairing is all-or-nothing. Turning sync on starts a brand-new device: it pulls everything the hub
 * holds, THEN adopts whatever this library has that the hub lacks. Turning it off forgets the
 * engine state outright — a device that kept its stamps while writes went unrecorded would hold
 * stale stamps that lose to the hub, so re-enabling always starts over.
 *
 * The store handed to the router is a proxy that holds every call until the saved state has loaded,
 * so no write can slip in unrecorded before the engine exists.
 */
import type { LibraryStore } from '@comical/library';
import {
  adoptBridgeSettings,
  adoptLibrary,
  adoptRegistry,
  bridgeSettingsSyncStore,
  composeSyncStores,
  LIBRARY_TABLES,
  librarySyncStore,
  REGISTRY_TABLES,
  registrySyncStore,
  SeqGapError,
  SETTINGS_TABLES,
  SyncEngine,
  SyncUnlinkedError,
  wrapBridgeSettings,
  wrapLibraryStore,
  wrapRegistryProvider,
  type BridgeSettingsProvider,
  type BridgeSettingsSyncStore,
  type RegistryLists,
  type RegistryMutations,
  type RegistrySyncStore,
  type SyncBackend,
  type SyncStateSnapshot,
  type SyncStats,
} from '@comical/sync';

/** What's saved between launches; its absence means sync is off. */
export type SyncDoc = {
  state: SyncStateSnapshot;
  /** False until the first successful pull, after which this library's own records are adopted. */
  adopted: boolean;
};

export type SyncStatus = {
  enabled: boolean;
  running: boolean;
  lastSyncAt?: number;
  lastError?: string;
  /** Set by a round that found the hub reset and paired again; cleared by the next round. */
  repairedAt?: number;
  /** The hub unlinked this device, which turned sync off. Cleared when it is turned on again. */
  unlinked?: boolean;
};

export type LibrarySyncOptions = {
  raw: LibraryStore;
  /**
   * What this device has installed, read from its own stores. The provider that performs an
   * install arrives later, through `decorateRegistry`; a record that lands before it is retried.
   */
  registry: RegistryLists;
  load: () => Promise<SyncDoc | null>;
  save: (doc: SyncDoc | null) => Promise<void>;
  backend: () => SyncBackend;
  /** False while the app runs against a remote server, whose library isn't this device's. */
  canSync: () => boolean;
  newDeviceId: () => string;
  /** What the hub lists this device as; asked every round, so a rename lands on the next one. */
  deviceName: () => string;
  /** A round brought in changes — the screens reading the library should refetch. */
  onApplied: () => void;
  /** The hub had lost this device's history, and the device paired with it again (see `round`). */
  onRepaired?: () => void;
  /** The hub unlinked this device and sync is now off: whatever it was paired with is no use. */
  onUnlinked?: () => void;
  onStatus: (status: SyncStatus) => void;
  log: (message: string) => void;
  /** How long a burst of local writes is gathered before they're saved and sent. */
  debounceMs?: number;
};

export type LibrarySync = {
  /** The store to hand the router: writes through it are recorded while sync is on. */
  store: LibraryStore;
  /**
   * Wraps the registry provider the router installs through, so an add or install from a screen
   * is recorded while sync is on — and makes it the provider that performs what other devices
   * installed.
   */
  decorateRegistry<P extends RegistryMutations>(provider: P): P;
  /**
   * Wraps the bridge provider the router saves settings through, so a preference changed from a
   * screen is recorded while sync is on — and makes it the provider other devices' preferences
   * are stored through. A round before it is bound fails, and the next one tries again.
   */
  decorateBridges<P extends BridgeSettingsProvider>(provider: P): P;
  /** Resolves once the saved state has loaded (or failed to). */
  loaded: Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  /** Run a round now. Resolves even when the round fails; the failure lands in the status. */
  syncNow(): Promise<SyncStats | undefined>;
  /** Save the engine state now, e.g. as the app goes to the background. */
  flush(): Promise<void>;
  status(): SyncStatus;
};

export function createLibrarySync(opts: LibrarySyncOptions): LibrarySync {
  let active: {
    engine: SyncEngine;
    store: LibraryStore;
    registry: RegistrySyncStore;
    settings: BridgeSettingsSyncStore;
    adopted: boolean;
  } | null = null;
  let provider: RegistryMutations | null = null;
  // Installs from other devices go through whatever provider is bound by the time they arrive.
  const lateProvider: RegistryMutations = {
    add: (url, o) => bound().add(url, o),
    remove: (url) => bound().remove(url),
    install: (url, id) => bound().install(url, id),
    uninstall: (id) => bound().uninstall(id),
    installTracker: (url, id) => bound().installTracker(url, id),
    uninstallTracker: (id) => bound().uninstallTracker(id),
  };
  function bound(): RegistryMutations {
    if (!provider) throw new Error('registry not available yet');
    return provider;
  }
  let bridges: BridgeSettingsProvider | null = null;
  const lateBridges: BridgeSettingsProvider = {
    get: (id) => boundBridges().get(id),
    storedSettings: (id) => boundBridges().storedSettings(id),
    updateSettings: (id, values) => boundBridges().updateSettings(id, values),
  };
  function boundBridges(): BridgeSettingsProvider {
    if (!bridges) throw new Error('bridges not available yet');
    return bridges;
  }
  let status: SyncStatus = { enabled: false, running: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Serialises enable / disable / rounds, so a toggle never lands halfway through a round.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    opts.onStatus(status);
  };

  const save = async () => {
    if (active) await opts.save({ state: active.engine.snapshot(), adopted: active.adopted });
  };

  function start(doc: SyncDoc | null): void {
    const log = { error: (message: string, err?: unknown) => opts.log(`${message}${err === undefined ? '' : `: ${String(err)}`}`) };
    const registry = registrySyncStore({ ...opts.registry, ...lateProvider }, { log });
    const settings = bridgeSettingsSyncStore(lateBridges, { log });
    const engine = new SyncEngine({
      store: composeSyncStores([
        [LIBRARY_TABLES, librarySyncStore(opts.raw)],
        [REGISTRY_TABLES, registry],
        [SETTINGS_TABLES, settings],
      ]),
      backend: {
        push: (s) => opts.backend().push(s),
        pull: (request) => opts.backend().pull(request),
      },
      ...(doc ? { state: doc.state } : { device: opts.newDeviceId() }),
      name: opts.deviceName,
      newDeviceId: opts.newDeviceId,
      persist: async (state) => {
        if (active?.engine === engine) await opts.save({ state, adopted: active.adopted });
      },
      onTouch: () => schedule(),
    });
    active = { engine, store: wrapLibraryStore(opts.raw, engine), registry, settings, adopted: doc?.adopted ?? false };
    setStatus({ enabled: true, unlinked: undefined });
  }

  async function forget(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    active = null;
    setStatus({ enabled: false, running: false, lastSyncAt: undefined, lastError: undefined });
    await opts.save(null);
  }

  const loaded = opts
    .load()
    .then((doc) => {
      if (doc) start(doc);
    })
    .catch((e: unknown) => opts.log(`Sync state unreadable, sync is off: ${String(e)}`));

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void save().catch((e: unknown) => opts.log(`Sync state not saved: ${String(e)}`));
      void syncNow();
    }, opts.debounceMs ?? 2000);
  }

  async function round(repaired = false): Promise<SyncStats | undefined> {
    const a = active;
    if (!a || !opts.canSync()) return undefined;
    setStatus({ running: true });
    try {
      const stats = await a.engine.sync();
      let applied = stats.applied;
      // Everything on a first round; on a device already paired, only a table that has started to
      // sync since. The flag outranks the engine's list: a state saved before the list existed
      // reads as having adopted every table of its day, which a never-adopted device has not.
      const tables = a.adopted ? a.engine.unadopted() : [...LIBRARY_TABLES, ...REGISTRY_TABLES, ...SETTINGS_TABLES];
      if (tables.length > 0) {
        await adoptLibrary(opts.raw, a.engine, tables);
        await adoptRegistry(opts.registry, a.engine, tables);
        const bridgeIds = (await opts.registry.installed()).map((b) => b.id);
        await adoptBridgeSettings(lateBridges, bridgeIds, a.engine, tables);
        a.engine.markAdopted();
        a.adopted = true;
        applied += (await a.engine.sync()).applied;
      }
      await a.registry.retry();
      // After the registry's, so a preference held for a bridge that just installed lands this
      // round. Under the engine's lock, so the recording wrapper never takes it for a local change.
      applied += await a.engine.exclusive(() => a.settings.retry());
      await save();
      if (applied > 0) opts.onApplied();
      setStatus({ running: false, lastSyncAt: Date.now(), lastError: undefined, repairedAt: repaired ? Date.now() : undefined });
      return { ...stats, applied };
    } catch (e) {
      // The hub no longer holds this device's earlier segments — it was wiped, or restored from an
      // older backup — so its numbering can't continue there. (A device that is itself the older
      // copy is the engine's own case: it moves to a new id by itself.) Pair again as if sync had
      // just been turned on: pull what the hub still has, then adopt this whole library over it,
      // record by record on timestamp — exactly what the toggle does, with nothing lost on either
      // side. A fresh id starts at seq 1, so this can't gap again.
      if (e instanceof SeqGapError && e.device === a.engine.deviceId && !repaired) {
        opts.log(`Sync re-pairing, the hub had been reset: ${e.message}`);
        start(null);
        await save();
        const stats = await round(true);
        if (stats) opts.onRepaired?.();
        return stats;
      }
      // Said under this device's own key, so it is the hub's word and it is final: asking again
      // would be answered the same way. Off, exactly as the toggle turns it off.
      if (e instanceof SyncUnlinkedError) {
        opts.log('Sync is off: the hub unlinked this device');
        setStatus({ unlinked: true });
        await forget().catch((err: unknown) => opts.log(`Sync state not cleared: ${String(err)}`));
        opts.onUnlinked?.();
        return undefined;
      }
      const message = e instanceof Error ? e.message : String(e);
      opts.log(`Sync failed: ${message}`);
      setStatus({ running: false, lastError: message });
      return undefined;
    }
  }

  function syncNow(): Promise<SyncStats | undefined> {
    return serial(async () => {
      await loaded;
      return round();
    });
  }

  return {
    // Every method waits for the saved state, then goes through the recording store while sync is
    // on. Checked per call, so enabling or disabling needs no re-wiring of the router.
    store: new Proxy(opts.raw, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          await loaded;
          type Methods = Record<PropertyKey, ((...a: unknown[]) => unknown) | undefined>;
          const wrapped = active?.store as unknown as Methods | undefined;
          // Anything the recording store doesn't cover (a method outside `LibraryStore`) is the raw one.
          const own = wrapped?.[prop];
          return own ? own.apply(wrapped, args) : (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }),
    decorateRegistry: (real) => {
      provider = real;
      // Rebuilt per pairing, since the recording wrapper is bound to an engine.
      let wrapped: { engine: SyncEngine; provider: typeof real } | undefined;
      return new Proxy(real, {
        get(target, prop, receiver) {
          const value: unknown = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          return async (...args: unknown[]) => {
            await loaded;
            const engine = active?.engine;
            if (!engine) return (value as (...a: unknown[]) => unknown).apply(target, args);
            if (wrapped?.engine !== engine) wrapped = { engine, provider: wrapRegistryProvider(real, opts.registry, engine) };
            return (wrapped.provider as unknown as Record<PropertyKey, (...a: unknown[]) => unknown>)[prop]!(...args);
          };
        },
      });
    },
    decorateBridges: (real) => {
      bridges = real;
      let wrapped: { engine: SyncEngine; provider: typeof real } | undefined;
      return new Proxy(real, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          const fn = value as (...a: unknown[]) => unknown;
          // Only the write waits for the saved state: the provider's synchronous methods
          // (`invalidate`, `refresh`) have to stay synchronous.
          if (prop !== 'updateSettings') return (...args: unknown[]) => fn.apply(target, args);
          return async (...args: Parameters<BridgeSettingsProvider['updateSettings']>) => {
            await loaded;
            const engine = active?.engine;
            if (!engine) return real.updateSettings(...args);
            if (wrapped?.engine !== engine) wrapped = { engine, provider: wrapBridgeSettings(real, engine) };
            return wrapped.provider.updateSettings(...args);
          };
        },
      });
    },
    loaded,
    enable: () =>
      serial(async () => {
        await loaded;
        if (active) return;
        start(null);
        await save();
        await round();
      }),
    disable: () =>
      serial(async () => {
        await loaded;
        await forget();
      }),
    syncNow,
    flush: async () => {
      await loaded;
      await save();
    },
    status: () => status,
  };
}
