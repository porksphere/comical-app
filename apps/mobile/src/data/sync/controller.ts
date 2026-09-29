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
  adoptLibrary,
  librarySyncStore,
  SyncEngine,
  wrapLibraryStore,
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
};

export type LibrarySyncOptions = {
  raw: LibraryStore;
  load: () => Promise<SyncDoc | null>;
  save: (doc: SyncDoc | null) => Promise<void>;
  backend: () => SyncBackend;
  /** False while the app runs against a remote server, whose library isn't this device's. */
  canSync: () => boolean;
  newDeviceId: () => string;
  /** A round brought in changes — the screens reading the library should refetch. */
  onApplied: () => void;
  onStatus: (status: SyncStatus) => void;
  log: (message: string) => void;
  /** How long a burst of local writes is gathered before they're saved and sent. */
  debounceMs?: number;
};

export type LibrarySync = {
  /** The store to hand the router: writes through it are recorded while sync is on. */
  store: LibraryStore;
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
  let active: { engine: SyncEngine; store: LibraryStore; adopted: boolean } | null = null;
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
    const engine = new SyncEngine({
      store: librarySyncStore(opts.raw),
      backend: {
        push: (s) => opts.backend().push(s),
        pull: (have, limit) => opts.backend().pull(have, limit),
      },
      ...(doc ? { state: doc.state } : { device: opts.newDeviceId() }),
      newDeviceId: opts.newDeviceId,
      persist: async (state) => {
        if (active?.engine === engine) await opts.save({ state, adopted: active.adopted });
      },
      onTouch: () => schedule(),
    });
    active = { engine, store: wrapLibraryStore(opts.raw, engine), adopted: doc?.adopted ?? false };
    setStatus({ enabled: true });
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

  async function round(): Promise<SyncStats | undefined> {
    const a = active;
    if (!a || !opts.canSync()) return undefined;
    setStatus({ running: true });
    try {
      const stats = await a.engine.sync();
      let applied = stats.applied;
      if (!a.adopted) {
        await adoptLibrary(opts.raw, a.engine);
        a.adopted = true;
        applied += (await a.engine.sync()).applied;
      }
      await save();
      if (applied > 0) opts.onApplied();
      setStatus({ running: false, lastSyncAt: Date.now(), lastError: undefined });
      return { ...stats, applied };
    } catch (e) {
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
        if (timer) clearTimeout(timer);
        timer = undefined;
        active = null;
        await opts.save(null);
        setStatus({ enabled: false, running: false, lastSyncAt: undefined, lastError: undefined });
      }),
    syncNow,
    flush: async () => {
      await loaded;
      await save();
    },
    status: () => status,
  };
}
