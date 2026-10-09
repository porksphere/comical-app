/**
 * The app's thin entry to the on-device embedded runtime. The reusable machinery lives in
 * `@comical/host-rn` (the comical submodule); this barrel just re-exports the pieces screens use,
 * alongside the app-owned preference hook. The runtime wiring — injecting the built `createRouter`,
 * registry fetcher, native module, `setTransport`, and AsyncStorage settings — is in `./startup`.
 */
export {
  applyEmbeddedMode,
  configureEmbeddedRuntime,
  installWebCryptoShim,
  isEmbeddedRuntimeAvailable,
  setNativeBridgeRuntime,
} from '@comical/host-rn';
export {
  useEmbeddedEnabled,
  setEmbeddedEnabled,
  getResolvedModeSync,
  type DataSourceMode,
} from './preference';
export { swapDataSourceMode } from './apply-mode';
