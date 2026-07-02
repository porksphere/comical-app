/**
 * Local type contract for the on-device embedded runtime.
 *
 * These interfaces intentionally mirror the seams in the sibling `comical` repo
 * (`@comical/host-server`'s `BridgeProvider`/`BridgeSummary` and `@comical/core`'s bridge method
 * surface) *structurally*, so this module typechecks under the app's `tsc` without importing
 * host-server source (which transitively references `node:fs`-typed managers via `RouterOptions`).
 * At runtime the real `createRouter` (from the built `@comical/host-server` package) is injected via
 * `configureEmbeddedRuntime`, and a proxy bridge — whose methods marshal to the native JS engine —
 * is what the router drives. Keep these in lockstep with:
 *   comical/packages/host-server/src/bridge-provider.ts
 *   comical/packages/contract/src/bridge.ts
 */
import type { BridgeInfo, SettingDescriptor, SettingValue } from '@comical/contract';

/** Mirrors `@comical/host-server` `BridgeSummary`. */
export interface BridgeSummary {
  info: BridgeInfo;
  settings: SettingDescriptor[];
  configured: boolean;
  missingRequired: string[];
  source: 'local' | 'registry';
  availableVersion?: string;
}

/**
 * A loaded bridge as the router sees it: `info`, the sync `getSettings()` descriptor list, and
 * whichever capability methods the bridge implements (each an async fn → parsed native result).
 * Typed loosely (Record) because the router gates on method *presence* and calls them dynamically.
 */
export type ProxyBridge = {
  info: BridgeInfo;
  getSettings(): SettingDescriptor[];
} & Record<string, unknown>;

/** Mirrors `@comical/host-server` `BridgeProvider` — the surface `createRouter` calls. */
export interface BridgeProvider {
  list(): Promise<BridgeSummary[]>;
  get(id: string): Promise<ProxyBridge>;
  missingRequired(id: string): Promise<string[]>;
  storedSettings(id: string): Promise<Record<string, SettingValue>>;
  updateSettings(id: string, values: Record<string, SettingValue>): Promise<Record<string, SettingValue>>;
  invalidate(id: string): void;
  refresh(): void;
}

/** A `Hono`-like app returned by `createRouter` — only `.fetch` is used in-process. */
export interface EmbeddedRouter {
  fetch(req: Request): Response | Promise<Response>;
}

/** The `@comical/host-server` `createRouter` signature (subset the embedded runtime uses). */
export type CreateRouter = (manager: BridgeProvider, opts?: { origin?: string }) => EmbeddedRouter;

/**
 * The native module surface (an Expo module wrapping `ComicalBridgeContext` — JSC on iOS, QuickJS
 * on Android). Bundle code runs in a separate JS engine; everything crosses the boundary as JSON.
 * `initBridge` returns the loaded bridge's `{ info, methods }` (methods = the names the bridge
 * actually implements, so the proxy exposes exactly those).
 */
export interface NativeBridgeRuntime {
  initBridge(id: string, code: string, settingsJson: string, networkJson?: string): Promise<string>;
  callBridge(id: string, method: string, argsJson: string): Promise<string>;
  disposeBridge(id: string): void;
}

/** What `initBridge` resolves to (JSON-encoded). */
export interface InitResult {
  info: BridgeInfo;
  /** Method names the loaded bridge implements; omitted by older native builds (see capabilities.ts fallback). */
  methods?: string[];
}

/**
 * Supplies a bridge's bundle code + install metadata. The content-only v1 implementation downloads
 * + verifies + caches bundles from a registry (mirrors `@comical/registry`); see task #2 notes.
 */
export interface InstalledBridge {
  info: BridgeInfo;
  settings: SettingDescriptor[];
  source: 'local' | 'registry';
  availableVersion?: string;
}

export interface BundleSource {
  /** Ids of all installed bridges (for `list()`), cheap — no bundle load required. */
  installed(): Promise<InstalledBridge[]>;
  /** The bundle source code for a bridge id; throws with "not found" for an unknown id. */
  resolveBundle(id: string): Promise<string>;
}

/** Minimal per-bridge settings persistence (AsyncStorage-backed at runtime; injectable for tests). */
export interface SettingsStore {
  get(id: string): Promise<Record<string, SettingValue>>;
  set(id: string, values: Record<string, SettingValue>): Promise<void>;
}
