# comical-runtime — setup & status

The local Expo module that runs Comical bridges **and trackers** on-device (JSC/QuickJS),
wrapping the shared `ComicalBridgeContext`/`ComicalTrackerContext` from the `comical` repo.
**The wiring is now in place** — the `comical` submodule is at `external/comical`, Metro resolves
`@comical/*` from it, `_layout.tsx` calls `startEmbeddedRuntime()`, and CI checks out submodules +
generates the harness. Until the native module is actually compiled into a dev/CI build,
`requireOptionalNativeModule('ComicalRuntime')` resolves to `null` and the app stays on the remote
transport (so JS-only lanes are unaffected).

## Trackers (AniList/MAL) — registry-installed, exactly like bridges

`ComicalRuntimeModule.swift`/`.kt` implement `initTracker`/`callTracker`/`disposeTracker`/
`drainTrackerSettingsPatch` alongside the bridge functions, keyed per-id; the underlying
`ComicalTrackerContext.swift`/`.kt` (in `comical`'s `host-ios`/`host-android`) mirror
`ComicalBridgeContext` and share the same harness (`comical_init_tracker`/`comical_call_tracker`/
`comical_drain_tracker_patch`, installed unconditionally alongside the bridge pair by
`host-native`'s `installComicalHarness()` — one harness, not a second bundle). No podspec/gradle
changes were needed: both already glob/compile the whole host-ios/host-android source tree.

**Trackers are not app-bundled — they're browsed and installed from a registry on-device, the same
flow as bridges.** `EmbeddedRegistryProvider`'s `browseTrackers`/`installTracker`/`updateTracker`/
`uninstallTracker`/`checkTrackerUpdates` mirror the bridge methods 1:1, including update-checking
and the same-version-hash-drift self-heal. `ManifestTrackerBundleSource` resolves a pinned tracker's
bundle from `installedTrackerStore` (`src/data/embedded/stores.ts`) + the registry fetcher,
verifying and caching it exactly like a bridge bundle (`BundleCache`, sha256). There's no
generated/committed bundle file and no separate CI build step for trackers — a fresh install has
zero trackers until the user adds a registry (e.g. `comical-trackers`) and installs one from Browse
Registry, same as bridges.

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
