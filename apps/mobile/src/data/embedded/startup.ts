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
// Polyfills `crypto.getRandomValues` on Hermes (absent natively) — the entropy source the host-rn
// `installWebCryptoShim` builds `crypto.randomUUID` on, which `@comical/library` needs to mint list/
// group ids. Must run before `installWebCryptoShim()` below; import order = execution order in Metro.
import 'react-native-get-random-values';

import {
  applyEmbeddedMode,
  configureEmbeddedRuntime,
  installWebCryptoShim,
  setNativeBridgeRuntime,
  setNativeTrackerRuntime,
  type CreateRouter,
  type EmbeddedBootstrapConfig,
} from '@comical/host-rn';
import { createRouter } from '@comical/host-server/router';
import { downloadBundle, fetchIndex } from '@comical/registry/fetcher';
import comicalRuntime from '../../../modules/comical-runtime';
import { setTransport } from '../api';
import { bumpDataEpoch } from '../data-epoch';
import { queryClient } from '../query-client';
import { applyChapterCheck } from '../activity/background';
import { getNotifyPrefsSync } from '../activity/prefs';
import { downloadsStore } from '../downloads/async-store';
import { applyBackgroundDownloads } from '../downloads/background';
import { expoBlobStore } from '../downloads/blob-store';
import { installNetworkAutoResume, mayDownloadNow, resumePendingDownloads } from '../downloads/engine';
import { installDownloadProgress } from '../downloads/events';
import { devicePageFetcher, onDevicePageRetry } from '../downloads/fetch-page';
import { hydrateDownloadIndex } from '../downloads/index-cache';
import { getDownloadPrefsSync } from '../downloads/prefs';
import { swapDataSourceMode } from './apply-mode';
import { fileSystemBundleCache, pruneBundleCache } from './bundle-cache';
import { expoCoversBlobStore } from './covers-store';
import { migrateLegacyEntries } from './legacy-entries';
import { AsyncStorageLibraryStore } from './library-store';
import { getResolvedModeSync, whenEmbeddedPrefLoaded } from './preference';
import { applyImageCacheConfig } from '../image-cache';
import { logDiagnostic } from '@/lib/diagnostics';
import { installedStore, installedTrackerStore, savedRegistryStore } from './stores';
import { asyncStorageSettings, asyncStorageTrackerSettings } from './settings-store';
import { embeddedOAuthCallbackUrl } from './oauth-callback';

// ONE store instance for the process: the router writes through it, and the legacy-entries
// migration below reads and rebuilds through it. Two instances would each hold their own
// `serializeAsyncMethods` lock, so the migration's writes could interleave with the router's.
const libraryStore = new AsyncStorageLibraryStore();

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
    libraryStore,
    // On-device downloads persistence — mounts the router's `/downloads*` endpoints in embedded mode
    // so the offline-download manifest (enqueue / record / storage / delete) works with no server.
    // The SHARED instance (its doc cache makes a second copy incoherent — see async-store.ts).
    downloadsStore,
    // Device seams for the shared download engine (which host-rn runs in-process behind the router):
    // bytes land on this device's filesystem, pages resolve through the reader's own asset resolver,
    // and the Wi-Fi-only policy gates the drain. See `getEmbeddedDownloadEngine()` for the lifecycle.
    downloadsEngine: {
      blobs: expoBlobStore,
      fetchPage: devicePageFetcher,
      mayDownload: mayDownloadNow,
      onPageRetry: onDevicePageRetry,
    },
    // Guaranteed-offline library covers: captured into this device store on library-add/browse and
    // served back by the reused router at /library/collected/series/:b/:s/cover.
    covers: { blobs: expoCoversBlobStore, fetchPage: devicePageFetcher },
    // On-device tracker persistence — trackers are registry-installed exactly like bridges, not a
    // static app-bundled map (mirrors `installed`/`savedRegistryStore` above). Also needs a native
    // tracker runtime to be registered (see `setNativeTrackerRuntime` below), which is null until a
    // real device build.
    installedTrackers: installedTrackerStore,
    trackerSettings: asyncStorageTrackerSettings,
    // There's no real HTTP server on-device to redirect an OAuth provider back to — see
    // `EmbeddedBootstrapConfig.oauthCallbackUrl`'s doc comment in host-rn for how the reused router
    // completes the round trip against this custom-scheme URL instead.
    oauthCallbackUrl: embeddedOAuthCallbackUrl,
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
  // Same native module also implements NativeTrackerRuntime (see modules/comical-runtime) — one
  // `requireOptionalNativeModule` call up top covers both.
  setNativeTrackerRuntime(comicalRuntime);
  // Bridge bundle verification (@comical/registry verify.ts) needs WebCrypto, absent in Hermes.
  installWebCryptoShim();
  configureEmbeddedRuntime(bootstrapConfig());
  // Rebuild the user's shelf from the pre-collections entries document, if this device still has
  // one. Runs regardless of the resolved mode: the data is on THIS device either way, and the
  // import is a no-op after the first launch that finds it. Must follow `installWebCryptoShim()`
  // (it mints a collection id with `crypto.randomUUID`).
  //
  // Not awaited — blocking launch on AsyncStorage reads would cost every user a slower cold start
  // for a one-time migration. The library screen can therefore race it, so a run that actually
  // imported something refetches, the same way a registry change does.
  void migrateLegacyEntries(libraryStore)
    .then((result) => {
      if (!result || result.imported === 0) return;
      logDiagnostic('library', `Migrated ${result.imported} pre-collections entries (${result.skipped} skipped)`);
      bumpDataEpoch();
      void queryClient.invalidateQueries();
    })
    .catch((e: unknown) => logDiagnostic('library', `Legacy entries migration failed: ${String(e)}`));
  const bootEmbedded = applyEmbeddedMode(getResolvedModeSync() === 'embedded');
  // That sync read ran before the preference finished rehydrating from AsyncStorage, so it saw the
  // unset DEFAULT (embedded whenever the native runtime exists) — a persisted "remote" choice
  // hasn't loaded yet, which stranded remote users on the (bridge-less) embedded runtime every
  // cold boot. Re-resolve once hydration lands; if the answer changed, swap with the same side
  // effects as the Settings toggle, since anything already fetched went through the wrong transport.
  void whenEmbeddedPrefLoaded().then(() => {
    const embedded = getResolvedModeSync() === 'embedded';
    if (embedded !== bootEmbedded) swapDataSourceMode(embedded);
  });
  // Warm the sync offline index from the manifest, then resume any downloads interrupted last session.
  void hydrateDownloadIndex().then(() => resumePendingDownloads());
  // Pipe live download progress for the resolved mode (embedded engine subscription / remote SSE).
  installDownloadProgress();
  // Auto-resume when connectivity/Wi-Fi returns (not just on next launch).
  installNetworkAutoResume();
  // Apply the user's image-cache size cap — the native layer LRU-evicts to stay under it.
  applyImageCacheConfig();
  // Sweep stale bridge bundles left by past updates (one file per id kept) — the only cache with no
  // built-in bound. Cheap dir walk; safe to fire-and-forget after the runtime is configured.
  pruneBundleCache();
  // Re-arm the background drain task if the user enabled it.
  applyBackgroundDownloads(getDownloadPrefsSync().background);
  // Re-arm the background chapter check if the user enabled it. Importing `activity/background`
  // here also guarantees its defineTask ran wherever this startup module loads (incl. headless).
  applyChapterCheck(getNotifyPrefsSync().backgroundCheck);
}
