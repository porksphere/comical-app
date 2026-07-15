/**
 * The app-facing sync controller — the one object that wires the CRDT core to the app's stores and
 * runs sync rounds. It:
 *
 *   1. builds a `Replica` on this device's stable id and restores its persisted state (+ outbox);
 *   2. wraps the real `LibraryStore` so live edits are captured (write-through), and persists the
 *      replica promptly on each edit;
 *   3. on the first activation, bootstraps existing store data into the replica (one-time hydrate);
 *   4. runs a sync round on start, on an interval, and on app foreground: push outbox → pull → merge
 *      → apply merged state back into the stores → refresh the query cache.
 *
 * v1 targets the **trusted self-hosted hub** (`httpSyncBackend`, cleartext records so the server can
 * merge). The E2E `CryptoBox` (crypto-box.ts) is built and tested but belongs to the untrusted
 * Tier-2 blob path, not wired here — a publicly-exposed hub should use that path. Reflected in the
 * Settings copy.
 *
 * This is app glue (AsyncStorage, react-native, the query client); its logic leans on the
 * unit-tested core. Only meaningful on native embedded mode, where the app owns the library store.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LibraryStore } from '@comical/library';
import type { InstalledStore, SavedRegistryStore, SettingsStore } from '@comical/host-rn';
import { bumpDataEpoch } from '../data-epoch';
import { queryClient } from '../query-client';
import { Clock, LibraryStoreBridge, Replica, SyncEngine, wrapLibraryStore, type StoreBridge, type SyncRecord } from '@comical/sync';
import { httpSyncBackend } from './http-backend';
import { asyncStorageCursor } from './cursor-store';
import { EmbeddedStoresBridge } from './embedded-bridge';
import { getDeviceId } from './device-id';
import { isSyncActive } from './sync-config';
import { getServerSession, type ServerSession } from '../server-session';

const SYNC_INTERVAL_MS = 60_000;
const REPLICA_KEY = 'comical:sync:replica';
const BOOTSTRAP_KEY = 'comical:sync:bootstrapped';
const PERSIST_DEBOUNCE_MS = 1_500;

export type SyncState = 'idle' | 'syncing' | 'error';
export type SyncStatus = { state: SyncState; lastSyncAt?: number; error?: string };

/** In-memory sync status (Legend State), read in the UI via `useSyncStatus()`. */
const status$ = observable<SyncStatus>({ state: 'idle' });

class SyncController {
  private replica?: Replica;
  private bridges: StoreBridge[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private appStateSub?: { remove(): void };
  private syncing = false;
  private persistTimer?: ReturnType<typeof setTimeout>;

  private setStatus(next: Partial<SyncStatus>): void {
    status$.assign(next);
  }

  /**
   * Wire the controller to the app's stores and return the write-through-wrapped library store to
   * hand to the host runtime. Call once at startup, BEFORE constructing the router.
   */
  async attach(
    rawLibrary: LibraryStore,
    registries: SavedRegistryStore,
    installed: InstalledStore,
    settings: SettingsStore,
  ): Promise<LibraryStore> {
    const node = await getDeviceId();
    const replica = new Replica(new Clock(node, Date.now));
    const persisted = await this.loadState();
    if (persisted) replica.importState(persisted);
    this.replica = replica;
    this.bridges = [new LibraryStoreBridge(rawLibrary), new EmbeddedStoresBridge(registries, installed, settings)];
    return wrapLibraryStore(rawLibrary, replica, () => this.schedulePersist());
  }

  /** Start or stop the sync loop to match the current config. Safe to call repeatedly. */
  async refresh(): Promise<void> {
    if (isSyncActive() && this.replica) await this.start();
    else this.stop();
  }

  private async start(): Promise<void> {
    if (this.timer) return; // already running
    // Bootstrap is keyed by account and runs inside syncNow — a device can sign into a different
    // account, and its existing library must bootstrap into that new account too.
    this.timer = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS);
    this.appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void this.syncNow();
    });
    void this.syncNow();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.appStateSub?.remove();
    this.timer = undefined;
    this.appStateSub = undefined;
  }

  /** Run one sync round. Returns true on success. Never throws to the caller. */
  async syncNow(): Promise<boolean> {
    const session = getServerSession();
    if (this.syncing || !this.replica || !isSyncActive()) return false;
    this.syncing = true;
    this.setStatus({ state: 'syncing', error: undefined });
    try {
      // The account came from the server at login; the hub re-derives it from the session token, so
      // the header is only used to key the local cursor.
      const account = session.account;
      await this.ensureBootstrapped(account);
      const backend = httpSyncBackend({ baseUrl: session.url, account, token: session.token });
      const engine = new SyncEngine(this.replica, backend, asyncStorageCursor(account));
      await engine.sync();
      for (const b of this.bridges) await b.apply(this.replica);
      await this.persistNow();
      bumpDataEpoch();
      queryClient.invalidateQueries();
      this.setStatus({ state: 'idle', lastSyncAt: Date.now(), error: undefined });
      return true;
    } catch (e) {
      this.setStatus({ state: 'error', error: await this.describeFailure(session, e as Error) });
      return false;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Turn a raw sync error into something the user can act on. The session token is server-specific, so
   * a foreign network's server (a different Comical hub at the same LAN IP) just 401s — safe, but
   * cryptic. Ask the server who it is (`/health`, unauthenticated) to tell the three cases apart:
   * server down, wrong server, or this session revoked.
   */
  private async describeFailure(session: ServerSession, err: Error): Promise<string> {
    let health: { serverId?: string } | null = null;
    try {
      const res = await fetch(`${session.url}/health`);
      if (res.ok) health = (await res.json()) as { serverId?: string };
    } catch {
      return 'Sync server unreachable.';
    }
    if (!health) return 'Sync server unreachable.';
    if (session.serverId && health.serverId && health.serverId !== session.serverId) {
      return 'This isn’t the server you signed in to — a different Comical server is at this address. Sync paused.';
    }
    // Same server (or an old session with no stored id): a 401 here means this session was revoked.
    if (/\b401\b/.test(err.message)) return 'You’re no longer signed in. Sign in again in Settings → Sync.';
    return err.message || 'Sync failed';
  }

  // ── one-time bootstrap of pre-existing store data (per account) ─────────────
  private async ensureBootstrapped(account: string): Promise<void> {
    if (!this.replica) return;
    const key = `${BOOTSTRAP_KEY}:${account}`;
    if (await AsyncStorage.getItem(key)) return;
    for (const b of this.bridges) await b.hydrate(this.replica);
    await this.persistNow();
    await AsyncStorage.setItem(key, '1');
  }

  // ── replica persistence ─────────────────────────────────────────────────────
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }
  private async persistNow(): Promise<void> {
    if (!this.replica) return;
    try {
      await AsyncStorage.setItem(REPLICA_KEY, JSON.stringify(this.replica.exportState()));
    } catch {
      /* best-effort */
    }
  }
  private async loadState(): Promise<{ records: SyncRecord[]; dirty: string[] } | null> {
    try {
      const raw = await AsyncStorage.getItem(REPLICA_KEY);
      return raw ? (JSON.parse(raw) as { records: SyncRecord[]; dirty: string[] }) : null;
    } catch {
      return null;
    }
  }
}

/** The app's single sync controller. */
export const syncController = new SyncController();

/** Live sync status for the Settings UI. */
export function useSyncStatus(): SyncStatus {
  return use$(status$);
}
