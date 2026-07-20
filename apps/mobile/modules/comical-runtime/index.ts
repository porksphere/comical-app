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

/** The native module, or null when it isn't linked (web / not-yet-built). */
export default requireOptionalNativeModule<NativeBridgeRuntime & NativeTrackerRuntime>('ComicalRuntime');
