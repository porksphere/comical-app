/**
 * Native startup wiring for the embedded runtime (the `.web.ts` sibling is a no-op — web is always
 * remote). This is the single integration point: it hands `@comical/host-rn` the pieces the app owns
 * — the built `@comical/host-server` `createRouter` and `@comical/registry` fetcher (from their
 * Node-free subpaths), the resolved native module, `api.ts`'s `setTransport`, the AsyncStorage
 * `SettingsStore`, and the two AsyncStorage registry stores (`./stores`).
 *
 * Registries and installed bridges are NOT hardcoded: they come from the persisted stores, managed in
 * Settings through the *same* registry endpoints the remote server exposes (host-rn mounts an
 * `EmbeddedRegistryProvider` into the reused router). Published builds ship with none — the runtime
 * then simply has no installed bridges (empty browse), never the remote transport, so there are no
 * failed-request errors. Because the stores read AsyncStorage lazily, no reconfigure is needed when
 * the user adds a registry or installs/uninstalls a bridge: the runtime's `onRegistryChange` just
 * refetches the affected screens.
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
import { AsyncStorageDownloadsStore } from '../downloads/async-store';
import { applyBackgroundDownloads } from '../downloads/background';
import { installNetworkAutoResume, resumePendingDownloads } from '../downloads/engine';
import { hydrateDownloadIndex } from '../downloads/index-cache';
import { getDownloadPrefsSync } from '../downloads/prefs';
import { fileSystemBundleCache } from './bundle-cache';
import { AsyncStorageLibraryStore } from './library-store';
import { getResolvedModeSync } from './preference';
import { applyImageCacheConfig } from '../image-cache';
import { installedStore, savedRegistryStore } from './stores';
import { asyncStorageSettings } from './settings-store';

/** The fixed pieces host-rn needs; the stores supply the (user-managed) registries + installs. */
function bootstrapConfig(): EmbeddedBootstrapConfig {
  return {
    createRouter: createRouter as unknown as CreateRouter,
    fetcher: { fetchIndex, downloadBundle },
    installed: installedStore,
    registries: savedRegistryStore,
    setTransport,
    settings: asyncStorageSettings,
    // On-device library persistence — mounts the router's `/library*` endpoints in embedded mode so
    // Library/History/Activity (and add-to-library + read progress) work with no server. See
    // `library-store.ts`; the same endpoints the remote `comical-web` server already exposes.
    libraryStore: new AsyncStorageLibraryStore(),
    // On-device downloads persistence — mounts the router's `/downloads*` endpoints in embedded mode
    // so the offline-download manifest (enqueue / record / storage / delete) works with no server. The
    // image bytes themselves live on the filesystem via `blob-store.ts`; this store holds the manifest.
    downloadsStore: new AsyncStorageDownloadsStore(),
    // Persist verified bundles to disk so cold starts don't re-download + re-verify every bridge.
    cache: fileSystemBundleCache,
    // An install/update/uninstall (or add/remove registry) changes what the runtime serves — refetch
    // the useDataSource-backed screens (Browse etc.) and any react-query-backed data.
    onRegistryChange: () => {
      bumpDataEpoch();
      queryClient.invalidateQueries();
    },
  };
}

let started = false;

export function startEmbeddedRuntime(): void {
  if (started) return;
  started = true;
  // Register the on-device engine (null on web / before the native module is built → stays remote).
  setNativeBridgeRuntime(comicalRuntime);
  // Bridge bundle verification (@comical/registry verify.ts) needs WebCrypto, absent in Hermes.
  installWebCryptoShim();
  configureEmbeddedRuntime(bootstrapConfig());
  applyEmbeddedMode(getResolvedModeSync() === 'embedded');
  // Warm the sync offline index from the manifest, then resume any downloads interrupted last session.
  void hydrateDownloadIndex().then(() => resumePendingDownloads());
  // Auto-resume when connectivity/Wi-Fi returns (not just on next launch).
  installNetworkAutoResume();
  // Apply the user's image-cache size cap — the native layer LRU-evicts to stay under it.
  applyImageCacheConfig();
  // Re-arm the background drain task if the user enabled it.
  applyBackgroundDownloads(getDownloadPrefsSync().background);
}
