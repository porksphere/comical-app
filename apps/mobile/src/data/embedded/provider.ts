/**
 * The in-process `BridgeProvider` comical-app hands to `createRouter` on iOS/Android.
 *
 * `get(id)` lazily loads a bridge bundle into the native engine (`initBridge`) — resolving its code
 * from the `BundleSource`, its user settings from the `SettingsStore` — then returns a `ProxyBridge`
 * whose methods marshal back to that native context. Loaded proxies + init results are cached; a
 * settings change or uninstall drops the cache (and the native context) via `invalidate`/`refresh`.
 *
 * `missingRequired` mirrors `@comical/core`'s `resolveSettings` (a required descriptor with neither a
 * stored value nor a default is missing) so the router's "not configured" gate behaves identically.
 */
import type { SettingDescriptor, SettingValue } from '@comical/contract';
import { methodsForBridge } from './capabilities';
import { buildProxyBridge } from './proxy-bridge';
import type {
  BridgeProvider,
  BridgeSummary,
  BundleSource,
  InitResult,
  InstalledBridge,
  NativeBridgeRuntime,
  ProxyBridge,
  SettingsStore,
} from './types';

/** Required descriptor keys with neither a stored value nor a default — matches resolveSettings. */
export function missingRequiredFor(
  descriptors: readonly SettingDescriptor[],
  stored: Record<string, SettingValue>,
): string[] {
  const missing: string[] = [];
  for (const d of descriptors) {
    const supplied = stored[d.key];
    if (supplied !== undefined && supplied !== '') continue;
    const hasDefault = 'default' in d && d.default !== undefined;
    if (!hasDefault && d.required) missing.push(d.key);
  }
  return missing;
}

export interface EmbeddedProviderDeps {
  native: NativeBridgeRuntime;
  bundles: BundleSource;
  settings: SettingsStore;
  /** Optional GatedNetworkOptions overrides forwarded to loadBridge (rate limits, etc.). */
  networkJson?: string;
}

export class EmbeddedBridgeProvider implements BridgeProvider {
  private readonly loaded = new Map<string, ProxyBridge>();
  private readonly installedCache = new Map<string, InstalledBridge>();

  constructor(private readonly deps: EmbeddedProviderDeps) {}

  private async installedFor(id: string): Promise<InstalledBridge> {
    const cached = this.installedCache.get(id);
    if (cached) return cached;
    const all = await this.deps.bundles.installed();
    for (const b of all) this.installedCache.set(b.info.id, b);
    const found = this.installedCache.get(id);
    if (!found) throw new Error(`bridge not found: ${id}`);
    return found;
  }

  async list(): Promise<BridgeSummary[]> {
    const all = await this.deps.bundles.installed();
    return Promise.all(
      all.map(async (b): Promise<BridgeSummary> => {
        this.installedCache.set(b.info.id, b);
        const missingRequired = missingRequiredFor(b.settings, await this.deps.settings.get(b.info.id));
        return {
          info: b.info,
          settings: b.settings,
          configured: missingRequired.length === 0,
          missingRequired,
          source: b.source,
          ...(b.availableVersion !== undefined ? { availableVersion: b.availableVersion } : {}),
        };
      }),
    );
  }

  async get(id: string): Promise<ProxyBridge> {
    const cached = this.loaded.get(id);
    if (cached) return cached;

    const installed = await this.installedFor(id); // throws "not found" for unknown ids
    const [code, stored] = await Promise.all([
      this.deps.bundles.resolveBundle(id),
      this.deps.settings.get(id),
    ]);
    const rawInit = await this.deps.native.initBridge(id, code, JSON.stringify(stored), this.deps.networkJson);
    const init = JSON.parse(rawInit) as InitResult;
    const methods = init.methods ?? methodsForBridge(init.info);
    const bridge = buildProxyBridge(id, init.info, installed.settings, methods, this.deps.native);
    this.loaded.set(id, bridge);
    return bridge;
  }

  async missingRequired(id: string): Promise<string[]> {
    const installed = await this.installedFor(id);
    return missingRequiredFor(installed.settings, await this.deps.settings.get(id));
  }

  storedSettings(id: string): Promise<Record<string, SettingValue>> {
    return this.deps.settings.get(id);
  }

  async updateSettings(
    id: string,
    values: Record<string, SettingValue>,
  ): Promise<Record<string, SettingValue>> {
    const merged = { ...(await this.deps.settings.get(id)), ...values };
    await this.deps.settings.set(id, merged);
    this.invalidate(id); // next get() reloads the native context with the new settings
    return merged;
  }

  invalidate(id: string): void {
    if (this.loaded.delete(id)) this.deps.native.disposeBridge(id);
  }

  refresh(): void {
    for (const id of this.loaded.keys()) this.deps.native.disposeBridge(id);
    this.loaded.clear();
    this.installedCache.clear();
  }
}
