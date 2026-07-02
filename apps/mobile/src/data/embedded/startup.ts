/**
 * Native startup wiring for the embedded runtime (the `.web.ts` sibling is a no-op — web is always
 * remote). This is the single integration point: it hands `@comical/host-rn` the pieces the app owns
 * — the built `@comical/host-server` `createRouter` and `@comical/registry` fetcher (from their
 * Node-free subpaths), the resolved native module, `api.ts`'s `setTransport`, and the AsyncStorage
 * `SettingsStore` — then installs the embedded transport if the persisted preference says on-device
 * (and the native engine is present). Safe to call when the native module isn't linked: it resolves
 * to remote.
 *
 * Called once from `_layout.tsx` at app launch. This and its imports are the only place the app
 * depends on the comical submodule at runtime; Metro bundles these subpaths on native only (see
 * metro.config.js). The `@comical/host-rn` package is Node-free, so importing it here is safe.
 */
import {
  applyEmbeddedMode,
  configureEmbeddedRuntime,
  installWebCryptoShim,
  setNativeBridgeRuntime,
  type CreateRouter,
} from '@comical/host-rn';
import { createRouter } from '@comical/host-server/router';
import { downloadBundle, fetchIndex } from '@comical/registry/fetcher';
import comicalRuntime from '../../../modules/comical-runtime';
import { setTransport } from '../api';
import { getResolvedModeSync } from './preference';
import { asyncStorageSettings } from './settings-store';

/**
 * Registry the on-device runtime downloads bridge bundles from. Intentionally NOT hardcoded — it
 * comes only from `EXPO_PUBLIC_COMICAL_REGISTRY` (set it in a gitignored `.env.local` for local dev,
 * or via a private build-time env). With no registry configured, the app has no on-device bridges
 * and stays on the remote transport.
 */
const REGISTRY_INDEX_URL = process.env.EXPO_PUBLIC_COMICAL_REGISTRY;

let started = false;

export function startEmbeddedRuntime(): void {
  if (started) return;
  started = true;
  // No registry configured (see `.env.local`) → nothing to run on-device; stay on the remote transport.
  if (!REGISTRY_INDEX_URL) return;
  // Register the on-device engine (null on web / before the native module is built → stays remote).
  setNativeBridgeRuntime(comicalRuntime);
  // Bridge bundle verification (@comical/registry verify.ts) needs WebCrypto, absent in Hermes.
  installWebCryptoShim();
  configureEmbeddedRuntime({
    createRouter: createRouter as unknown as CreateRouter,
    fetcher: { fetchIndex, downloadBundle },
    indexUrl: REGISTRY_INDEX_URL,
    setTransport,
    settings: asyncStorageSettings,
  });
  // Apply the persisted preference (no-ops to remote when the native engine is unavailable).
  applyEmbeddedMode(getResolvedModeSync() === 'embedded');
}
