/**
 * Point the app at another server. Everything cached came from the old one, so it all goes, and a
 * library syncing with the old one pairs with the new from scratch — a different hub has never
 * seen this device's changes.
 */
import { setApiBaseOverride } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { installDownloadProgress } from '@/data/downloads/events';
import { hydrateDownloadIndex } from '@/data/downloads/index-cache';
import { getResolvedModeSync } from '@/data/embedded/preference';
import { queryClient } from '@/data/query-client';
import { isSyncEnabled, setSyncEnabled } from '@/data/sync';

/** `null` goes back to the build's default server. */
export function switchServer(url: string | null): void {
  setApiBaseOverride(url);
  queryClient.clear(); // a different server's cached data can't be trusted (mirrors PERSIST_BUSTER)
  bumpDataEpoch(); // refetch useDataSource-backed screens against the new server
  installDownloadProgress(); // the SSE stream targets the new server
  void hydrateDownloadIndex(); // remote /file URLs embed the server base — rebuild them
  if (getResolvedModeSync() === 'embedded' && isSyncEnabled()) void setSyncEnabled(false).then(() => setSyncEnabled(true));
}
