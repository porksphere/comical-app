# comical-runtime — setup & wiring

The local Expo module that runs Comical bridges on-device (JSC/QuickJS), wrapping the shared
`ComicalBridgeContext` from the `comical` repo. **The module source is committed, but the build
wiring below is not yet applied** — it depends on the `comical` repo being published (its history
must first be rewritten from `@tcolb` → `@porksphere`) and added here as a git submodule. Until then
the app resolves `requireOptionalNativeModule('ComicalRuntime')` to `null` and stays on the remote
transport, so nothing here breaks the current build.

## Prerequisites
1. Publish `comical` to a git remote (e.g. `github.com/porksphere/comical`), authored entirely as
   `porksphere`. It must include the `host-server` Node-free router + `BridgeProvider` changes and
   the `host-android`/`host-ios` `callJson`/`describeJson` additions.

## 1. Add the submodule (at the comical-app repo root)
```sh
git submodule add <comical-remote-url> external/comical
git -c protocol.file.allow=always submodule update --init --recursive
```
The gradle `sourceSets` (android/build.gradle) and the podspec (ios/ComicalRuntime.podspec) reference
`external/comical/packages/host-android` and `.../host-ios` by relative path — adjust those paths if
you place the submodule elsewhere.

## 2. Generate the native harness bundles (gitignored in comical)
`ComicalBridgeContext` loads `comical_harness.js` (Android) / `harness.js` (iOS), which are generated
from `@comical/host-native`:
```sh
cd external/comical && bun install && bun run build:native
```
Do this in CI before `expo prebuild`/gradle/xcodebuild (add a step to the build workflows).

## 3. Make the JS comical packages real dependencies (for the embedded transport)
The embedded transport reuses `@comical/host-server`'s `createRouter` and `@comical/registry`'s
fetcher. Add them (and `@comical/core`/`@comical/contract`/`@comical/library`) as `file:` deps so
Metro bundles them from the submodule, then `bun install`:
```jsonc
// apps/mobile/package.json (dependencies)
"@comical/host-server": "file:../../external/comical/packages/host-server",
"@comical/registry":    "file:../../external/comical/packages/registry",
"@comical/core":        "file:../../external/comical/packages/core",
"@comical/library":     "file:../../external/comical/packages/library",
"@comical/contract":    "file:../../external/comical/packages/contract"
```
Then drop the type-only `@comical/*` `paths` from `apps/mobile/tsconfig.json` (real resolution takes
over). `hono`/`zod` come in transitively.

## 4. Wire the runtime at app startup (native entry only)
Where the app boots (e.g. `src/app/_layout.tsx`), inject the built packages into the embedded
runtime and apply the persisted preference:
```ts
// Import the Node-free subpaths ONLY — the package barrels pull node:fs / Bun.serve and won't bundle
// under Metro/Hermes. (host-server "./router", registry "./fetcher" were added for exactly this.)
import { createRouter } from '@comical/host-server/router';
import { fetchIndex, downloadBundle } from '@comical/registry/fetcher';
import { configureEmbeddedRuntime, applyEmbeddedMode, getResolvedModeSync } from '@/data/embedded';

configureEmbeddedRuntime({
  createRouter,
  fetcher: { fetchIndex, downloadBundle },
  indexUrl: '<registry index.json URL>',
});
applyEmbeddedMode(getResolvedModeSync() === 'embedded');
```
(Web builds skip this — `requireOptionalNativeModule` is null there, so `applyEmbeddedMode` no-ops.)

## 5. CI: check out submodules
Add to each native build workflow's `actions/checkout@v4` step:
```yaml
with:
  submodules: recursive
```
and the `bun run build:native` step from §2. ⚠️ Until §1–§3 are done, the `build-android` /
`build-ios` lanes will fail on `apps/**` pushes (the module references a missing submodule) — don't
push to `main` until wired, or gate the module behind a prebuild flag.

## Follow-ups
- `describeJson()` returns `{ info, methods }` so the proxy exposes exactly the implemented methods;
  the JS falls back to capability-derived methods if `methods` is absent.
- An `expo-file-system`-backed `BundleCache` (currently `MemoryBundleCache`) for persistent bundle
  caching.
- On-device `crypto.subtle` polyfill (e.g. `react-native-quick-crypto`) so `@comical/registry`'s
  `verify.ts` SHA-256/Ed25519 runs during bundle download.
- iOS `ComicalBridgeContext` doesn't yet thread `networkJson` through its init (Android does).
