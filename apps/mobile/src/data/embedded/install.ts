/**
 * Install/remove the embedded transport as `api.ts`'s active transport.
 *
 * Extracted from `index.ts` so `bootstrap.ts` can import these without an `index ⇄ bootstrap`
 * require cycle (index re-exports bootstrap's API; bootstrap needs install/uninstall).
 *
 * `installEmbeddedTransport` builds the proxy `BridgeProvider` + the reused-router transport and
 * makes it the active `api.ts` transport, so browse/search/reader resolve on-device with no external
 * server. It's a no-op when the native engine is unavailable (web, or before the native module
 * ships), so calling it unconditionally at startup is safe — the app simply stays remote.
 */
import { setTransport } from '../api';
import { getNativeBridgeRuntime } from './native-runtime';
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
