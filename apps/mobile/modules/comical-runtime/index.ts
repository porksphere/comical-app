/**
 * `comical-runtime` — the local Expo native module that runs Comical bridge bundles on-device
 * (JavaScriptCore on iOS, QuickJS on Android), wrapping the shared `ComicalBridgeContext` from the
 * `comical` repo's `@comical/host-ios` / `@comical/host-android` packages. It implements the
 * `NativeBridgeRuntime` JSON-in/JSON-out contract defined canonically in `@comical/host-rn`.
 *
 * `startup.ts` resolves this module and registers it via `setNativeBridgeRuntime`; the default export
 * is null when the module isn't linked (web, or before a native build), so the app falls back to the
 * remote transport.
 *
 * See `SETUP.md` for the submodule + build wiring this depends on.
 */
import type { NativeBridgeRuntime } from '@comical/host-rn';
import { requireOptionalNativeModule } from 'expo';

/** The native module, or null when it isn't linked (web / not-yet-built). */
export default requireOptionalNativeModule<NativeBridgeRuntime>('ComicalRuntime');
