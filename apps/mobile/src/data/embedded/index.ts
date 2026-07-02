/**
 * Public entry for the on-device embedded runtime.
 *
 * `installEmbeddedTransport` builds the proxy `BridgeProvider` + the reused-router transport and
 * makes it the active `api.ts` transport, so browse/search/series/reader resolve on-device with no
 * external server. It's a no-op when the native engine is unavailable (web, or before the native
 * module ships), so calling it unconditionally at startup is safe — the app simply stays remote.
 *
 * `createRouter` (from the built `@comical/host-server` package) is injected by the caller rather
 * than imported here, so this module never pulls host-server's node-typed internals into the app's
 * TS program. The wiring site — where the real import lives — is the integration boundary that a
 * Metro build resolves.
 */
import { setTransport } from '../api';
import { getNativeBridgeRuntime, isEmbeddedRuntimeAvailable } from './native-runtime';
import { EmbeddedBridgeProvider } from './provider';
import { asyncStorageSettings } from './settings-store';
import { createEmbeddedTransport } from './transport';
import type { BundleSource, CreateRouter, SettingsStore } from './types';

export interface EmbeddedRuntimeConfig {
  /** `@comical/host-server`'s `createRouter` (injected to keep this module node-type-free). */
  createRouter: CreateRouter;
  /** Supplies installed bridges + their bundle code (registry-download-backed in v1). */
  bundles: BundleSource;
  /** Per-bridge settings persistence; defaults to AsyncStorage. */
  settings?: SettingsStore;
  /** Optional GatedNetworkOptions overrides forwarded into each bridge load. */
  networkJson?: string;
}

let provider: EmbeddedBridgeProvider | null = null;

/**
 * Install the embedded transport as the active `api.ts` transport.
 * @returns true if installed, false if the native runtime is unavailable (stayed remote).
 */
export function installEmbeddedTransport(config: EmbeddedRuntimeConfig): boolean {
  const native = getNativeBridgeRuntime();
  if (!native) return false;
  provider = new EmbeddedBridgeProvider({
    native,
    bundles: config.bundles,
    settings: config.settings ?? asyncStorageSettings,
    ...(config.networkJson !== undefined ? { networkJson: config.networkJson } : {}),
  });
  setTransport(createEmbeddedTransport(provider, config.createRouter));
  return true;
}

/** Restore the remote HTTP transport and tear down native bridge contexts. */
export function uninstallEmbeddedTransport(): void {
  provider?.refresh();
  provider = null;
  setTransport(null);
}

export { isEmbeddedRuntimeAvailable };
export { EmbeddedBridgeProvider } from './provider';
export type { BundleSource, NativeBridgeRuntime, InstalledBridge, SettingsStore } from './types';
