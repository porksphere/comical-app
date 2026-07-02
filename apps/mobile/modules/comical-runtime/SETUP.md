# comical-runtime — setup & status

The local Expo module that runs Comical bridges on-device (JSC/QuickJS), wrapping the shared
`ComicalBridgeContext` from the `comical` repo. **The wiring is now in place** — the `comical`
submodule is at `external/comical`, Metro resolves `@comical/*` from it, `_layout.tsx` calls
`startEmbeddedRuntime()`, and CI checks out submodules + generates the harness. Until the native
module is actually compiled into a dev/CI build, `requireOptionalNativeModule('ComicalRuntime')`
resolves to `null` and the app stays on the remote transport (so JS-only lanes are unaffected).

## What's wired (done)
- **Submodule**: `external/comical` (pinned) — `git submodule update --init --recursive` after clone.
- **Metro** (`metro.config.js`): `@comical/*` → submodule packages via `extraNodeModules` +
  `unstable_enablePackageExports`; submodule `node_modules` (hono/zod) on `nodeModulesPaths`.
- **tsc** types: `@comical/contract`/`@comical/registry` paths → submodule; `@comical/host-server/router`
  + `@comical/registry/fetcher` via ambient decls in `apps/mobile/types/comical-embedded.d.ts`.
- **Startup**: `src/data/embedded/startup.ts` (native) injects `createRouter` + the registry fetcher
  into `configureEmbeddedRuntime` and applies the persisted preference; `startup.web.ts` is a no-op.
  Registry index defaults to `bridges-repo` (override `EXPO_PUBLIC_COMICAL_REGISTRY`).
- **CI**: `build-android/ios` reusable workflows check out `submodules: recursive` and run
  `bun install && bun run build:native` in `external/comical` (the harness bundles are gitignored).
- **Native wrappers**: `android/` (Kotlin, compiles host-android + `comical_harness.js` via
  sourceSets) and `ios/` (podspec compiling ComicalHostIOS + `harness.js`).

## To build & verify (Android, local emulator — the fast loop)
```sh
git submodule update --init --recursive          # ensure external/comical is present
(cd external/comical && bun install && bun run build:native)   # generate comical_harness.js
cd apps/mobile && bun install
bun run android                                  # expo prebuild + gradle + install on the emulator
```
Then in the app: Settings → "Run bridges on this device" → browse/search/read with no server; toggle
off to confirm remote still works. (iOS needs macOS/Xcode; CI covers it.)

## Known device follow-ups (needed for the registry path to work end-to-end)
- **`crypto.subtle` polyfill** — `@comical/registry`'s `verify.ts` uses WebCrypto (SHA-256 + Ed25519)
  to verify downloaded bundles; Hermes has no `crypto.subtle`. Add e.g. `react-native-quick-crypto`
  (and install its global shim before `startEmbeddedRuntime()`), or bundle bridges as assets instead.
- **`expo-file-system` `BundleCache`** — currently `MemoryBundleCache` (bundles re-download each
  launch). Add a persistent adapter (implements `BundleCache`, pass via `configureEmbeddedRuntime`).
- **Gradle/podspec relative paths** to `external/comical` are best-effort — adjust if a build can't
  find the host sources/harness.
- **iOS `networkJson`** isn't threaded through `ComicalBridgeContext.init` yet (Android is).
- `describeJson()` returns `{ info, methods }`, so the proxy exposes exactly the implemented methods
  (the JS falls back to capability-derived methods if `methods` is absent).
