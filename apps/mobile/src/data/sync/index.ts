/**
 * The app's library sync: `./controller.ts` over AsyncStorage, the configured server's `/sync`
 * routes, and the app lifecycle (sync on foreground, save on background). Native only in practice —
 * web always reads the server's own library, so `initLibrarySync` is only called from the native
 * startup and the hooks below just report sync as off there.
 */
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LibraryStore } from '@comical/library';
import { HttpBackend, type BridgeSettingsProvider, type RegistryLists, type RegistryMutations, type SyncStats } from '@comical/sync';
import { AppState } from 'react-native';

import { showToast } from '@/components/toast';
import { syncDeviceName } from '@/lib/device-name';
import { logDiagnostic } from '@/lib/diagnostics';
import { getApiBase, getSyncSecret } from '../api';
import { bumpDataEpoch } from '../data-epoch';
import { getResolvedModeSync } from '../embedded/preference';
import { queryClient } from '../query-client';
import { createLibrarySync, type LibrarySync, type SyncDoc, type SyncStatus } from './controller';

export type { SyncStatus } from './controller';

const STATE_KEY = 'comical:sync:state';
/** Give launch a moment before the first round; it's never urgent. */
const LAUNCH_DELAY_MS = 3000;

const status$ = observable<SyncStatus>({ enabled: false, running: false });
let sync: LibrarySync | null = null;

/** Wraps the on-device library store so its writes are recorded, and starts syncing if paired. */
export function initLibrarySync(raw: LibraryStore, registry: RegistryLists): LibraryStore {
  if (sync) return sync.store;
  const s = createLibrarySync({
    raw,
    registry,
    load: async () => {
      const text = await AsyncStorage.getItem(STATE_KEY);
      return text ? (JSON.parse(text) as SyncDoc) : null;
    },
    save: async (doc) => {
      if (doc) await AsyncStorage.setItem(STATE_KEY, JSON.stringify(doc));
      else await AsyncStorage.removeItem(STATE_KEY);
    },
    backend: () => {
      const secret = getSyncSecret();
      return new HttpBackend({ baseUrl: getApiBase(), fetch: (url, init) => fetch(url, init), ...(secret && { secret }) });
    },
    canSync: () => getResolvedModeSync() === 'embedded',
    newDeviceId: () => `app-${crypto.randomUUID()}`,
    deviceName: syncDeviceName,
    onApplied: () => {
      bumpDataEpoch();
      void queryClient.invalidateQueries();
    },
    onRepaired: () => showToast('Sync paired again — the computer had been reset.'),
    onStatus: (next) => status$.set(next),
    log: (message) => logDiagnostic('sync', message),
  });
  sync = s;
  setTimeout(() => void s.syncNow(), LAUNCH_DELAY_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void s.syncNow();
    else void s.flush().catch((e: unknown) => logDiagnostic('sync', `Sync state not saved: ${String(e)}`));
  });
  return s.store;
}

/** For host-rn's `decorateRegistry`: the router's registry provider, recording while paired. */
export function decorateRegistryForSync<P extends RegistryMutations>(provider: P): P {
  return sync ? sync.decorateRegistry(provider) : provider;
}

/** For host-rn's `decorateBridges`: the router's bridge provider, recording preferences while paired. */
export function decorateBridgesForSync<P extends BridgeSettingsProvider>(provider: P): P {
  return sync ? sync.decorateBridges(provider) : provider;
}

export function useSyncStatus(): SyncStatus {
  return use$(status$);
}

/** Paired, as of now — for code outside React deciding whether a server change is a re-pair. */
export function isSyncEnabled(): boolean {
  return status$.enabled.peek();
}

export function setSyncEnabled(enabled: boolean): Promise<void> {
  if (!sync) return Promise.resolve();
  return enabled ? sync.enable() : sync.disable();
}

export function syncLibraryNow(): Promise<SyncStats | undefined> {
  return sync ? sync.syncNow() : Promise.resolve(undefined);
}
