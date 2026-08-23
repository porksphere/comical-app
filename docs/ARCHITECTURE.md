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
│       ├── src/app/            # screens (Browse/Library/History/Activity/Settings + the series page)
│       ├── src/data/           # data layer: api.ts (transport seam), source.ts, embedded/ (on-device wiring)
│       ├── modules/comical-runtime/  # local Expo native module wrapping comical's ComicalBridgeContext
│       ├── app.json            # Expo config (bundleId: com.porksphere.comical)
│       └── eas.json            # build profiles (optional `eas build --local` path)
├── external/comical/           # git SUBMODULE — the Comical runtime (@comical/*), source of on-device bridges
└── .github/workflows/          # Android + iOS + web build pipelines
```

## Why React Native + Expo

The business-logic core is **TypeScript**, so it runs directly in the RN JS runtime with
no native bridge — the single biggest reason RN wins here over native (SwiftUI + Compose)
or Flutter, which would force re-implementing or wrapping the core twice. Native-stack gives
native headers/large titles. The bottom tab bar itself
(`src/components/app-tabs.tsx`) is a custom-rendered component rather than `expo-router`'s
`NativeTabs` — that was tried (including iOS 26's `tabBarMinimizeBehavior`) and reverted; see
git history / `AGENTS.md` for why.

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

## State management

Two layers, split by what the state *is* — not by screen. **Reach for the layer that owns the
kind of state you have; don't hand-roll a third one.**

| Layer | Owns | Lives in |
| --- | --- | --- |
| **TanStack Query** (`@tanstack/react-query`) | **Server / async state** — anything fetched through `useDataSource()`: series detail, chapter lists, pages, home/browse grids, library, favorites, search. The cache, background refetch, retries, and cross-navigation reuse. | `src/data/query-client.ts` (client + AsyncStorage persistence), `src/data/queries.ts` (`queryKeys` factory + query/mutation options) |
| **Legend State** (`@legendapp/state`) | **Local / client state** — device-local preferences and UI state that is *not* a copy of anything on the server: reader settings, the on-device-runtime toggle, NSFW visibility, mock-data toggle, the data-invalidation epoch, the remembered scanlation group. | `src/lib/observable.ts` (shared `persisted$` helper) + one small module per store |

These are complementary, not competing. TanStack Query is the async cache the web client hand-rolled
in `client/app.ts`, ported; **it should never be used for local preferences**, and Legend State should
**never** mirror server data — that's what re-fetching through Query is for. (Legend State ships a
TanStack Query sync plugin; we deliberately don't use it — the server cache already has one owner.)

**Why Legend State for the local half.** Every preference/UI store used to hand-roll the same
`useSyncExternalStore` boilerplate: a module variable, a `Set` of listeners, `notify` / `subscribe`,
`getSnapshot` / `getServerSnapshot`, a one-shot `AsyncStorage` read to hydrate, and a write-through on
every setter. Legend State collapses that to an `observable()` read with `use$()`, and — for the
persisted ones — declarative AsyncStorage persistence via the shared `persisted$()` helper, which also
carries the runway to swap AsyncStorage for **MMKV** (synchronous, flicker-free hydration) by changing
one line. Fine-grained reactivity means a component re-renders only for the field it reads.

Most persisted stores keep their original AsyncStorage keys, so existing on-device preferences carry
over. Two stores whose old format was a *bare* string (not JSON, which Legend State can't parse) moved
to a fresh JSON key and adopt any legacy value once via `migrateLegacyKey` (see `lib/observable.ts`):
the NSFW durable mode (`src/data/nsfw.ts`, `'on'`/`'off'` → `comical:nsfwDurable`) and the server URL
override (`src/data/api.ts` → `comical:remoteServer`). NSFW is a two-observable store — a persisted
durable off/on plus a live, in-memory mode that carries the session-only `until-background` /
`until-restart` overrides on top of it. The server-URL store owns only the value; clearing the query
cache on a server switch stays with the caller (`settings.tsx`), keeping the local preference and the
TanStack Query cache separated.

The dev-only mock-data toggle (`source.ts`) is also a Legend State observable: it keeps its
`'1'`/`'0'` key (those parse back as truthy/falsy), applies the `__DEV__` mask at read so a non-dev
build always reports off, and drives the mock module's `syncMockActive()` side effect from a
module-level `onChange` (plus one call at load, so a demo build is mock-active before hydration).

Every preference/UI store is now on Legend State. The only module-level stores intentionally left
hand-rolled are `lib/tab-bar-visibility.ts` (a per-frame scroll value driven on the reanimated UI
thread) and `lib/diagnostics.ts` (its own ring buffer) — neither is a preference, and both have
reasons not to go through the observable path.

## Web vs. native chrome

Web uses a top nav bar instead of the native Liquid Glass tab bar (see the `.web.tsx` splits in
the codebase); the screens are shared, only the nav chrome adapts. The web bundle uses the same
`app-tabs.tsx` bar as native (responsive: bottom bar on narrow viewports, a top-right icon row on
wide ones). `experiments.baseUrl` (`/comical-app`, for GitHub Pages) applies to the static export
but not the local dev server, which serves at the root.
