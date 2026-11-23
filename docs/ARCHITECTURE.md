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
│   ├── mobile/                 # Expo app (expo-router, New Architecture)
│   │   ├── src/app/            # screens (Browse/Library/History/Activity/Settings + the series page)
│   │   ├── src/data/           # data layer: api.ts (transport seam), source.ts, embedded/ (on-device wiring)
│   │   ├── modules/comical-runtime/  # local Expo native module wrapping comical's ComicalBridgeContext
│   │   ├── targets/widgets/    # iOS home-screen widgets (a WidgetKit extension, Swift)
│   │   ├── modules/home-widgets/  # the widgets' feed writer, and the Android widgets (Glance)
│   │   ├── app.json            # Expo config (bundleId: com.porksphere.comical)
│   │   └── eas.json            # build profiles (optional `eas build --local` path)
│   └── desktop/                # Electron SPIKE (not shipped) — the web export + the host in-process
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

**Desktop (spike, not shipped).** `apps/desktop/` gets there a third way: Electron's main process
is a full Node, so it runs the real `@comical/host-server` in-process with `node:vm` as the bridge
evaluator — no JavaScriptCore or QuickJS harness, and `apps/mobile` unchanged, served as its own
web export.

The `@comical/*` packages come from the **`comical` git submodule** at `external/comical` —
`metro.config.js` (`extraNodeModules` + `unstable_enablePackageExports`) and `tsconfig.json`
(`paths`) map its Node-free subpaths to source, and `modules/comical-runtime` (a local Expo native
module) wraps comical's `ComicalBridgeContext`. Bridge bundles are downloaded, verified (SHA-256,
plus Ed25519 when signed), and cached from **user-managed registries** — add/remove registry
`index.json` URLs in **Settings → Bridge registries**. Nothing is hardcoded: published builds ship
with no registry (for local dev, seed one via a gitignored `.env.local`'s `EXPO_PUBLIC_COMICAL_REGISTRY`).

## Processed page images

Some sources serve page images that can't be shown as fetched: encrypted, or cut into pieces and
reassembled out of order. Comical handles them the way other sandboxed readers do — the bridge
holds the logic, the client the pixels — and the app's half is drawing.

**The split.** A bridge marks such a page `Page.process` and implements the processing hooks it
declares in `BridgeInfo.images.process`. The host's image route fetches the page, runs the bridge's
byte transforms (data, applied by core in plain JS), reads the decoded image's size, asks the bridge
for a layout — an output size and a list of draw operations, today only `copy` one rectangle to
another — checks it, and serves the decoded bytes with the layout in the `Comical-Page-Layout`
header (`encodePageLayout` / `decodePageLayout` in `@comical/contract`). The host never touches a
pixel; the bridge never sees one. Pixels in a bridge would mean decoding images in plain JS on
JavaScriptCore and QuickJS, which run without a JIT inside an app — seconds a page, and no decoder
at all for some formats sources serve.

**Drawn once, where it's decoded.** `resolveAssetSource` (`src/data/api.ts`) is where every page
the reader shows already turns into something `<Image>` can load. A response carrying a layout is
drawn there, once — Skia on device, a canvas on web (`src/data/draw-layout.ts`, `.web.ts`) — and
handed on as a `data:` URI, so every surface that shows the page (paged and webtoon readers, zoom,
the page curl's texture, spread fill, slicing, thumbnails) gets one ordinary bitmap. Drawing per
surface instead would mean teaching each of them to composite pieces, and several treat the page
as a single bitmap.

**The page says so in its URL.** Page lists are plain URI strings from the query layer to the
reader to downloads, so a processed page carries a `#comical-process` fragment (`markProcessed` in
`src/data/page-process.ts`), added where the page list is read (`source.ts`). It holds no data and
never reaches a server; it only tells the resolver to read the bytes itself under either transport,
and the synchronous `peekResolvedAssetSource` never to treat such a URL as already resolved. On the
embedded transport the image route's bytes pass through the resolver anyway, so a layout is drawn
there whether or not the URL is marked — which is what makes the device's downloader store pages
already drawn.

**Downloads.** A page downloaded on this device is stored drawn (the downloader resolves it like the
reader does), so offline it is an ordinary file. A server's download engine stores the decoded bytes
with the layout beside them and serves a downloaded page's file with the same header; its chapter
summary says `processed`, which is how the remote offline index knows to mark those pages. A layout
holding an operation this client doesn't know is shown as it came, never guessed at.


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

The mock-data toggle (`source.ts`) is also a Legend State observable: it keeps its
`'1'`/`'0'` key (those parse back as truthy/falsy), applies the `PROFILING_ENABLED` mask at read so
a release build always reports off, and drives the mock module's `syncMockActive()` side effect from a
module-level `onChange` (plus one call at load, so a demo build is mock-active before hydration).

Every preference/UI store is now on Legend State. The only module-level stores intentionally left
hand-rolled are `lib/tab-bar-visibility.ts` (a per-frame scroll value driven on the reanimated UI
thread) and `lib/diagnostics.ts` (its own ring buffer) — neither is a preference, and both have
reasons not to go through the observable path.

## Web checks

Some sources answer with an anti-bot check only a person can pass. The host's network layer
recognizes one and fails the call with a 403 carrying `challenge: { url, userAgent }`: the page to
open and the User-Agent the request sent. A site's clearance is tied to the User-Agent (and
network) that earned it, so **the check runs with the request's own User-Agent**; the app never
captures the web view's and imposes it on requests. The cookies the page leaves go to
`POST /bridges/:id/cookies` and into the bridge's cookie jar, which the host keeps and replays on
every later request and routed image. That's how the established readers do it: one cookie store,
detection in the network layer, done when a clearance cookie changes.

`data/web-check.ts` coordinates and knows no UI. `api.ts`'s transport hands it any 403 with a
challenge, it runs the platform's runner (one check per bridge and site at a time), imports the
cookies, and the transport sends the request again, once. A check given up on leaves the error
carrying the challenge, and `RetryBlock` offers to run it again. The runners:

- **Phone** (`components/web-check-host.tsx`, mounted at the root): the page loads in a web view
  nobody sees, so a check that needs no person passes by itself; if it needs one (Cloudflare's own
  `interactiveBegin` message, or a few seconds gone by), the same web view comes up full screen,
  so nothing reloads. Cookies come from the `web-cookies` module, which hands out a header string;
  they're imported scoped to the site's host without `www.`.
- **Desktop** (`apps/desktop/src/web-check.ts`): a hidden window on a fresh session with the
  request's User-Agent, shown when the page puts up a challenge frame or after a few seconds;
  Electron's cookie API gives real domains and expiry. The host's own requests (bridge calls and
  routed images) go through Chromium's network (`apps/desktop/src/chromium-network.ts`), so the
  clearance is used from the stack that earned it, and sites that turn Node's TLS fingerprint
  away let it through. It's `net.request`, not `session.fetch`: the latter refuses a request that
  sets `Referer` or `Origin`. Cookies stay core's; the session keeps none. Redirects are followed
  in our code, since Chromium drops a caller's `Cookie` header on every hop. `COMICAL_CHROMIUM_NETWORK=0`
  goes back to Node's `fetch`.
- **Web**: a page can't read another site's cookies, so there's no runner and no Verify button.

**The platform User-Agent.** A check only passes when the web view's User-Agent agrees with what
its engine reports about itself, and overriding a web view's User-Agent (even with a near-identical
string) costs its client hints, so the check loops. So each platform gives bridges its web view's
own User-Agent (`getDefaultUserAgent`); bridges behind such checks send it, and the web check then
leaves the web view's User-Agent untouched. Desktop: Electron's default, unchanged
(`apps/desktop/src/user-agent.ts`). Android: the system WebView's (`WebSettings.getDefaultUserAgent`,
in host-android). iOS: WKWebView's `navigator.userAgent`, read once at launch by the
`comical-runtime` module (`ComicalPlatform.webViewUserAgent`); bridges started before it lands use
the host's fallback. The module's `platformUserAgent()` is what the phone's web check compares with.

Some sites leave their clearance in the page's localStorage, for their own script to send, rather
than in a cookie. The challenge then names the keys (`storage`). The check is done once they're all
set, and at least one is new since the check began. Their values go to the import with the cookies
(`values`), and the host keeps them where the bridge reads them. The phone reads the keys with a
script injected before the page's own runs, so a value left from an earlier visit counts as
"before". The desktop's session is fresh, so it reads them with `executeJavaScript`.

## Web vs. native chrome

Web uses a top nav bar instead of the native Liquid Glass tab bar (see the `.web.tsx` splits in
the codebase); the screens are shared, only the nav chrome adapts. The web bundle uses the same
`app-tabs.tsx` bar as native (responsive: bottom bar on narrow viewports, a top-right icon row on
wide ones). `experiments.baseUrl` (`/comical-app`, for GitHub Pages) applies to the static export
but not the local dev server, which serves at the root.
