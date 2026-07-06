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
- **tsc** types: `@comical/host-rn` + the Node-free `@comical/*` subpaths (`host-server/router`,
  `host-server/bridge-provider`, `core/loader`, `registry/{schema,fetcher}`) resolve to submodule
  source via `tsconfig.json` `paths` — no ambient decls (the app compiles the real types).
- **Startup**: `src/data/embedded/startup.ts` (native) injects `createRouter` + the registry fetcher
  into `@comical/host-rn`'s `configureEmbeddedRuntime` and applies the persisted preference;
  `startup.web.ts` is a no-op. The registry index URL is **not** hardcoded — set
  `EXPO_PUBLIC_COMICAL_REGISTRY` in a gitignored `.env.local` (with no registry, the app stays remote).
- **CI**: `build-android/ios` reusable workflows check out `submodules: recursive` and run
  `bun install && bun run build:native` in `external/comical` (the harness bundles are gitignored).
- **Native wrappers**: `android/` (Kotlin, compiles host-android + `comical_harness.js` via
  sourceSets) and `ios/` (podspec compiling ComicalHostIOS + `harness.js`).

## To build & verify (Android, local emulator — the fast loop)
```sh
bun run setup                # from repo root: submodule + deps + build:native (see setup.ts)
cd apps/mobile && bun run run:android   # expo run:android = prebuild + gradle + install
```
`bun run setup` (repo-root `setup.ts`) does, in order: `git submodule update --init --recursive`
→ `bun install` → `bun install --linker hoisted` in `external/comical` (hoisted so Metro resolves
hono/zod/cheerio — bun's default per-package layout hides them) → `bun run build:native` (generates
`comical_harness.js`). The harness is an **APK asset baked in at build time**: if you regenerate it
later, rebuild + reinstall the APK — a Metro reload won't pick it up. To do the steps by hand:
```sh
git submodule update --init --recursive
(cd external/comical && bun install --linker hoisted && bun run build:native)
cd apps/mobile && bun install
```
⚠️ Use `run:android` (`expo run:android`), NOT `android` (`expo start --android`). The latter only
starts Metro against Expo Go, which can't contain a custom native module — so `ComicalRuntime` is
absent, the "Run bridges on this device" setting is hidden, and the app stays on the (possibly
unreachable) remote server. `run:android` compiles a dev build that includes the module.
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
