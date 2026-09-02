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

**A source card can also STOP EXISTING while the page is open, and that is a different question
from where it went.** NSFW re-hiding on background is the easy way to see it — the filter is a pure
derive over the same query, so the card leaves its list with no refetch — but a deleted history row,
an aged-out activity row, a library removal or a bridge uninstall all do it. A surface answering "I
no longer hold this" used to be indistinguishable from a surface that was never asked: both left the
caller holding its press-in rect, so the page flew back to a slot another series had since taken.
`zoomSourceHolds` is what separates them, and it is TRI-STATE on purpose — `undefined` (a
context-menu preview, an unmounted list) is not `false`, and only `false` may change anything.
Splitting existence from position is also what gets the grids covered at all: a grouped grid
coalesces N cards into one row, so it has no index to return and never had a locator, but
`items.some(...)` is free.

The collapse then takes a fourth destination, `no-source`, and that one substitutes the HERO rather
than the destination — the hero is the half that goes stale, since every geometry here maps its
destination onto it. Substitute it for EVERY reader on the converging path, not just for
`computeZoomGeom`: `zoomMaskStyle` and `zoomPageStyle` call `zoomMaskBox` themselves, and leaving
those on the real rect while the geometry took the stand-in had the window converge on the card's
old slot while the page inside it converged on the middle. A centre-ish card hides that completely
(the two land 0.5pt apart); a card down the left edge puts them 126pt apart, which reads as a page
clipped by a frame somewhere else, its left corners square because the frame has run into the screen
edge. `zoomDetach` is what makes the centre exactly right rather than merely neutral — its offset is
`span/2 - start - size/2`, which is 0 for a centred box at every `home`, so the assembly sits still
under a drag instead of being pulled toward a card that isn't there. Keep the card's SIZE and replace only its position with the screen's centre:
the same trade `cover-offscreen` makes, for the same reason, so the page performs the identical
shrink and simply lands nowhere in particular. The flying copy is not drawn there at all — it exists
to be the shared element with the card, and with no card it would sit opaque mid-screen at q = 0
purely to blink out — so the page carries the whole collapse on a fade that lasts to the end of it
(`ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE`), rather than one that hands over half way.

Latched like `zoomBoundOnScreen`, and the latch is doing more work here: the fact arrives
asynchronously, whenever a surface's items change, which can be mid-collapse — exactly when a
destination may not be swapped. So the page listens to its surface while at REST as well
(`notifyZoomSurfaceChanged` no-ops with no listeners, so this is nearly free) and a collapse only
ever reads an answer that was settled before it started.

**A copy that is not landing on the real cover is sized to the WINDOW, not to the cover.** There is
no on-screen cover for it to be the size of — that is the case's whole premise — so the only honest
size is the frame it is arriving in. Left at the page's scale it lagged the window badly (62% of its
width where the fade starts, 79% by the end), which reads as a cover sitting inside the frame rather
than the frame becoming the cover. Divide the window's width back out through the page's scale; the
centres already coincide at every `q`, and at q = 0 the window IS the card, so the landing is
untouched.

That copy also has no identical picture underneath to hide its cross-fade, so **its fade has to
CROSS the content's, not follow it**. The copy draws over the page and nothing in the window carries
a background, so coverage is `copy + (1 - copy) · content` and a hole in that is a hole through to
the grid. Timed late (it was [0.13, 0.32]) the content was down to 0.33 before the copy started, and
the middle of every off-screen dismissal was a window two thirds transparent — a gap, not a
cross-fade. `cover` never shows this because its copy is opaque from 0.7, before the content starts
leaving; that cannot be copied here, where an opaque window-filling cover that early would replace
the page instead of dissolving into it. So `cover-offscreen` gets its OWN content curve
(`ZOOM_CONTENT_FADE_CLOSE_OFFCOVER`) holding the page opaque through the first half, which is what
lets the copy take a long fade without opening a hole: worst coverage 0.90.

**Judge that fade's length in MILLISECONDS, never in `q`.** `q` does not move at a constant rate,
and the drag cannot take it below about 0.47 at all — the follow asymptotes first — so this whole
cross-fade plays inside the release spring, which is fastest exactly where `q` is high. A band up
there is crossed in a few frames however wide it looks: [0.5, 0.72] is a fifth of the collapse and
50ms of it. [0.15, 0.75] is 172ms of ~480ms.

Moving it is not the answer and was tried twice: sliding it in from the mask edge, along its own
path run backwards, is a second animation riding the collapse at any timing still legible enough to
see. Nothing but the fade changes.

**A list that reorders is asked where its item is; it is not measured.** `useZoomSurfaceLocator`
answers out of the virtualization state (`getState().positionAtIndex` / `.scroll`), which knows every
index — including rows it hasn't mounted — and knows the new one a render before the row is drawn
there. Measuring the row instead fails in both directions: a row scrolled out of the render window
unmounts, so the case that most needs finding is the one nothing can measure, and a row's drawn
position trails the list's own by a commit, so a measurement taken as the reorder lands reports where
it WAS. Both of those were real bugs, not hypotheticals.

To make another LegendList a zoom source: give it a stable key via `useZoomSurfaceKey`, put that on
`ZoomSurfaceContext` around the rows, have cards call `useZoomOriginSource`, and call
`useZoomSurfaceList` — the adapter that registers locate, membership and reveal together (the
order-changed notice rides on membership, which is rebuilt over the new items anyway). Hand it the list's OWN data array, not whatever it was derived from: the index it
finds is an index into `data`, and Activity coalesces its entries into rows, so the two are different
lists. `lib/series-zoom` knows nothing about LegendList; the four contracts it owns can be
implemented from anything, and MEMBERSHIP can be implemented where the other three can't — register
it alone (`useZoomSurfaceMembership`) for a list that knows what it holds but not where, which is
what the grids do. Every step degrades to the previous behaviour if skipped — a surface with no
locator keeps the rect captured on press-in, which for one that can't reorder IS the answer, and one
with no membership can never report its source gone. Don't re-measure the
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

**ONE resisted distance drives both the size and the position, and nothing else limits either.**
`zoom` is `1 - held/travel`, where `held` is the drag's spring-resisted travel (`zoomDragFollow`) —
so the same resistance that slows the page down slows the window down, and the two cannot stop at
different moments. The window is what reads as "the page" during a dismissal, since on a `cover`
collapse the page's own scale barely moves and the mask does the visible shrinking; letting a raw
drag carry that from full screen to a cover card turned the thing under your thumb into a thumbnail
before you had decided to let go.

There was an explicit floor first (`ZOOM_DRAG_MIN_WINDOW`, a per-card `zoom` clamp at 80%), and it
worked but read as a wall: the shrink ran at full speed and then stopped dead, while the follow went
on. Feeding `zoom` from the resisted distance makes the limit EMERGENT and eases into it — 91% of
the screen at 136pt of finger, 84% at 300, 77% at 650, asymptotic to `1 - REACH`. It also turns "a
drag can never finish the collapse" from a guard into arithmetic: `held` is asymptotic to
`REACH · travel`, so `zoom > 1 - REACH` for any drag, however long.

**The follow is a SPRING, resisting from the first pixel** (`zoomDragFollow`) — otherwise the floor
buys stillness in size and hands it straight back in position, and a page that stops shrinking then
slides anywhere you like at 80% reads as dragging a card around, not dismissing a screen. It
asymptotes at the floor's own travel, so the page runs out of room exactly where the size does.

Two earlier shapes were wrong at opposite ENDS of the drag. A piecewise band — free to the floor,
rubber-banded after — read as binary despite being C¹ at the knee: **continuity of speed is not
continuity of feel**, and all its curvature sat in the ~20pt after the knee. One exponential fixed
that and then FLATLINED, since `1 - e^-t` is within a percent of its limit by three time constants,
so past ~450pt the page simply stopped — and a page that stops dead is a wall wherever you put it.

A polynomial tail (iOS's scroll-boundary band) fixed that end — its rate decays as 1/t², so there is
always something left to give — but starting that rate at exactly 1 still read as everything
happening at once, because the whole of its range had to fall through one length. So the initial
rate is freed from the asymptote: `reach·d / (reach/grip + d)`, rate `grip·(S/(S+d))²` for
`S = reach/grip`. **`GRIP` says how immediately the spring is felt, `REACH` how far the page can
ever get, and neither moves the other** — which is the whole reason a single-parameter band could
never be tuned into this.

**The series page's dismissal is RIGHTWARD ONLY, and the clamp belongs on the follow as well as the
collapse.** `backSwipePan` can only activate rightward, but `tx` is measured from the activation
point, so a finger that starts right and comes back left goes negative; with only the collapse
clamped, the page slid left and took the mask, cover and flying copy with it — the whole dismissal
on the wrong side of the screen, aimed at a card it could never reach. The cross axis rides the
forward one for the same reason.

**A release decision reads the FINGER, never the follow.** They were the same number until the
resistance existed; afterwards the follow tops out well below `DISMISS_COMMIT_FRACTION` of the span,
so judging by it makes a deliberate slow swipe impossible to commit and leaves only a flick's
velocity able to dismiss at all. What the user swiped is the question; how far the page was allowed
to move in reply is not.

**The corner is fully rounded within the first 3% of the collapse** (`ZOOM_RADIUS_ROUNDED_BY_CLOSE`),
not carried linearly across all of it. Radius is the earliest signal that a page has become a card —
at the top of a dismissal size and position have barely moved, so it is the only thing saying what is
about to happen — and since the spring took over the shrink a drag only carries `zoom` to about 0.87,
which on a linear ramp is 13% of the corner, i.e. square. Judge the threshold by FINGER TRAVEL, not
by `q`: the reader's paged dismiss measures over the height, so the same swipe moves it half as far
as the series back-swipe. 0.97 is a full corner after 27pt of a back-swipe and 57pt of a paged
dismiss.

**Opening keeps its own, gentler threshold**, because there the corner signals nothing — you already
touched the card — so squaring off has to stay a tail rather than an event. The split is only safe
because the curve is chosen by `zoomRadiusClosing`, NOT by `zoomClosing`: that one is cleared by
`settle` on the frame a cancelled swipe releases, mid-springback, which would swap 12pt for 3.8pt in
a single frame. `zoomRadiusClosing` is retired by a reaction on `zoom` itself, at
`ZOOM_RADIUS_CURVE_SWAP_AT` — where the two curves have converged to 0.16pt of each other.

**The reader dismiss's flying copy follows the FORWARD progress, not the raw distance**
(`zoomThumbBias`). That gesture measures with a hypot, which cannot tell "further out" from "back
through the start and out the other side" — swipe down, come back up past where you began, keep
going up, and the hypot rises again, so the page shrinks again and the cover used to fade back in
with it. Nothing about that second shrink is an approach to the card. Projecting onto the drag's
launch direction separates them: the projection falls to zero as the finger returns and stays there
past it. The bias reaches 0 exactly where the finger reaches its origin, where the copy is
transparent anyway, so nothing blinks (worst opacity change 0.002 per pt). It rewinds the copy's
OPACITY only — size and position keep tracking the real collapse, because the page really is
shrinking; it just isn't arriving anywhere. A commit restores it over
`ZOOM_THUMB_BIAS_RESTORE_MS`, never in one frame: released mid-reversal the copy is at zero and the
page still has to land on the card with a picture on it.

**Vertical play is EARNED by horizontal travel** on the series page: none at rest, all of it by the
distance that would commit the dismissal, linear between. A page dragged back toward the left then
arrives with its drift already gone instead of holding it to the last pixel and snapping — a gate at
`forward > 0` is one frame wide and the whole height of the drift (52pt in one pixel of finger,
against 0.13pt for the ramp).

**Both the drag and the homing ride the MASK ALONE** (`zoomDetach`), never the page's target. The
page is the mask's child and cancels the mask's own origin out of its transform, so an offset on the
mask carries the window, the page, the flying copy and the cover together and leaves every relation
between them untouched. Putting `home` on the page's target instead moves the page out from under
its own window: the two then shrink about different anchors, the cover drifts toward an edge, and it
is visibly clipped by the frame that is supposed to hold it. `zoomMaskBox` is deliberately ignorant
of both — one box, read by all three animated styles, so they cannot disagree about where the window
is.

# Reader zoom: a page has a REST, and a spread's rest is not 1×

Both paged readers (`use-zoomable.ts` on native, `paged-reader.web.tsx` on web) share
`page-geometry.ts`, which answers two questions about a page from its picture's real dimensions:
the box the picture occupies at 1× (what every pan is clamped to — a zoomed page stops at its own
edge, never slides on into its letterbox), and where the page RESTS. Most pages rest at 1×. A
spread — a picture wider than it is tall — rests scaled to the viewport's height, at the edge
reading starts from (left for L→R, right for R→L), and reads by panning sideways. That is the
`zoomWidePages` setting, on by default; it is what Mihon calls "automatically zoom into wide
images" and Panels "adjust to orientation". Judge "wide" by the PICTURE's aspect, never the
viewport's: an ordinary portrait page is letterboxed on a tall phone too, and resting that at
fit-height puts every page behind a sideways pan. The `smart` page fit is the same judgement
applied to the LAYOUT (`effectiveFit`): fit-width for a tall page, fit-page with the spread rule
for a wide one, and fit-width for a page whose shape isn't known yet, since nearly every page is
tall. Webtoon has only its two layouts and reads `smart` as the continuous strip.

Nothing locks the vertical axis. At fit-height the content's vertical overhang is zero, so the
clamp is what holds it — the same clamp that stops a 2.5× page drifting into black. Don't add a
rule for it.

A page resting zoomed still has to be LEFT, and the pager freezes its scroll for any zoomed page,
so the two ways out are built into the page: a side-zone tap pans a step across the spread
(`TAP_PAN_FRACTION`) and turns only once there is nothing left that way, and a one-finger drag that
BEGAN at an edge and was let go heading past it turns (`onPanPastEdge`, judged with
`releaseCommitted`). Latched from where the finger landed, not where the drag ended, the way a
nested scroller hands off: one swipe carries you to the edge, the next one leaves.

Double-tap toggles between the rest and a magnification of it (`DOUBLE_TAP_SCALE × rest`, capped
at `WIDE_ZOOM_HEADROOM × rest` for a spread, whose rest is already above the old `MAX_SCALE`).
Pinching OUT below a spread's rest is allowed, down to 1×, for a look at the whole thing.

Only the ACTIVE page reports `onZoomChange`. A page leaving the screen is put back to rest
silently and the page arriving reports its own rest on activation; the old arrangement, where the
leaving page reported `false`, would race the arriving spread's `true` in the same commit, in tree
order rather than reading order.

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
