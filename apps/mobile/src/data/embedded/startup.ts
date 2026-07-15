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
import type { LibraryStore } from '@comical/library';
import comicalRuntime from '../../../modules/comical-runtime';
import { setTransport } from '../api';
import { logDiagnostic } from '@/lib/diagnostics';
import { bumpDataEpoch } from '../data-epoch';
import { queryClient } from '../query-client';
import { syncController } from '../sync/controller';
import { fileSystemBundleCache } from './bundle-cache';
import { AsyncStorageLibraryStore } from './library-store';
import { getResolvedModeSync } from './preference';
import { installedStore, savedRegistryStore } from './stores';
import { asyncStorageSettings } from './settings-store';

/** The fixed pieces host-rn needs; the stores supply the (user-managed) registries + installs. */
function bootstrapConfig(libraryStore: LibraryStore): EmbeddedBootstrapConfig {
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
    libraryStore,
    // Persist verified bundles to disk so cold starts don't re-download + re-verify every bridge.
    cache: fileSystemBundleCache,
    // An install/update/uninstall (or add/remove registry) changes what the runtime serves — refetch
    // the useDataSource-backed screens (Browse etc.) and any react-query-backed data.
    onRegistryChange: () => {
      bumpDataEpoch();
      queryClient.invalidateQueries();
    },
    // A bridge that won't download/validate/init is skipped from the list rather than wedging it;
    // surface why in the in-app diagnostics (Settings → Diagnostics) so a stale/404'd bridge is
    // debuggable instead of silently missing.
    onBridgeLoadError: (bridgeId, error) => {
      logDiagnostic(
        'bridge-load',
        `Bridge "${bridgeId}" failed to load and was skipped: ${error instanceof Error ? error.message : String(error)}`,
        { context: bridgeId },
      );
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
  void bootstrapEmbedded();
}

/**
 * Async tail: attach the cross-device-sync controller (which wraps the library store with
 * write-through capture) BEFORE the router is configured, so live edits are captured, then start
 * syncing if it's already configured. Falls back to the raw store if attach fails, so the runtime
 * always comes up. Fire-and-forget — the app's screens already handle "runtime not yet ready".
 */
async function bootstrapEmbedded(): Promise<void> {
  const rawLibrary = new AsyncStorageLibraryStore();
  let libraryStore: LibraryStore = rawLibrary;
  try {
    libraryStore = await syncController.attach(rawLibrary, savedRegistryStore, installedStore, asyncStorageSettings);
  } catch {
    // Sync attach failed — run with the unwrapped store; the app is unaffected.
  }
  configureEmbeddedRuntime(bootstrapConfig(libraryStore));
  applyEmbeddedMode(getResolvedModeSync() === 'embedded');
  void syncController.refresh(); // starts the loop iff sync is configured; no-op otherwise
}
