/**
 * Startup wiring for the embedded runtime.
 *
 * `configureEmbeddedRuntime` is called once at app launch with the pieces that must come from the
 * built native/host packages — `@comical/host-server`'s `createRouter` and `@comical/registry`'s
 * fetcher — plus the registry index URL. Those are *injected* (not imported here) so this module,
 * and the whole `embedded/` layer, typechecks and bundles without depending on host-server's
 * node-typed internals; the app entry that calls this is the single integration point a Metro build
 * resolves.
 *
 * `applyEmbeddedMode(enabled)` installs or removes the embedded transport accordingly. It's safe to
 * call before `configureEmbeddedRuntime` or when the native runtime is absent (web) — it simply
 * ensures the remote transport stays active and returns false.
 */
import { installEmbeddedTransport, uninstallEmbeddedTransport } from './install';
import { isEmbeddedRuntimeAvailable } from './native-runtime';
import { RegistryBundleSource } from './registry-bundle-source';
import type { BundleCache, RegistryFetcher } from './registry-bundle-source';
import type { CreateRouter, SettingsStore } from './types';

export interface EmbeddedBootstrapConfig {
  /** `@comical/host-server`'s `createRouter` (from the built package). */
  createRouter: CreateRouter;
  /** `@comical/registry`'s `{ fetchIndex, downloadBundle }` (from the built package). */
  fetcher: RegistryFetcher;
  /** Absolute URL of the registry `index.json` bridges are downloaded from. */
  indexUrl: string;
  /** Refuse unsigned bundles (default false — SHA-256 integrity is always enforced). */
  requireSignature?: boolean;
  /** Persistent bundle cache (defaults to in-memory; an expo-file-system adapter is a follow-up). */
  cache?: BundleCache;
  /** Per-bridge settings persistence (defaults to AsyncStorage). */
  settings?: SettingsStore;
  networkJson?: string;
}

let config: EmbeddedBootstrapConfig | null = null;

/** Register the injected runtime dependencies. Call once at app launch (native entry only). */
export function configureEmbeddedRuntime(next: EmbeddedBootstrapConfig): void {
  config = next;
}

/**
 * Install the embedded transport when `enabled` (and configured + available), else restore remote.
 * @returns true if the embedded transport is now active.
 */
export function applyEmbeddedMode(enabled: boolean): boolean {
  if (!enabled || !config || !isEmbeddedRuntimeAvailable()) {
    uninstallEmbeddedTransport();
    return false;
  }
  const bundles = new RegistryBundleSource({
    indexUrl: config.indexUrl,
    fetcher: config.fetcher,
    ...(config.cache ? { cache: config.cache } : {}),
    ...(config.requireSignature !== undefined ? { requireSignature: config.requireSignature } : {}),
  });
  return installEmbeddedTransport({
    createRouter: config.createRouter,
    bundles,
    ...(config.settings ? { settings: config.settings } : {}),
    ...(config.networkJson !== undefined ? { networkJson: config.networkJson } : {}),
  });
}
