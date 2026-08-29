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
  phone on the same network. It only points elsewhere if you've set
  `EXPO_PUBLIC_COMICAL_SERVER` yourself, or overridden the server in Settings.
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
The collapse target is re-resolved when the collapse starts and re-aimed if the card moves while it
runs — a captured rect goes stale the moment a last-read list reorders. Don't freeze it.

**The page lands on its own hero cover only while that cover is at least half on screen.** A bound
that has scrolled off is still a bound the page has to fly onto, so aiming at one drags the whole
page up to meet it: the page appears to scroll itself away under the finger. Scrolled past it the
collapse switches to `cover-offscreen` instead — the cover's SIZE, centred on the page, with no
scroll to follow (`ZoomDest` in `apps/mobile/src/app/series/index.tsx`). Only the position was ever
wrong: the size is what the collapse's scale is derived from, so keeping it keeps the same shrink,
and dropping to the screen-relative `page` target instead (which is what this did first) balloons
the flying copy to full screen width. Which destination is in play is LATCHED while the page is at
rest (`zoomBoundOnScreen`), never read live off the scroll — swapping mid-collapse is a visible
jump.

A copy that is not landing on the real cover has no identical picture underneath to hide the
cross-fade, so **it waits for the window to come down to the cover's own size** rather than fading
on the same curve. The copy is only ever about a cover card wide, while the window starts at the
whole screen, so fading in early leaves a picture adrift in a frame twice its width — which is what
reads as a cover appearing out of nowhere. Timed off that fill instead, it arrives as it comes to
fill the window. Moving it is not the answer and was tried twice: sliding it in from the mask edge,
along its own path run backwards, is a second animation riding the collapse at any timing still
legible enough to see. Nothing but the fade changes.

**A list that reorders is asked where its item is; it is not measured.** `useZoomSurfaceLocator`
answers out of the virtualization state (`getState().positionAtIndex` / `.scroll`), which knows every
index — including rows it hasn't mounted — and knows the new one a render before the row is drawn
there. Measuring the row instead fails in both directions: a row scrolled out of the render window
unmounts, so the case that most needs finding is the one nothing can measure, and a row's drawn
position trails the list's own by a commit, so a measurement taken as the reorder lands reports where
it WAS. Both of those were real bugs, not hypotheticals.

To make another LegendList a zoom source: give it a stable key via `useZoomSurfaceKey`, put that on
`ZoomSurfaceContext` around the rows, have cards call `useZoomOriginSource`, and call
`useZoomSurfaceList` — the adapter that registers locate, reveal and the order-changed notice
together. Hand it the list's OWN data array, not whatever it was derived from: the index it finds is
an index into `data`, and Activity coalesces its entries into rows, so the two are different lists.
`lib/series-zoom` knows nothing about LegendList; the three contracts it owns can be implemented from
anything. Every step degrades to the previous behaviour if skipped — a surface with no locator keeps
the rect captured on press-in, which for one that can't reorder IS the answer. Don't re-measure the
card instead: while a page is open its grid sits under the backdrop's scale, so the measurement comes
back shrunk toward the screen centre and only an arithmetic reconstruction gets it back.

**A dismissal drag is in the SWIPE's coordinates; only the release is in the card's.** The collapse
converges on the source card, so running it under a finger used to drag the page toward the card as
you swiped — open a series from a card near the bottom, swipe sideways, and it sank as it went.
`zoomHoming` splits the two: while the finger is down the page is centred and offset purely by the
drag, and the convergence arrives over the rest of the collapse after release.

That homing is DERIVED FROM `zoom`, never animated. An earlier attempt gave the follow its own
spring beside the collapse's and had to be reverted — two springs racing means the page is wherever
the loser left it when the winner finishes, which is the moment it leaves and the source card
un-blanks. As a function of the collapse's own progress it reaches exactly 1 on the frame `zoom`
reaches 0, so the page cannot land anywhere but the card. For the same reason the drag values are
left frozen at release rather than sprung back: `home` retires them on that one clock. Every path
that drives `zoom` sets `homeAt` first — there is no default that is right for all of them.

**A drag stops shrinking the window at `ZOOM_DRAG_MIN_WINDOW`** (80% of the screen). The window is
what reads as "the page" during a dismissal — on a `cover` collapse the page's own scale barely
moves and the mask does the visible shrinking — so an unclamped drag turned the thing under your
thumb into a thumbnail before you had decided to let go. `ZOOM_DRAG_TRAVEL` already reserves part of
the collapse for the release by making the drag's travel longer than the screen; this reserves it by
SIZE, which is the half a user can see. What is left under the finger is mostly the FOLLOW, with the
size change saved for the release. The floor is a `zoom` value derived per card
(`zoomDragFloorFor`), not a constant: the same progress is a different window for a different source
rect, and a card already wider than the floor gets none.

**The follow stiffens at that same knee** (`zoomDragPastFloor`), or the floor buys stillness in size
and hands it straight back in position — a page that stops shrinking and then slides anywhere you
like at 80% reads as dragging a card around, not dismissing a screen. Past the knee the page gains
about a thumb's width however far you swipe. The band is C¹ there, so nothing changes pace at the
moment the shrink floors.

**A release decision reads the FINGER, never the follow.** They were the same number until the
resistance existed; afterwards the follow tops out well below `DISMISS_COMMIT_FRACTION` of the span,
so judging by it makes a deliberate slow swipe impossible to commit and leaves only a flick's
velocity able to dismiss at all. What the user swiped is the question; how far the page was allowed
to move in reply is not.

**Both the drag and the homing ride the MASK ALONE** (`zoomDetach`), never the page's target. The
page is the mask's child and cancels the mask's own origin out of its transform, so an offset on the
mask carries the window, the page, the flying copy and the cover together and leaves every relation
between them untouched. Putting `home` on the page's target instead moves the page out from under
its own window: the two then shrink about different anchors, the cover drifts toward an edge, and it
is visibly clipped by the frame that is supposed to hold it. `zoomMaskBox` is deliberately ignorant
of both — one box, read by all three animated styles, so they cannot disagree about where the window
is.

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

# Release notes ride the update check's own fetch

Settings → About → tap the **Version** row (`app/settings-whats-new.tsx`) — the notes belong to a
version, so the version is what opens them. The screen shows two things: the changes in the update
on offer, and the changes in the build already installed. Both come out of the manifest
`useAppUpdateCheck` already fetches — `versions[].localizedDescription` in the iOS SideStore
sources, `notes` in the Android/web `version.json` — so there is no second request and no way for
the screen to disagree with the row that sent you there. Adding a surface means teaching a
PUBLISHER to write notes into the artifact the checker reads, never adding a fetch here.

Parsing lives in `data/release-notes.ts`, deliberately free of react-native imports so it can be
tested; `data/use-app-update.ts` keeps the fetching, caching and the launch/foreground trigger. The
toast stays a pointer ("Update available — see Settings") — a changelog is read when you choose to,
not put over the screen.

Which generator fills a channel is set by whether it is TAGGED: `changelog-section.sh` quotes
`CHANGELOG.md`, `rolling-changelog.sh` lists the commits since the channel's last publish. See
`docs/DEVELOPMENT.md` → "Release notes reach four places" for the full table.

# Testing: new screens need a flow

A new top-level screen, tab, or interactive feature needs a Maestro e2e flow, not just a testID.
See `apps/mobile/e2e/README.md` for the authoring/running workflow (two copies per flow — `apps/mobile/e2e/mobile/` and
`apps/mobile/e2e/web/` — plus the web-only selector/gesture quirks to check against before assuming a mobile
flow ports over as-is). CI's `check:flow-coverage` (advisory-only) flags a new tab/screen/Settings
category with no flow referencing it yet, but can't tell when an *existing* flow has gone stale
because a screen it already covers changed — that's on the PR author, not the check.
