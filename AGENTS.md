# Layout

`apps/mobile` is the Expo app and the only source tree; `external/comical` is the submodule its
`@comical/*` packages come from. Everything below is the app unless it says otherwise. Architecture
rationale lives in `docs/ARCHITECTURE.md`.

# Comments

The code is the documentation. Comment only what the code cannot say: a non-obvious constraint, a
bug the shape is defending against, a decision that looks wrong until you know why. Never narrate
what the next line does, and never argue with alternatives that were never written.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Icons

Always use [lucide](https://lucide.dev) icons, everywhere. Import from
`lucide-react-native` (backed by `react-native-svg`) even on web — it works
cross-platform via react-native-web, so one `*.tsx` file per icon group covers
every platform with no `.web.tsx` split needed. Don't hand-roll glyphs. See
`apps/mobile/src/components/icons/ui-icons.tsx` for the pattern.

# Bottom nav: a custom-rendered bar, not the OS-native one

`apps/mobile/src/components/app-tabs.tsx` is a single cross-platform component (`expo-router/ui`'s
headless `Tabs`/`TabList`/`TabTrigger`, plain `Pressable`s) used on iOS,
Android, and web alike — there's no `NativeTabs`/`unstable-native-tabs` wrapper over the real
`UITabBarController`/Material 3 `NavigationBar` anymore. That was tried and reverted: iOS 26's
`tabBarMinimizeBehavior` needed react-native-screens patches to even find the content scroll
view, and even with that (plus pushing both edges imperatively, confirmed via on-device
diagnostics) the tab bar still only re-expanded once scrolled all the way back to the top, never
mid-scroll — a dead end inside UIKit's private implementation, not fixable from app code.

The visible bar is NOT the `TabList`. Its slide is a Reanimated animated style, which a
`TabList` can't carry (it renders a plain `View`, and `asChild` routes through a Slot that
flattens and object-spreads the style). So routes are registered by a `display: 'none'`
`TabList` — Expo's documented custom-tab-bar structure — and the bar is our own
`Animated.View` of href-less `TabTrigger`s alongside it. That registration `TabList` must
stay INLINE in `Tabs`: discovery matches `child.type === TabList`, so wrapping it in a View
or extracting it to a component silently yields zero screens (expo/expo#37796).

# Data: real API, REST-over-HTTP on every platform (for now)

Browse/Series/Reader call `useDataSource()` (`apps/mobile/src/data/source.ts`) — never
`apps/mobile/src/data/api.ts` or `apps/mobile/src/data/mock.ts` directly. That's the one place real vs.
mock is decided.

- **Web talks to `@comical/host-server` over REST; native (iOS/Android) can run
  bridges on-device.** All requests go through a swappable `Transport` in
  `apps/mobile/src/data/api.ts` (`setTransport`). The default `remoteTransport` is a plain
  `fetch` against `getApiBase()` — a Settings-configured override if the user
  set one, else `EXPO_PUBLIC_COMICAL_SERVER`, else `http://localhost:3100`. On
  native, an **embedded** transport resolves the same server-relative paths
  in-process by driving the reused `@comical/host-server` router against proxy
  bridges running in a native JS engine (JSC on iOS, QuickJS on Android) — no
  external server. This is wired in `apps/mobile/src/data/embedded/` (a thin layer:
  `startup.ts`, `preference.ts`, `settings-store.ts`) on top of
  **`@comical/host-rn`** (the comical submodule), which owns the reusable
  machinery (proxy `BridgeProvider`, in-process transport, registry-download
  `BundleSource`, Hermes WebCrypto shim). The native module
  (`apps/mobile/modules/comical-runtime`, wrapping comical's `ComicalBridgeContext`) is the
  engine; when it's absent (web, or before a native build) the app stays remote.
  The remote↔embedded swap is a one-tap Settings toggle; web is always remote.
  The remote server's URL is also Settings-editable (`useApiBase`/
  `setApiBaseOverride` in `apps/mobile/src/data/api.ts`), but that row is hidden while the
  on-device runtime is actually active, since it wouldn't do anything then.
- **Local dev needs a running host-server.** There's no bundled dev server in
  this repo yet — run `comical-web`'s dev server (`bun run dev` in
  `comical-web`, port 3100) alongside this app's own `bun run dev`, which
  auto-presets `EXPO_PUBLIC_COMICAL_SERVER` to that server's LAN address (see
  `dev.ts` at this repo's root) so it works out of the box, including from a
  phone on the same network. It only falls back to the deployed prod API if
  you've set `EXPO_PUBLIC_COMICAL_SERVER` yourself, or overridden the server in
  Settings.
- **Mock data is reachable in exactly two cases, both dev/preview only:** the
  `__DEV__`-gated "Use mock data" toggle in Settings, and the GitHub Pages
  static preview build (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1`, set only in
  `deploy-web.yml`, since static hosting has no backend to reach — see
  `apps/mobile/src/components/demo-banner.tsx`). A real production build never falls back to
  mock data on a failed request; screens show a retry state instead.

# State: TanStack Query for server, Legend State for local

Two layers, picked by what the state *is*. Don't invent a third — no new
`useSyncExternalStore` stores, no context for shared preferences, no `useState`
lifted to a parent for data that outlives the screen.

- **Server / async state → TanStack Query.** Anything fetched through
  `useDataSource()` lives in the query cache. Add query/mutation options in
  `apps/mobile/src/data/queries.ts` and register every key in the `queryKeys` factory there
  (a write must invalidate the same key the reader subscribes to). See
  `apps/mobile/src/data/query-client.ts` for the client + AsyncStorage persistence.
- **Local / client state → Legend State** (`@legendapp/state`, v3). Device-local
  preferences and UI state that is *not* a copy of the server: reader settings,
  toggles, the data epoch, the remembered scanlation group. **Never** mirror
  server data into an observable — re-fetch through Query instead.

Writing a local store:

- **Persisted** (survives restart): `const x$ = persisted$('comical:someKey', DEFAULT)`
  from `@/lib/observable` — that helper wires AsyncStorage persistence and keeps
  the observable eagerly loaded/saving. Reuse the store's existing AsyncStorage
  key so on-device values carry over.
- **In-memory**: `const x$ = observable(initial)` directly.
- **Read** in a component with `use$(x$)` (from `@legendapp/state/react`); read
  outside React with `x$.peek()` (non-tracking); write with `x$.set(v)` /
  `x$.assign(patch)`. Legend State no-ops a set to the current value, so no
  "skip if equal" guards. Keep exported hook signatures stable when migrating an
  existing store so call sites don't change.

`apps/mobile/src/hooks/use-reader-settings.ts` (persisted object) and `apps/mobile/src/data/data-epoch.ts`
(in-memory) are the reference implementations. `apps/mobile/src/lib/tab-bar-visibility.ts`
(reanimated UI-thread value) and `apps/mobile/src/lib/diagnostics.ts` (ring buffer) stay
hand-rolled on purpose. Rationale + the full split: `docs/ARCHITECTURE.md` →
"State management".

# Suppressing a React Compiler rule

`react-hooks/refs` and `react-hooks/set-state-in-effect` are on, and they pull the two ways of
resetting per-item state in a circle: compare a `prevXRef` during render and the first rule fires;
move the reset into an effect keyed on the prop and the second one does. **Neither is the answer —
keep the previous prop in `useState`.** That's React's own form of the pattern, it satisfies both
rules, and it's the one that's actually correct: React may discard a render, and state discarded
along with it means the comparison runs again on the retry, where an advanced ref would skip the
reset and leave a recycled card showing the previous item's cover. `SeriesCard`, `PageThumb`,
`useResolvedAsset` and `useDragSelect` are the reference implementations.

Boxing a live callback in a ref (so a memoized gesture or a long-lived effect doesn't re-subscribe
on every new closure identity) is fine — assign it **in an effect of its own**, not during render.
That only works because these boxes are read from gesture handlers, timeouts and async callbacks,
all of which run after commit; if something reads the box *during* render, the box is the wrong tool.

Three cases legitimately can't be written either way, and get a suppression instead:

- **Async/timer orchestration** — the effect drives a timeout or an async resolve, and the setState
  is a step in it (`ReaderPage`'s delay gate, the asset resolvers).
- **Gesture callbacks built during render** — a worklet or RNGH handler that touches a ref only when
  the gesture fires. The compiler can't prove a callback isn't invoked during render; we can.
- **One-shot latches and intent drains** — the post-hydration flag in `app-tabs.tsx` (React's own
  remedy for an SSR mismatch), a latch keyed off a measured height, a pending navigation intent that
  can only be applied once the bridge's filters have settled.

Write it as `// eslint-disable-next-line <rule> -- <why>`, on the offending line, with a reason
specific to that site — not a category name. `reportUnusedDisableDirectives` is an **error**, so a
directive that stops suppressing anything fails the lint rather than rotting in place. If a
suppression doesn't fit one of the three cases above, it's a code change, not a comment.

# Zoom transitions

The series page grows out of the card that opened it and collapses back into it (`apps/mobile/src/lib/series-zoom.ts`).
The collapse target is re-measured when the collapse starts and re-aimed if the card moves while it
runs — a captured rect goes stale the moment a last-read list reorders. Don't freeze it.

To make another list a zoom source: give it a stable key via `useZoomSurfaceKey`, put that on
`ZoomSurfaceContext` around the rows, have cards call `useZoomOriginSource`, and register
`useZoomSurfaceReveal` (scroll an item into view) plus `notifyZoomSurfaceChanged` when the order
changes. Every step degrades to the previous behaviour if skipped.

# Press-in warms the destination

Anything that navigates to a series starts that fetch on press-IN, not on navigate — the zoom is
most of a second of dead time otherwise (`apps/mobile/src/data/prefetch.ts`). `useWarmSeriesDetail`
for a card that opens details, `useWarmChapterPages` for a row that resumes reading (it also warms
the one page image the reader will land on).

Warm from the handler that navigates, passing the same values it puts in the route params. Deriving
them separately is a second answer to a settled question: only some opts are keyed, but the rest are
written into the cached object (`bridge: opts.bridgeName ?? ''`), so a warm that disagrees wins the
race and leaves the page wrong. Where press-in and the navigation live in different components
(collections tiles), the tile takes an `onWarm` callback rather than re-deriving the branch.

# Testing: new screens need a flow

A new top-level screen, tab, or interactive feature needs a Maestro e2e flow, not just a testID.
See `apps/mobile/e2e/README.md` for the authoring/running workflow (two copies per flow — `apps/mobile/e2e/mobile/` and
`apps/mobile/e2e/web/` — plus the web-only selector/gesture quirks to check against before assuming a mobile
flow ports over as-is). CI's `check:flow-coverage` (advisory-only) flags a new tab/screen/Settings
category with no flow referencing it yet, but can't tell when an *existing* flow has gone stale
because a screen it already covers changed — that's on the PR author, not the check.
