/**
 * `comical-runtime` — the local Expo native module that runs Comical bridge bundles on-device
 * (JavaScriptCore on iOS, QuickJS on Android), wrapping the shared `ComicalBridgeContext` from the
 * `comical` repo's `@comical/host-ios` / `@comical/host-android` packages. It exposes the JSON-in/
 * JSON-out surface the app's embedded runtime expects (see `src/data/embedded/types.ts`
 * `NativeBridgeRuntime`).
 *
 * The app's `src/data/embedded/native-runtime.ts` resolves this module by name
 * (`requireOptionalNativeModule('ComicalRuntime')`) so it tolerates the module being absent (web, or
 * before a native build) and falls back to the remote transport. This entry is the conventional
 * module handle and a place for the typed contract.
 *
 * See `SETUP.md` for the submodule + build wiring this depends on.
 */
import { requireOptionalNativeModule } from 'expo';

export interface ComicalRuntimeNativeModule {
  /** Load a bundle into a fresh native engine context; resolves to `{ info, methods }` JSON. */
  initBridge(id: string, code: string, settingsJson: string, networkJson?: string): Promise<string>;
  /** Invoke a bridge method; args + result cross the boundary as JSON strings. */
  callBridge(id: string, method: string, argsJson: string): Promise<string>;
  /** Tear down a bridge's native context. */
  disposeBridge(id: string): void;
}

/** The native module, or null when it isn't linked (web / not-yet-built). */
export default requireOptionalNativeModule<ComicalRuntimeNativeModule>('ComicalRuntime');
