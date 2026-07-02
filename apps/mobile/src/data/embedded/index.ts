/**
 * Public entry for the on-device embedded runtime — a barrel re-exporting the pieces. The install
 * functions live in `./install` (not here) so `bootstrap.ts` can use them without an
 * `index ⇄ bootstrap` require cycle.
 *
 * `createRouter` (from the built `@comical/host-server` package) is injected by the caller rather
 * than imported here, so this layer never pulls host-server's node-typed internals into the app's
 * TS program. The wiring site — where the real import lives — is the integration boundary that a
 * Metro build resolves (see `startup.ts`).
 */
export {
  installEmbeddedTransport,
  uninstallEmbeddedTransport,
  type EmbeddedRuntimeConfig,
} from './install';
export { isEmbeddedRuntimeAvailable, setNativeBridgeRuntime } from './native-runtime';
export { EmbeddedBridgeProvider } from './provider';
export { configureEmbeddedRuntime, applyEmbeddedMode } from './bootstrap';
export type { EmbeddedBootstrapConfig } from './bootstrap';
export {
  RegistryBundleSource,
  MemoryBundleCache,
  type RegistryFetcher,
  type BundleCache,
} from './registry-bundle-source';
export {
  useEmbeddedEnabled,
  setEmbeddedEnabled,
  getResolvedModeSync,
  type DataSourceMode,
} from './preference';
export type { BundleSource, NativeBridgeRuntime, InstalledBridge, SettingsStore } from './types';
