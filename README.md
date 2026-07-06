# comical

Cross-platform (iOS + Android) mobile app built with **React Native + Expo (SDK 56)**,
using a native stack for navigation plus a custom-rendered bottom/top tab bar (same
component on every platform) and a Liquid Glass surface demo. On iOS/Android it runs the
Comical bridge runtime **on-device** (no server required); on web, and as a selectable
fallback, it talks to a remote `@comical/host-server`. See
[On-device runtime](#on-device-runtime-comicalhost-rn).

## Layout

```
comical/
├── apps/
│   └── mobile/                 # Expo app (expo-router, New Architecture)
│       ├── src/app/            # screens (Browse/Library/History/Activity/Settings + detail/reader)
│       ├── src/data/           # data layer: api.ts (transport seam), source.ts, embedded/ (on-device wiring)
│       ├── modules/comical-runtime/  # local Expo native module wrapping comical's ComicalBridgeContext
│       ├── app.json            # Expo config (bundleId: com.porksphere.comical)
│       └── eas.json            # build profiles (optional `eas build --local` path)
├── external/comical/           # git SUBMODULE — the Comical runtime (@comical/*), source of on-device bridges
├── packages/
│   └── core/                   # vestigial @porksphere/core demo stub (see On-device runtime)
└── .github/workflows/          # Android + iOS + web build pipelines
```

## Why React Native + Expo

The business-logic core is **TypeScript**, so it runs directly in the RN JS runtime with
no native bridge — the single biggest reason RN wins here over native (SwiftUI + Compose)
or Flutter, which would force re-implementing or wrapping the core twice. Native-stack gives
native headers/large titles, and `expo-glass-effect` covers bespoke glass surfaces
(auto-fallback to opaque views on Android / iOS < 26). The bottom tab bar itself
(`src/components/app-tabs.tsx`) is a custom-rendered component rather than `expo-router`'s
`NativeTabs` — that was tried (including iOS 26's `tabBarMinimizeBehavior`) and reverted; see
git history / `apps/mobile/AGENTS.md` for why.

## On-device runtime (`@comical/host-rn`)

On iOS/Android the app runs Comical **bridges on-device** — no external server. Every request
goes through a swappable transport in `src/data/api.ts`:

- **Embedded (native default):** drives the reused `@comical/host-server` router **in-process**
  (`router.fetch(...)`, no socket) against proxy bridges executed in a native JS engine —
  JavaScriptCore on iOS, QuickJS on Android. The reusable machinery lives in **`@comical/host-rn`**
  (the proxy `BridgeProvider`, the in-process transport, a registry-download `BundleSource`, and a
  Hermes WebCrypto shim); this app is a thin consumer — `src/data/embedded/` is just the wiring
  (`startup.ts`, `preference.ts`, `settings-store.ts`) plus the native module.
- **Remote:** a plain `fetch` against `EXPO_PUBLIC_COMICAL_SERVER`. Used on web, and selectable on
  native via the Settings toggle **"Run bridges on this device."**

The `@comical/*` packages come from the **`comical` git submodule** at `external/comical` —
`metro.config.js` (`extraNodeModules` + `unstable_enablePackageExports`) and `tsconfig.json`
(`paths`) map its Node-free subpaths to source, and `modules/comical-runtime` (a local Expo native
module) wraps comical's `ComicalBridgeContext`. Bridge bundles are downloaded, verified (SHA-256,
plus Ed25519 when signed), and cached from **user-managed registries** — add/remove registry
`index.json` URLs in **Settings → Bridge registries**. Nothing is hardcoded: published builds ship
with no registry (for local dev, seed one via a gitignored `.env.local`'s `EXPO_PUBLIC_COMICAL_REGISTRY`).

> `packages/core` (`@porksphere/core`) is a **vestigial demo stub** (`greet`) left from an earlier
> design where a separate core would ship via GitHub Packages. The real runtime is the `@comical/*`
> embedding above; the stub is only still imported by `detail.tsx`'s Liquid Glass demo.

**First-time setup — one command:**

```bash
bun run setup
```

`setup.ts` runs the full fresh-clone sequence, in order: checks out the `external/comical`
submodule → `bun install` (app + workspaces) → `bun install --linker hoisted` inside
`external/comical` (hoists its transitive deps — hono/zod/cheerio/@noble — to
`external/comical/node_modules`, the only place `metro.config.js` searches; bun's default
per-package layout leaves them unresolvable → "Unable to resolve module hono") → `bun run
build:native` (generates the QuickJS harness `comical_harness.js`, an APK asset the on-device
runtime loads; missing it fails every bridge with "FileNotFoundException: comical_harness.js").
Re-running is safe. After a native build you can iterate with `bun run android` / `bun run dev`.
See `apps/mobile/modules/comical-runtime/SETUP.md` for the full story.

## Develop

Bun is the package manager. Node is still used under the hood — Metro and the
native build phases (Gradle/Xcode "bundle React Native code") shell out to `node`.

```bash
bun run setup          # first-time / fresh clone: submodule + deps + native harness (see above)
bun install            # install all workspaces (subset of setup; web-only work)
bun run dev            # local web dev in a browser (hot reload) → http://localhost:8081
bun start              # expo start (apps/mobile) — dev menu for iOS/Android/web
bun run ios            # or: bun run android
bun run typecheck      # tsc across app + core
```

### Local web dev (`bun run dev`)

The fastest loop while iterating on shared screens: run the app in a desktop browser
via react-native-web, no simulator or device needed — the analogue of `comical-web`'s
local dev in the sibling workspace.

```bash
bun run dev            # → http://localhost:8081  (opens automatically, hot reload on)
```

`dev.ts` (this repo's root) frees the Metro/web port first, then runs `expo start --web`.
The port-free step matters on Windows: Metro re-parents a worker that keeps holding the
socket, so a stale server from a prior run otherwise makes `expo start` drop into an
interactive "use another port?" prompt. Ctrl-C tears everything down and sweeps the port.
Override the port with `PORT=8090 bun run dev`. First time only: `bun install`.

It also presets `EXPO_PUBLIC_COMICAL_SERVER` to the sibling `comical-web` dev server
(`http://<your-lan-ip>:3100`, detected automatically, no `/api` prefix — that only exists
behind the prod reverse proxy) so the app talks to a real local backend without any manual
export — start that server first with `cd ../comical-web && bun run dev`. The LAN IP (not
`localhost`) is used deliberately so a phone on the same network can load the printed
`http://<lan-ip>:8081` URL and reach the API too. Override the backend port with
`COMICAL_SERVER_PORT=...`, or set `EXPO_PUBLIC_COMICAL_SERVER` yourself to point elsewhere
(e.g. the deployed prod API, which does need `/api`).

> Web uses a top nav bar instead of the native Liquid Glass tab bar (see the `.web.tsx`
> splits below); the screens are shared, the nav chrome adapts. `experiments.baseUrl`
> (`/comical-app`, for GitHub Pages) does not apply to the local dev server — it serves
> at the root.

## Build (GitHub-hosted runners, local builds — no Expo cloud)

Native projects are generated on the fly (`expo prebuild`, CNG); `ios/` and `android/` are
git-ignored. Two workflows in `.github/workflows/` run on push to the dev branch / `main`
and via manual dispatch:

- **Android** (`ubuntu-latest`): `expo prebuild` → `gradlew assembleRelease` → installable
  `.apk` artifact (release is signed with the auto-generated debug keystore).
- **iOS** (`macos-26`): `expo prebuild` → `pod install` → `xcodebuild archive` with code
  signing disabled → packaged into an **unsigned `.ipa`** artifact.

### Web (same codebase, react-native-web)

The Expo app also targets web via react-native-web (`build:web` = `expo export --platform web`,
static output to `dist/`). `deploy-web.yml` builds it and publishes to **GitHub Pages** on each
push, giving a public URL you can open on a phone — no computer in the loop:

> **https://porksphere.github.io/comical-app/**

The web bundle uses the same `app-tabs.tsx` bar as native (responsive: bottom bar on narrow
viewports, a top-right icon row on wide ones) — the screens are shared, only the nav chrome's
layout adapts. `experiments.baseUrl` in `app.json` sets the `/comical-app` Pages subpath. One-time
setup:
**Settings → Pages → Source: Deploy from a branch → `gh-pages` / `root`** (the workflow
publishes the static export to the `gh-pages` branch via `peaceiris/actions-gh-pages`).

### iOS distribution via SideStore

There is **no paid Apple Developer account** in this setup. CI emits an *unsigned* `.ipa`;
**SideStore** re-signs it on-device with your free Apple ID (7-day refresh, handled by
SideStore).

The iOS build publishes to a rolling **`ios-latest` GitHub Release**, which gives a stable,
public, **direct-download** URL — the only thing SideStore/AltStore can actually fetch. (Do
**not** point a sideloader at the `comical-ios-unsigned-ipa` *Actions artifact*: artifact
downloads require a logged-in GitHub session, so an unauthenticated fetch returns an HTML
login page, which the sideloader reports as `Encountered unknown tag html on line 1` /
`isn't in the correct format`. Artifacts are also double-zipped.)

Two ways to install on-device:

- **Add as a source (recommended — gets update notifications):** in SideStore/AltStore →
  **Sources → +**, add
  `https://github.com/porksphere/comical-app/releases/download/ios-latest/apps.json`
- **Install the IPA directly:** open
  `https://github.com/porksphere/comical-app/releases/download/ios-latest/comical-unsigned.ipa`

Constraint: avoid entitlements a free Apple ID can't grant (push, certain App Groups) for
now. A future TestFlight/App Store path can be added as an extra `eas.json` profile + signed
CI job without reworking the pipeline.
