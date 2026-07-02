/**
 * Builds the `ProxyBridge` the router drives. `info` + `getSettings()` are served from cached
 * install metadata (no round-trip); every content method is a thin marshaller that JSON-encodes its
 * args, calls into the native engine (`callBridge`), and parses the result. Only the methods the
 * bridge implements are attached, so the router's `if (!bridge.getX)` capability checks stay honest.
 */
import type { BridgeInfo, SettingDescriptor } from '@comical/contract';
import type { NativeBridgeRuntime, ProxyBridge } from './types';

export function buildProxyBridge(
  id: string,
  info: BridgeInfo,
  settings: SettingDescriptor[],
  methods: string[],
  native: NativeBridgeRuntime,
): ProxyBridge {
  const bridge: ProxyBridge = {
    info,
    getSettings: () => settings,
  };
  for (const method of methods) {
    bridge[method] = async (...args: unknown[]): Promise<unknown> => {
      const raw = await native.callBridge(id, method, JSON.stringify(args));
      return raw === undefined || raw === '' ? undefined : (JSON.parse(raw) as unknown);
    };
  }
  return bridge;
}
