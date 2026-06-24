# comical

Cross-platform (iOS + Android) mobile app built with **React Native + Expo (SDK 56)**,
using **native navigation** — a real `UITabBarController` (Liquid Glass on iOS 26) and a
native stack — plus a Liquid Glass surface demo. This repo is the app shell + build
system; the business-logic core lives in a separate repo (see below).

## Layout

```
comical/
├── apps/
│   └── mobile/                 # Expo app (expo-router, New Architecture)
│       ├── src/app/
│       │   ├── _layout.tsx     # root native Stack
│       │   ├── (tabs)/         # native tab bar group (index, explore)
│       │   └── detail.tsx      # pushed native-stack screen + GlassView demo
│       ├── app.json            # Expo config (bundleId: com.porksphere.comical)
│       └── eas.json            # build profiles (optional `eas build --local` path)
├── packages/
│   └── core/                   # LOCAL STUB of @porksphere/core (temporary)
├── .npmrc                      # @porksphere scope -> GitHub Packages
└── .github/workflows/          # Android + iOS build pipelines
```

## Why React Native + Expo

The business-logic core is **TypeScript**, so it runs directly in the RN JS runtime with
no native bridge — the single biggest reason RN wins here over native (SwiftUI + Compose)
or Flutter, which would force re-implementing or wrapping the core twice. Native UI is
fully achievable: `expo-router`'s `NativeTabs` renders the real iOS tab controller (Liquid
Glass on iOS 26), native-stack gives native headers/large titles, and `expo-glass-effect`
covers bespoke glass surfaces (auto-fallback to opaque views on Android / iOS < 26).

## The business-logic core (`@porksphere/core`)

The real core is a **separate repository** published to **GitHub Packages**. Until its
first release, a local workspace stub at `packages/core` resolves the dependency so the
import path, Metro resolution, and CI auth are exercised end-to-end.

- **CI / reproducible builds:** `npm ci` resolves `@porksphere/core` (from the stub today,
  from GitHub Packages once published). `.npmrc` maps the `@porksphere` scope to
  `npm.pkg.github.com`; set `NODE_AUTH_TOKEN` to a token with `read:packages`.
- **Editing core + app together:** clone the core repo and `npm link` it; `metro.config.js`
  already watches the monorepo root and extra `nodeModulesPaths`, so Metro picks up the
  linked source and hot-reloads core edits.
- **Cut-over:** when the published core exists, delete `packages/core`, drop it from the
  root `workspaces`, and pin the version in `apps/mobile/package.json`.

## Develop

```bash
npm install            # install all workspaces
npm run start          # expo start (apps/mobile)
npm run ios            # or: npm run android
npm run typecheck      # tsc across app + core
```

## Build (GitHub-hosted runners, local builds — no Expo cloud)

Native projects are generated on the fly (`expo prebuild`, CNG); `ios/` and `android/` are
git-ignored. Two workflows in `.github/workflows/` run on push to the dev branch / `main`
and via manual dispatch:

- **Android** (`ubuntu-latest`): `expo prebuild` → `gradlew assembleRelease` → installable
  `.apk` artifact (release is signed with the auto-generated debug keystore).
- **iOS** (`macos-26`): `expo prebuild` → `pod install` → `xcodebuild archive` with code
  signing disabled → packaged into an **unsigned `.ipa`** artifact.

### iOS distribution via SideStore

There is **no paid Apple Developer account** in this setup. CI emits an *unsigned* `.ipa`;
**SideStore** re-signs it on-device with your free Apple ID (7-day refresh, handled by
SideStore). Download the `comical-ios-unsigned-ipa` artifact and sideload it. Constraint:
avoid entitlements a free Apple ID can't grant (push, certain App Groups) for now. A future
TestFlight/App Store path can be added as an extra `eas.json` profile + signed CI job
without reworking the pipeline.
