/**
 * The transport swap (embedded ⇄ remote) with its full set of side effects — the ONE shared
 * implementation, used by the Settings "Run bridges on this device" toggle and by startup's
 * post-hydration correction (`startup.ts`). A swap without these flushes leaves screens showing
 * (and re-persisting) data fetched through the other transport, so the two must never drift apart.
 */
import { applyEmbeddedMode } from '@comical/host-rn';

import { bumpDataEpoch } from '../data-epoch';
import { installDownloadProgress } from '../downloads/events';
import { hydrateDownloadIndex } from '../downloads/index-cache';
import { queryClient } from '../query-client';

export function swapDataSourceMode(embedded: boolean): void {
  applyEmbeddedMode(embedded); // swap api.ts's transport (embedded ⇄ remote)
  queryClient.clear(); // embedded and remote caches must not mix (mirrors PERSIST_BUSTER)
  bumpDataEpoch(); // refetch useDataSource-backed screens against the swapped transport
  installDownloadProgress(); // re-pipe progress (embedded engine subscription ⇄ remote SSE)
  void hydrateDownloadIndex(); // the mode changes what a "local page" is (file:// ⇄ server /file)
}
