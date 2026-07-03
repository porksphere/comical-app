/**
 * Native startup wiring for the embedded runtime (the `.web.ts` sibling is a no-op — web is always
 * remote). This is the single integration point: it hands `@comical/host-rn` the pieces the app owns
 * — the built `@comical/host-server` `createRouter` and `@comical/registry` fetcher (from their
 * Node-free subpaths), the resolved native module, `api.ts`'s `setTransport`, and the AsyncStorage
 * `SettingsStore`.
 *
 * Bridge registries are NOT hardcoded: they come from the persisted user list (`registry-config.ts`),
 * managed in Settings. Published builds ship with none — the runtime then simply has no bridges
 * (empty browse), never the remote transport, so there are no failed-request errors. Because the
 * persisted list hydrates from AsyncStorage *after* this runs, the runtime subscribes to it and
 * reconfigures (and refetches) when it hydrates or the user adds/removes a registry.
 *
 * Called once from `_layout.tsx` at app launch.
 */
import {
  applyEmbeddedMode,
  configureEmbeddedRuntime,
  installWebCryptoShim,
  setNativeBridgeRuntime,
  type CreateRouter,
  type EmbeddedBootstrapConfig,
} from '@comical/host-rn';
import { createRouter } from '@comical/host-server/router';
import { downloadBundle, fetchIndex } from '@comical/registry/fetcher';
import comicalRuntime from '../../../modules/comical-runtime';
import { setTransport } from '../api';
import { bumpDataEpoch } from '../data-epoch';
import { queryClient } from '../query-client';
import { getResolvedModeSync } from './preference';
import { addRegistryUrl, getRegistryUrlsSync, removeRegistryUrl, subscribeRegistryUrls } from './registry-config';
import { asyncStorageSettings } from './settings-store';

/** The fixed pieces host-rn needs, parameterized by the (user-managed) registry list. */
function bootstrapConfig(indexUrls: string[]): EmbeddedBootstrapConfig {
  return {
    createRouter: createRouter as unknown as CreateRouter,
    fetcher: { fetchIndex, downloadBundle },
    indexUrls,
    setTransport,
    settings: asyncStorageSettings,
  };
}

/** (Re)build the embedded runtime against the current registry list. */
function reconfigure(refetch: boolean): void {
  applyEmbeddedMode(false); // tear down the previous provider + its native bridge contexts
  configureEmbeddedRuntime(bootstrapConfig(getRegistryUrlsSync()));
  applyEmbeddedMode(getResolvedModeSync() === 'embedded');
  if (refetch) {
    bumpDataEpoch(); // refetch useDataSource-backed screens (Browse etc.) against the new registry set
    queryClient.invalidateQueries(); // and any react-query-backed data (library/history)
  }
}

let started = false;

export function startEmbeddedRuntime(): void {
  if (started) return;
  started = true;
  // Register the on-device engine (null on web / before the native module is built → stays remote).
  setNativeBridgeRuntime(comicalRuntime);
  // Bridge bundle verification (@comical/registry verify.ts) needs WebCrypto, absent in Hermes.
  installWebCryptoShim();
  // Initial configure with whatever's known synchronously (env seed or empty) — no stale cache yet.
  reconfigure(false);
  // Reconfigure + refetch when the persisted list hydrates, and on every add/remove.
  subscribeRegistryUrls(() => reconfigure(true));
}

/** Add a bridge registry (persisted; the subscription reconfigures + refetches). */
export function addEmbeddedRegistry(url: string): void {
  addRegistryUrl(url);
}

/** Remove a bridge registry (persisted; the subscription reconfigures + refetches). */
export function removeEmbeddedRegistry(url: string): void {
  removeRegistryUrl(url);
}
