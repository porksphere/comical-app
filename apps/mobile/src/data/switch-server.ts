/**
 * Point the app at another server. Everything cached came from the old one, so it all goes, and a
 * library syncing with the old one pairs with the new from scratch — a different hub has never
 * seen this device's changes.
 */
import { HttpBackend, pair, SyncHttpError, SyncPairingError, type Pairing } from '@comical/sync';

import { getApiBase, getSyncPairing, setApiBaseOverride } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { installDownloadProgress } from '@/data/downloads/events';
import { hydrateDownloadIndex } from '@/data/downloads/index-cache';
import { getResolvedModeSync } from '@/data/embedded/preference';
import { queryClient } from '@/data/query-client';
import { isSyncEnabled, setSyncEnabled } from '@/data/sync';
import type { SyncAddress } from '@/data/sync-address';
import { syncDeviceName } from '@/lib/device-name';

/** `null` goes back to the build's default server. `pairing` is this device's key with a desktop hub. */
export function switchServer(url: string | null, pairing?: Pairing): void {
  const left = getSyncPairing();
  // So the computer being left stops listing this device. Unreachable, it keeps the row until
  // someone unlinks it there; either way this device has already let go of the key.
  if (left) void new HttpBackend({ baseUrl: getApiBase(), fetch: (u, init) => fetch(u, init), pairing: left }).unpair().catch(() => {});
  setApiBaseOverride(url, pairing);
  queryClient.clear(); // a different server's cached data can't be trusted (mirrors PERSIST_BUSTER)
  bumpDataEpoch(); // refetch useDataSource-backed screens against the new server
  installDownloadProgress(); // the SSE stream targets the new server
  void hydrateDownloadIndex(); // remote /file URLs embed the server base — rebuild them
  if (getResolvedModeSync() === 'embedded' && isSyncEnabled()) void setSyncEnabled(false).then(() => setSyncEnabled(true));
}

/**
 * Take the server a sheet or a scan named. One that came with a code is a desktop hub, and is
 * paired with before anything is switched, so a code that doesn't work leaves the app where it
 * was. Rejects with what `pairingFailureMessage` explains.
 */
export async function connectServer(address: SyncAddress | null): Promise<void> {
  const pairing = address?.code
    ? await pair({ baseUrl: address.url, fetch: (u, init) => fetch(u, init), code: address.code, name: syncDeviceName() })
    : undefined;
  switchServer(address?.url ?? null, pairing);
}

export function pairingFailureMessage(e: unknown): string {
  if (e instanceof SyncPairingError) return 'That code has expired or was already used. Show a new one on your computer.';
  if (e instanceof SyncHttpError) return 'Your computer refused the pairing. Try again.';
  return "Couldn't reach your computer. Check that this device is on the same network.";
}
