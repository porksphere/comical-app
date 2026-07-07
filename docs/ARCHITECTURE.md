# Architecture

Comical is a cross-platform (iOS + Android + web) comic reader built with **React Native +
Expo (SDK 56)**. It uses a native stack for navigation plus a custom-rendered bottom/top tab
bar (the same component on every platform) and a Liquid Glass surface demo. On iOS/Android it
runs the Comical bridge runtime **on-device** (no server required); on web — and as a
selectable fallback on native — it talks to a remote `@comical/host-server`.

## Repo layout

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

## Web vs. native chrome

Web uses a top nav bar instead of the native Liquid Glass tab bar (see the `.web.tsx` splits in
the codebase); the screens are shared, only the nav chrome adapts. The web bundle uses the same
`app-tabs.tsx` bar as native (responsive: bottom bar on narrow viewports, a top-right icon row on
wide ones). `experiments.baseUrl` (`/comical-app`, for GitHub Pages) applies to the static export
but not the local dev server, which serves at the root.
