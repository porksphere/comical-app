/**
 * Resolves the on-device bridge engine — an Expo native module named "ComicalRuntime" that wraps
 * `ComicalBridgeContext` (JSC on iOS, QuickJS on Android). Absent on web and until the native module
 * is built, `requireOptionalNativeModule` returns null and the app stays on the remote transport.
 * A runtime can also be injected (`setNativeBridgeRuntime`) for tests or a JS fallback.
 */
import { requireOptionalNativeModule } from 'expo';
import type { NativeBridgeRuntime } from './types';

let override: NativeBridgeRuntime | null = null;
let resolved: NativeBridgeRuntime | null | undefined;

/** Inject a native runtime (tests, or a hypothetical JS-engine fallback). Pass null to clear. */
export function setNativeBridgeRuntime(rt: NativeBridgeRuntime | null): void {
  override = rt;
  resolved = undefined; // re-resolve on next access
}

export function getNativeBridgeRuntime(): NativeBridgeRuntime | null {
  if (override) return override;
  if (resolved === undefined) {
    resolved = requireOptionalNativeModule<NativeBridgeRuntime>('ComicalRuntime');
  }
  return resolved;
}

/** True when bridges can run on-device (native module present or a runtime was injected). */
export function isEmbeddedRuntimeAvailable(): boolean {
  return getNativeBridgeRuntime() !== null;
}
