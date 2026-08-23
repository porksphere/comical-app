# Development

Building Comical from source, running it locally, and the CI/release pipeline. For the
architecture (on-device runtime, bridges, why RN), see [ARCHITECTURE.md](ARCHITECTURE.md); for
finding performance bottlenecks on-device, see [PROFILING.md](PROFILING.md).

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
bun run dev:device     # Metro for a native device (dev-client) — iterate on a phone from any OS
bun start              # expo start (apps/mobile) — dev menu for iOS/Android/web
bun run ios            # or: bun run android
bun run typecheck      # tsc across app + core
```

`bun run dev:device` is the **Windows-friendly native loop**: it starts Metro bound to your LAN IP
and prints a QR. Install the **dev-client** shell once (below), open it on a phone on the same Wi-Fi,
connect to this server, and every JS/TS edit hot-reloads on-device — no Mac needed for JS work. Full
story (incl. profiling over it): [PROFILING.md](PROFILING.md) → "Iterative dev & profiling from Windows".

Both of those need Metro running on a machine you own. For the same on-device loop with **no PC in
it** — an always-on box that follows whichever open PR was pushed to most recently and serves it to
your phone over Tailscale, so a Claude session can iterate on the app you are holding — see
[infra/dev-server/README.md](../infra/dev-server/README.md).

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

## Testing

`bun run typecheck` and CI's `lint:testids` gate (every interactive element needs a `testID`) run
on every push. Beyond that, **new user-facing screens/flows need a Maestro e2e flow** —
`apps/mobile/e2e/` has the full authoring/running workflow (writing a flow, verifying it locally
against a dev-client or a static web export, the mobile/web selector quirks). CI's
`check:flow-coverage` job nudges (advisory-only, never fails the job) when a new tab/screen/Settings
category has no flow referencing it yet — see `apps/mobile/e2e/README.md`.

## Build (GitHub-hosted runners, local builds — no Expo cloud)

Native projects are generated on the fly (`expo prebuild`, CNG); `ios/` and `android/` are
git-ignored. Workflows in `.github/workflows/` run on push to `main`, on every **pull request**
(build + downloadable artifact, so branches are verified — see the dev channel below), and via
manual dispatch. Caches keep repeat builds fast: iOS caches Bun + CocoaPods + **ccache** (native
compile), Android caches Bun + the **Gradle** cache. Only `main` *writes* those caches; every
branch/PR restores them read-only, so the shared 10 GB Actions cache budget holds one
authoritative warm cache instead of being thrashed per branch. Two iOS-specific notes on the
native compile: RN core itself isn't compiled at all (prebuilt via
`ReactNativeDependencies.xcframework`/`React-Core-prebuilt`, default on RN 0.80+); and the
third-party pods that *do* compile go through **ccache** — but only because the "Route ccache"
step patches RN's `ccache-clang.sh` wrapper to hard-code the ccache path. RN's wrapper otherwise
relies on the `CCACHE_BINARY` build setting reaching the compile env, which Xcode 26 doesn't do
([RN #55381](https://github.com/facebook/react-native/issues/55381)), so without the patch ccache
silently never fires (0 hits/misses). With it, ~99.9% of compiles are cacheable:

- **Android** (`ubuntu-latest`): `expo prebuild` → `gradlew assembleRelease` → installable
  `.apk` artifact (release is signed with the auto-generated debug keystore). `build-android.yml`
  refreshes the rolling **`android-latest`** Release so the APK has a stable, public,
  unauthenticated direct-download URL — the testing lane, not the one the README links (see
  "Android distribution" below).
- **iOS** (`macos-26`): `expo prebuild` → `pod install` → `xcodebuild archive` with code
  signing disabled → packaged into an **unsigned `.ipa`** artifact. On push to main it's a
  **profiling** build published to the rolling **`ios-main`** Release; on a PR it's published to
  the aggregate **`ios-pr`** source (see "iOS distribution" below).
- **Versioned releases:** `release.yml` builds both binaries (iOS **clean** Release — no profiler),
  attaches them to an immutable `vX.Y.Z` Release, publishes the versioned web image, and refreshes
  the public **`ios-release`** source and **`android-release`** download link. Those are the
  channels normal users follow; the rolling `ios-main`/`ios-pr`/`android-latest` lanes are for
  dev/perf testing. See "Cutting a release" below.

### Cutting a release

Two dispatches with a PR in between — both runnable from GitHub Mobile, which is why neither step
requires creating a tag by hand:

1. **Actions → Prepare release → Run workflow**, picking `patch`, `minor` or `major`.
   `prepare-release.yml` raises `expo.version` and `expo.android.versionCode` together, generates
   the new `CHANGELOG.md` section from the commits since the last tag, and opens a `release: X.Y.Z`
   PR. To see that diff before dispatching anything, run the same script locally:
   `bash .github/scripts/prepare-release.sh patch && git diff`.
2. **Review and merge that PR.** It arrives with no check runs — GitHub doesn't start workflows for
   events raised by `GITHUB_TOKEN` — but the merge to main runs the full suite, and step 3
   re-validates the version before it builds anything.

   > **One-time setting:** step 1 can only open the PR if **Settings → Actions → General → Workflow
   > permissions → "Allow GitHub Actions to create and approve pull requests"** is enabled. With it
   > off, the workflow still bumps the version, writes the changelog and pushes `release/X.Y.Z` —
   > it just can't open the PR, and prints a one-click link to open it yourself instead.
3. **Actions → Release → Run workflow** (from `main`). `prep` reads the version out of `app.json`,
   refuses to re-cut a shipped one, and checks the `versionCode` moved past the previous tag's;
   then both binaries build, and the `vX.Y.Z` tag is created **at the end**, by the release step,
   so a failed build never leaves a dangling tag or a tag without its binaries.

Pushing a `v*` tag by hand still works and skips step 1–2, but `app.json` must already agree with
the tag. Do **not** use the web Releases form to create the tag: it creates the Release object too,
and `gh release create` then fails — after both builds have run.

Release notes are GitHub's generated commit list appended to the install instructions
(`--generate-notes`), and `CHANGELOG.md` carries the same history in-repo.

**Version strings.** `expo.version` in `app.json` is a *base* that only moves on a release.
Everything else derives from it in `.github/scripts/compute-build-version.sh`: a release build
carries the bare `X.Y.Z`, and every rolling build carries `X.Y.Z.<Nth build of this release
series>`, counting commits since the bump. The counter restarting each series is safe because the
base outranks it — `0.2.0.1` still beats `0.1.1.4287`. All five lanes stamp the computed string
into the artifact *and* bake it into the JS bundle as `EXPO_PUBLIC_COMICAL_APP_VERSION`, which is
what the About screen shows; `Constants.expoConfig.version` would only ever report the bare base.
iOS additionally gets `CFBundleVersion` set to the total commit count — the one number that never
resets, which is what the OS orders two builds of the same version by.

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

The *real*, backend-connected web build ships as a container image,
`ghcr.io/porksphere/comical-app-web`, built by `publish-web-image.yml`: `:latest` and `:sha-<short>`
on every push to main, plus `:X.Y.Z` and `:X.Y` when `release.yml` calls it as part of cutting a
release. It's **called** rather than tag-triggered on purpose — a `push: tags: ['v*']` trigger
cannot fire for a tag that `gh release create` made, because GitHub doesn't start workflows for refs
created with `GITHUB_TOKEN`. That trigger silently published no versioned image at all between
v0.1.1 and the switch; the workflow header has the full story.

## iOS distribution via SideStore

There is **no paid Apple Developer account** in this setup. CI emits an *unsigned* `.ipa`;
**SideStore** re-signs it on-device with your free Apple ID (7-day refresh, handled by
SideStore).

Every channel publishes to a **GitHub Release**, which gives a stable, public, **direct-download**
URL — the only thing SideStore/AltStore can actually fetch. (Do **not** point a sideloader at the
`comical-ios-unsigned-ipa` *Actions artifact*: artifact downloads require a logged-in GitHub
session, so an unauthenticated fetch returns an HTML login page, which the sideloader reports as
`Encountered unknown tag html on line 1` / `isn't in the correct format`. Artifacts are also
double-zipped.)

### The four iOS channels (SideStore sources)

| Channel | Source URL (`…/releases/download/<tag>/apps.json`) | Trigger | Build | Bundle id |
|---------|-----------------------------------------------------|---------|-------|-----------|
| **release** (public) | `ios-release` | `v*` tag (`release.yml`) | clean Release, **no profiler** | `com.porksphere.comical` |
| **main** (perf testing) | `ios-main` | push to `main` (`build-ios.yml`) | **profiling** (Release + on-device Hermes profiler) | `com.porksphere.comical` |
| **PR** (branch testing) | `ios-pr` | each open PR (`build-ios.yml`) | **profiling** | `com.porksphere.comical` |
| **dev-client** (iterate over Metro) | `ios-devclient` | manual (`build-ios-devclient.yml`) | Debug + `expo-dev-client` | `com.porksphere.comical.dev` |

The first three share the **production bundle id**, so only one is installed at a time — switch
lanes by picking a source/version in SideStore (a `main`/`pr`/`release` build replaces whichever is
on the device). Only the dev-client uses a distinct `.dev` id and coexists. `main` and every PR are
**profiling** builds on purpose (the app is marked "Comical (profiling)"), so any of them can be
perf-tested on device without a special manual build; the clean **`ios-release`** channel carries no
profiler and is what a normal user subscribes to (see the [README](../README.md#-ios)).

### `ios-release` — the public channel (all tagged versions)

`release.yml` (on a `v*` tag) builds both binaries, attaches them to an immutable `vX.Y.Z` Release,
then refreshes the `ios-release` source. Because each `vX.Y.Z` Release is immutable and keeps its own
IPA forever, this source lists the **full version history** and every entry stays installable — the
build passes the tag (minus `v`) as the version override so the IPA's `CFBundleShortVersionString` and
the manifest agree (AltStore rejects a mismatch). Produced by
`.github/scripts/refresh-ios-release-source.sh`, which enumerates every `v*` Release, newest-first —
stateless, so deleting a bad release self-heals the source on the next tag.

### `ios-main` / `ios-pr` — the rolling dev channels

`ios-main` is a standalone source refreshed on every push to `main` (one rolling IPA). `ios-pr` is an
**aggregate** listing every open PR, so you add it **once** and every branch shows up inside it — no
adding a source per branch. Add either in SideStore/AltStore → Sources → +:

> `https://github.com/porksphere/comical-app/releases/download/ios-main/apps.json`
> `https://github.com/porksphere/comical-app/releases/download/ios-pr/apps.json`

The `ios-pr` app's version list is ordered **newest build first** (`PR #<N>: <title>`, sorted by
build/run number). SideStore/AltStore pick the installable "latest" by array order — not by comparing
version numbers — so whatever you built most recently is `versions[0]` and installs with one tap;
older builds sit below and are still selectable from SideStore's version list.

Both are **Release** builds (carrying the profiler) — installable on-device to eyeball a PR's UI or
capture a real release-mode Hermes trace, but with no Metro dev menu. (An offline "dev build" from CI
isn't practical: Expo intentionally skips embedding JS in debug builds; use the dev-client channel
below for a live-Metro loop, or a local `expo run:ios --device` build — see [PROFILING.md](PROFILING.md).)

How the PR aggregate is produced (see `.github/workflows/build-ios.yml` +
`.github/scripts/refresh-ios-pr-source.sh`):

- Each PR build publishes its IPA to an `ios-pr-<N>` **prerelease** (just the IPA + a small
  `meta.json`). `main` is **not** in this aggregate — it has its own `ios-main` source.
- A concurrency-locked `refresh-dev-source` job then regenerates `ios-pr/apps.json` from scratch by
  enumerating the `ios-pr-<N>` releases — stateless, so opening/closing PRs converge without races.
- Closing/merging a PR deletes its `ios-pr-<N>` release; the next refresh drops it from the list.

Android needs no equivalent — its per-PR `android-pr-<N>` prerelease already exposes a direct,
stable APK download URL (there's no "source" concept to aggregate).

## Android distribution — two channels, same split as iOS

Android has no source manifest to subscribe to, so each channel is just a Release whose APK sits at
a stable, public, unauthenticated URL. Both are refreshed by
`.github/scripts/publish-android-channel.sh`, but by different workflows, and a build only ever
checks for updates on the channel it was built on:

| Channel | Download URL (`…/releases/download/<tag>/comical-android.apk`) | Refreshed by | For |
| --- | --- | --- | --- |
| **`android-release`** | `android-release` | `release.yml` (a `vX.Y.Z` release) | normal users — this is the README's download button |
| **`android-latest`** | `android-latest` | `build-android.yml` (push to main) | testing unreleased work; the counterpart of `ios-main` |

They were **one** Release until they were split, and both lanes republished it. That meant a user on
a tagged release was told "update available" the first time any commit landed on main, and the
button handed them a main build — iOS had never had that problem, because `ios-release` and
`ios-main` are genuinely separate sources. It also meant the two lanes raced: they sit in different
concurrency groups (`android-*` vs `release-*`), so merging a release bump and then dispatching the
release had both delete-and-recreate the same Release at once, with a 404 window on the download URL
in between. Different tags, no race.

Each channel also carries a `version.json` (`{commit, version, publishedAt}`). The in-app update
check (`src/data/use-app-update.ts`) compares its `commit` against the running build's — equality,
not ordering, because `versionName` doesn't move between builds within a release series.

### Dev-client build — iterate on a device from any OS (incl. Windows)

Separate from the Release builds above: the **`Build iOS dev-client`** workflow
(`build-ios-devclient.yml`, manual `workflow_dispatch`) builds a Debug + `expo-dev-client` shell —
via the reusable workflow's `configuration: Debug` + `dev_client: true` inputs — and publishes it to
a rolling **`ios-devclient`** SideStore source. It carries the coexisting `com.porksphere.comical.dev`
bundle id (the env-gated `with-devclient-variant` plugin, active only when `COMICAL_DEVCLIENT=1`), so
it installs *alongside* the release app.

This is the shell for the Windows iterative loop: build it once on CI, install via the `ios-devclient`
source, then drive it from `bun run dev:device` (Metro over your LAN). Rebuild only when native code
changes. It's the sanctioned Expo development-build flow — the JS loads from Metro (online), which is
why it works where an offline debug build can't. Full walkthrough: [PROFILING.md](PROFILING.md) →
"Iterative dev & profiling from Windows".

Constraint: avoid entitlements a free Apple ID can't grant (push, certain App Groups) for
now. A future TestFlight/App Store path can be added as an extra `eas.json` profile + signed
CI job without reworking the pipeline.

## Crash monitoring & Sentry autofix

Crashes report to Sentry (org `comical`, project `comical-app`; SDK init in
`apps/mobile/src/lib/sentry.ts` / `_layout.tsx`). New **production** error-level issues (dev-client
and local-testing crashes are logged but exempt) automatically trigger a
Claude Code run that investigates the stack trace and opens a **draft fix PR**: Sentry webhook →
Cloudflare Worker relay → `repository_dispatch` → `sentry-autofix.yml`. Event-driven (no polling),
authenticated with a Claude subscription token. Setup, secrets, and tuning:
[infra/sentry-relay/README.md](../infra/sentry-relay/README.md).
