# Development

Building Comical from source, running it locally, and the CI/release pipeline. For the
architecture (on-device runtime, bridges, why RN), see [ARCHITECTURE.md](ARCHITECTURE.md).

Bun is the package manager. Node is still used under the hood — Metro and the native build
phases (Gradle/Xcode "bundle React Native code") shell out to `node`.

## First-time setup — one command

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

## Build (GitHub-hosted runners, local builds — no Expo cloud)

Native projects are generated on the fly (`expo prebuild`, CNG); `ios/` and `android/` are
git-ignored. Workflows in `.github/workflows/` run on push to `main` and via manual dispatch:

- **Android** (`ubuntu-latest`): `expo prebuild` → `gradlew assembleRelease` → installable
  `.apk` artifact (release is signed with the auto-generated debug keystore). `build-android.yml`
  refreshes the rolling **`android-latest`** Release so the APK has a stable, public,
  unauthenticated direct-download URL.
- **iOS** (`macos-26`): `expo prebuild` → `pod install` → `xcodebuild archive` with code
  signing disabled → packaged into an **unsigned `.ipa`** artifact, published to the rolling
  **`ios-latest`** Release.
- **Versioned releases:** pushing a `v*` tag runs `release.yml`, which builds both binaries and
  attaches them to an immutable `vX.Y.Z` Release. This does not disturb the rolling channels
  (SideStore/AltStore keep tracking `ios-latest`).

### Web (same codebase, react-native-web)

The Expo app also targets web via react-native-web (`build:web` = `expo export --platform web`,
static output to `dist/`). `deploy-web.yml` builds it and publishes to **GitHub Pages** on each
push, giving a public URL you can open on a phone — no computer in the loop:

> **https://porksphere.github.io/comical-app/**

`experiments.baseUrl` in `app.json` sets the `/comical-app` Pages subpath. One-time setup:
**Settings → Pages → Source: Deploy from a branch → `gh-pages` / `root`** (the workflow
publishes the static export to the `gh-pages` branch via `peaceiris/actions-gh-pages`).

The public Pages build runs in demo mode (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1`, set only in
`deploy-web.yml`) since static hosting has no backend to reach — see `components/demo-banner.tsx`.

## iOS distribution via SideStore

There is **no paid Apple Developer account** in this setup. CI emits an *unsigned* `.ipa`;
**SideStore** re-signs it on-device with your free Apple ID (7-day refresh, handled by
SideStore).

The iOS build publishes to a rolling **`ios-latest` GitHub Release**, which gives a stable,
public, **direct-download** URL — the only thing SideStore/AltStore can actually fetch. (Do
**not** point a sideloader at the `comical-ios-unsigned-ipa` *Actions artifact*: artifact
downloads require a logged-in GitHub session, so an unauthenticated fetch returns an HTML
login page, which the sideloader reports as `Encountered unknown tag html on line 1` /
`isn't in the correct format`. Artifacts are also double-zipped.)

See the [README](../README.md#-ios) for the end-user install links (source URL + direct IPA).

Constraint: avoid entitlements a free Apple ID can't grant (push, certain App Groups) for
now. A future TestFlight/App Store path can be added as an extra `eas.json` profile + signed
CI job without reworking the pipeline.
