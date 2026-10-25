/**
 * `comical-runtime` — the local Expo native module that runs Comical bridge (and tracker) bundles
 * on-device (JavaScriptCore on iOS, QuickJS on Android), wrapping the shared `ComicalBridgeContext`
 * / `ComicalTrackerContext` from the `comical` repo's `@comical/host-ios` / `@comical/host-android`
 * packages. It implements both the `NativeBridgeRuntime` and `NativeTrackerRuntime` JSON-in/JSON-out
 * contracts defined canonically in `@comical/host-rn`, as one native module with both function sets.
 *
 * `startup.ts` resolves this module and registers it via `setNativeBridgeRuntime` /
 * `setNativeTrackerRuntime`; the default export is null when the module isn't linked (web, or before
 * a native build), so the app falls back to the remote transport for both.
 *
 * See `SETUP.md` for the submodule + build wiring this depends on.
 */
import type { NativeBridgeRuntime, NativeTrackerRuntime } from '@comical/host-rn';
import { requireOptionalNativeModule } from 'expo';

/**
 * App-local filesystem helpers on the same module — not part of the `@comical/host-rn` contracts.
 * `directorySize` exists because expo-file-system can only size a directory synchronously, on the JS
 * thread; this is the same recursive walk on a native background thread.
 */
interface ComicalRuntimeFs {
  /** Logical bytes of every file under the `file://` directory URI, recursively; 0 for a missing path. */
  directorySize(uri: string): Promise<number>;
}

const comicalRuntime = requireOptionalNativeModule<NativeBridgeRuntime & NativeTrackerRuntime & ComicalRuntimeFs>(
  'ComicalRuntime',
);

/** The native module, or null when it isn't linked (web / not-yet-built). */
export default comicalRuntime;

/** Recursive on-disk size of a directory, measured off the JS thread. 0 where the module isn't linked (web). */
export function directorySize(uri: string): Promise<number> {
  return comicalRuntime ? comicalRuntime.directorySize(uri) : Promise.resolve(0);
}
