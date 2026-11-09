# Native hacks: the release checklist

Every workaround the iOS native work (`feat/native-tabs-ios`, PR #157) needs, in one place, so each
one gets a decision before this ships. Compared against `main` at `a1af10ca`, the branch's base;
re-audited 2026-11-06.

The repo carries **no dependency patches**: no `patches/` directory and no `patchedDependencies`.

## How to read this

**Call** is the recommendation, not a decision already taken:

- **Blocker**: must be gone or changed before release.
- **Decide**: could ship, but it is a real risk or cost. Needs a yes or no.
- **Keep**: fine to ship. Re-check it on each dependency update.

**How it fails** matters as much as the hack itself. Most of these fail silently: no crash, no error,
just a feature quietly back to worse behaviour. Nothing in CI catches those, so the update check at
the end of this doc is the only guard.

## Summary

| # | Hack | Kind | Call | Done |
|---|------|------|------|------|
| 1 | react-native-screens 5.0 beta, with a Metro redirect and a tsconfig path | Pre-release dependency | Decide | [ ] |
| 2 | Bar test screens | Deleted | Done | [x] |
| 3 | iOS 27 SDK image on every lane | Build | Done | [x] |
| 26 | Temporary traces | Removed | Done | [x] |
| 4 | `menu-touch-gate` | Private class name, runtime view walk | Decide | [ ] |
| 5 | `nav-bar-leading` | Takes over a library-owned bar item | Decide | [ ] |
| 6 | `ZoomSource` | expo-router internals | Decide | [ ] |
| 7 | `system-context-menu` | Custom module, touch handler reach | Decide | [ ] |
| 8 | `content-scroll-view` and `ScreenScrollMarker` | Public API, undocumented reason | Decide | [ ] |
| 22 | `nav-bar-fade` | Animates a library-owned bar | Decide | [ ] |
| 24 | `nav-bar-large-title` | Sets a library-owned navigation item's property | Decide | [ ] |
| 25 | `nav-bar-hold` | Reads the bar's touches, finds the title's label by its text | Decide | [ ] |
| 20 | Timers standing in for a signal | Time-based guesses | Decide | [ ] |
| 9 | `HeaderHeightContext` deep import | Package internals | Keep | [ ] |
| 10 | `unstable_nativeProps` | Unstable API | Keep | [ ] |
| 11 | `menu-anchor` | Deleted: unreached on iOS since the SwiftUI form | Done | [x] |
| 12 | `shaped-image` and `menu-thumb-files` | Bitmaps baked to shape | Keep | [ ] |
| 13 | `in-tab/` route copies | 51 duplicate route files | Keep | [ ] |
| 14 | `BarExtent` | Measuring through the safe area | Keep | [ ] |
| 15 | Browse backdrop inside the list | Layout bent around a library walk | Keep | [ ] |
| 16 | Reader bar options in both modes | Avoids a library remount | Keep | [ ] |
| 17 | Status bar through the root screen | Routing around React Native's StatusBar | Keep | [ ] |
| 18 | Tab badge rendered only above zero | Library bug | Keep | [ ] |
| 19 | Type casts at library seams | Typing | Keep | [ ] |
| 27 | Room keep rule for R8 | Shrinker rule | Keep | [ ] |
| 21 | No bar material on the folded Duo | Resolved and its code removed | Done | [x] |
| 23 | `nav-bar-edge` | Removed with the section label it served | Done | [x] |

## Blockers

### 1. react-native-screens 5.0 beta

- **What:** `react-native-screens` is pinned to `5.0.0-beta.1`, a tagged pre-release inside
  expo-router 58's declared range (`^4.30.0 || ^5.0.0-alpha.3`), in place of the
  `4.31.0-nightly-20261030` it was on. The beta carries the same legacy-stack minimization props
  and the same two packaging slips as the nightly, so the redirect and the path stay.
- **Where:**
  - `apps/mobile/package.json` and the root `package.json` `overrides`.
  - `apps/mobile/metro.config.js`: on web, redirects `./fabric/NativeScreensModule` to
    `./fabric/legacy/NativeScreensModule`, because the nightly's web stub is in the wrong place.
  - `apps/mobile/tsconfig.json`: a path for `react-native-screens/reanimated`, whose entry names a
    folder the build no longer writes.
- **Why:** the bar slide-away props (`minimizationBehavior`, `restorationBehavior`,
  `safeAreaAdjustment`) only exist from 4.31.
- **How it fails:** the web redirect failing broke the desktop build outright, so that one is loud.
  The risk in the nightly itself is unknown: it is not a release.
- **Removed by:** the stable 4.31. Then delete the redirect and the tsconfig path. If stable is not out
  by release, drop the slide-away and go back to the SDK's version.
- **Status (2026-11-06):** no stable 4.31 on npm. `latest` is 4.30.1 and `next` is 5.0.0-beta.1, with
  the nightlies still numbered 4.31.0; the minimization props were merged for "Stack v5", so the
  stable carrier is 5.0. The beta is the pin now; the decision left is whether a beta may ship, and
  it is checked on a device like any bump (the update check below).
- **Upstream:** the web stub and the `reanimated` entry are worth reporting. Neither has been filed.

### 2. Bar test screens

- **What:** diagnostic screens for the bar slide-away.
- **Where:** `apps/mobile/src/components/bar-test.tsx`, routes `app/bar-test.tsx`,
  `app/bar-test-upstream.tsx`, `app/(tabs)/settings/in-tab/bar-test.tsx`, their registrations in
  `app/_layout.tsx`, and the rows in `app/settings-developer.tsx` and `app/(tabs)/settings/index.tsx`.
- **Done:** deleted, with their routes, registrations and rows. The slide-away is confirmed on a
  device on every kind of screen, so they had answered their question.

### 3. iOS 27 SDK on a preview runner

- **What:** only the PR lane builds against the iOS 27 SDK, on the `xcode-27` image, which is a public
  preview. `main`, nightly and release stay on `macos-26`.
- **Where:** `.github/workflows/build-ios.yml:92`, `.github/workflows/build-ios-reusable.yml` (`runner`).
- **Why it blocks:** every iOS 27 behaviour compiles away on `macos-26`. As this stands, what gets
  tested in PR builds is **not what a release would ship**: no bar slide-away, no preferred sidebar
  placement, no vertical bar on a folded display, no opt-out from the reader's horizontal bars.
- **Done:** every lane builds on `xcode-27`: the reusable workflow's default is that image and the
  PR lane's conditional is gone. Chosen deliberately: a build on the stable image would not be the
  app that was tested. Re-check when the image leaves preview or Apple's SDK moves.

### 26. Temporary traces

- **What:** diagnostics left in the code, each marked `TEMPORARY`, writing to Settings >
  Diagnostics and, in development, to Metro.
- **Done:** all removed: the `bar-extent` measure trace, the `bar-fade` traces and the
  `onTrace` event they rode on in `nav-bar-fade`, and the `tab-width` traces of the folded Duo's
  first-open shift, which is still open and gets fresh traces when it is picked up again.

## Internals and private reach

### 4. `menu-touch-gate`

- **What:** a gesture recognizer on every window that makes React Native's touch handler ignore a tap
  while a system menu is open. Installed by an app-delegate subscriber. Copied from Expo's
  `SystemMenuTouchGate` (expo-modules-core, MIT).
- **Where:** `apps/mobile/modules/menu-touch-gate/ios/MenuTouchGate.swift`.
- **Why:** on iOS 26 the tap that closes a menu also reaches the view beneath it, so a Pressable under
  the tap fires. Expo has this same fix, but only its SwiftUI host view installs it, and these UIKit
  menus never mount that host.
- **Private reach:**
  - Detects the menu by comparing against `_UIContextMenuContainerView`, a **private UIKit class
    name**, assembled at runtime from two strings. It only compares the name and calls nothing on it.
    Even so, assembling it that way can look like hiding it from a scan. This has **never been through
    App Review**, since the app only ships by sideloading.
  - Finds `RCTSurfaceTouchHandler` by class name, walking up from the touched view.
- **How it fails:** silent. If Apple renames the class, the fall-through tap comes back.
- **Removed by:** Expo installing its gate for every window, or Apple fixing the hit test. Worth filing
  with Expo. Not filed.
- **Decide:** before any App Store submission this needs a real answer. Dropping it costs the
  fall-through tap on iOS 26.

### 5. `nav-bar-leading`

- **What:** a zero-size view that finds the screen's `UINavigationItem` by walking the responder chain,
  observes `rightBarButtonItems` with KVO, and sets the picture, label and menu directly on an item
  react-native-screens created (a placeholder among the trailing items, found by its accessibility
  label).
- **Where:** `apps/mobile/modules/nav-bar-leading/ios/NavBarLeadingModule.swift`,
  `src/components/nav-bar-leading-menu.tsx`.
- **Why:** three react-native-screens behaviours together.
  - Any header config change replaces every bar item with no animation, so a menu pick tore down the
    bar.
  - Its image load is asynchronous and uncached, so the button was blank through a pop.
  - A bar item copies its menu, so async menu images never arrive.
- **Risk:** this mutates an object a library owns. It relies on the library keeping the
  placeholder's accessibility label on the item it builds and on KVO firing when it rebuilds.
- **How it fails:** silent. A blank or wrong leading button, or a menu with no rows.
- **Removed by:** react-native-screens updating items in place and loading images synchronously. Worth
  filing. Not filed.
- **Decide:** it is the most invasive module here. The alternative is accepting the visible bar pop on
  a bridge switch and a blank button on the way back, which were the original complaints.

### 6. `ZoomSource`

- **What:** builds a system zoom source for a push made in code. Renders a `Link` around a view that
  takes no press, reads the id expo-router keeps in a private context, and adds it to the push under
  expo-router's private param name.
- **Where:** `src/components/zoom-source.tsx`: a deep import of
  `expo-router/build/link/zoom/zoom-transition-context.js`, and the param
  `__internal_expo_router_zoom_transition_source_id`.
- **Why:** expo-router only builds a zoom out of a `Link` press. The Read button, chapter rows, History
  and Activity rows and page tiles do more than push, so they need one from code.
- **How it fails:** silent. If either internal moves, the id is null and the push becomes a plain slide.
  The import path breaking would fail the build, which is the better case.
- **Removed by:** a public expo-router API for an imperative zoom push.
- **Decide:** the update check below covers this. It is also the easiest one to ask upstream for.

### 7. `system-context-menu`

- **What:** a 412-line local module for `UIContextMenuInteraction`, with rows requested only when the
  menu opens, and a shared preview view mounted at the root.
- **Where:** `apps/mobile/modules/system-context-menu/`, `src/components/system-context-menu.tsx`,
  `src/components/series-card-menu.ios.tsx`.
- **Why:** `@expo/ui`'s context menu builds its contents ahead of time. This was tried against the
  module on a device and dropped (`44ecf038`), since the module asks for nothing until a hold.
- **Private reach:** `cancelReactNativeTouches` finds `RCTSurfaceTouchHandler` with `NSClassFromString`
  and toggles it to cancel the press. expo-router's own link preview does the same.
- **How it fails:** silent if the class is renamed: a press released as the menu opens also fires as a
  tap.
- **Removed by:** a library menu that defers its contents.
- **Decide:** the largest body of Swift in this work, and ours to maintain. The commits were kept
  discrete to make it removable.

### 8. `content-scroll-view` and `ScreenScrollMarker`

- **What:** a view that names a screen's list to its view controller, with the public
  `setContentScrollView(_:for:)`. It finds the controller through the responder chain and the list by
  walking first subviews, and failing that by the nearest list at least half the window tall anywhere
  under it: a SwiftUI list (the settings screens' form, `settings-list.ios.tsx`) sits a few views
  into its host and not first among them. For that list it also stands in for the marker, which can
  hold only a React Native scroll view: `tabBar` names the list for the tab bar too (`.all`), and
  `scrollToTop` (a view function) scrolls it on the tab's reselect, since react-native-screens
  scrolls only the list its marker holds; `scrolledPast` has it watch the list's offset (KVO) and
  report crossings of a threshold, which is how every iOS screen's bar learns to take its material
  (`bar-scrolled.tsx`).
- **Where:** `apps/mobile/modules/content-scroll-view/`, `src/components/screen-scroll-marker.tsx`, and
  around every screen's main list; `settings-list.ios.tsx` renders it directly.
- **Why:** react-native-screens' legacy stack, which expo-router uses, never names the list. Its newer
  stack does, with this same call. Left to itself, UIKit found the list under one wrapper and lost it
  under two, and the bar stopped sliding. That depth limit is **observed on one device, not documented**.
- **Status: confirmed on a device.** The bar slides away and restores on the tab roots, the series
  details, the search and the settings pages, the SwiftUI form's included, and the crossings it
  reports drive the pushed pages' material.
- **Risks:**
  - It is a convention. A new screen whose list has no marker silently keeps a fixed bar.
  - Series details has layers on one route, so `ScreenScrollActiveContext` makes only the top layer's
    list the named one.
- **Removed by:** expo-router moving to the newer stack, or the marker reaching stack screens. Worth
  filing.
- **Decide:** keep it if the device test passes. If it fails, drop the slide-away rather than move on to
  flattening wrappers screen by screen.

### 9. `HeaderHeightContext` deep import

- **Where:** `src/hooks/use-native-header.ts:4` (and `bar-test.tsx`, which goes with item 2).
- **Why:** `useHeaderHeight` throws outside a header-bearing stack, and most of the app is outside one.
- **How it fails:** loud. A moved path fails the build.

### 10. `unstable_nativeProps`

- **Where:** `src/lib/native-bar.ts:33`, `src/components/bar-extent.tsx`,
  `src/components/series/details-page.tsx:1211`, `src/components/series/reader-page.tsx:1345`,
  `src/components/app-tabs.ios.tsx:76`.
- **Why:** the slide-away props and the tab content width have no public expo-router option.
  `app-tabs.ios.tsx` also casts `onLayout` in, because the screen's props are typed without it.
- **How it fails:** silent. A renamed prop means a fixed bar or a wrong column width on a sidebar layout.
- **Removed by:** expo-router exposing these options.

### 22. `nav-bar-fade`

- **What:** a zero-size view in the series details finds the screen's `UINavigationItem` through the
  responder chain, watches its `title` and `standardAppearance` with KVO, and adds a `CATransition`
  fade to the navigation bar's layer from inside react-native-screens' setter.
- **Where:** `apps/mobile/modules/nav-bar-fade/`, and its view in
  `src/components/series/details-native-bar.tsx` and in `TopBar` on iOS (the pushed pages). The
  tab roots no longer use it: UIKit switches their large-title bars itself.
- **Why:** react-native-screens applies header options unanimated, so the bar's title and material
  switched in one frame. UIKit's own scroll-edge crossfade was tried instead and never ran.
- **The title isn't part of it:** the series title is a custom title view that is always in the
  bar, its opacity following the scroll, so it never goes through an option change. A plain-text
  title went through one, and where the back button sits in the Duo's vertical bar an untitled bar
  collapses to no height, so the first title grew it from nothing in one frame (a trace on the
  device: 0pt at the switch, 58pt a frame later). A blank plain-text title kept the height but got
  the system's backing, a visibly empty bar. Only the unfolded material switch is faded now.
  Confirmed on a device, unfolded.
- **Gone with item 21:** the `edgeBacked` prop and the `UIScrollEdgeElementContainerInteraction`
  it added to the title view, the folded Duo's hard-edge backing, are deleted; the module is the
  fade alone now. Its trace event went with item 26.
- **Risk:** it animates a layer UIKit owns, and relies on KVO firing inside the library's update.
- **How it fails:** silent. If the KVO stops firing, the switch is instant again. If UIKit starts
  backing a custom title view, the bare bar shows a band over the strip. If the title view or list
  can't be found, the folded bar stays bare past the title.
- **Removed by:** react-native-screens animating option changes.

### 23. `nav-bar-edge`

- **Removed.** It read the bar's slide off its layers once a frame so a section's label could take
  the bar's title at the bar's edge. The label is gone; the tab's title is UIKit's large title in
  the bar (item 24).

### 24. `nav-bar-large-title`

- **What:** a zero-size view that finds the screen's `UINavigationItem` by walking the responder
  chain and sets `largeTitleDisplayMode = .inline` (the large title on the bar's row beside the
  items, never collapsing: Photos' tab bars), observing the property with KVO so the mode holds
  when react-native-screens sets `.always` back on each header update.
- **Where:** `apps/mobile/modules/nav-bar-large-title/ios/NavBarLargeTitleModule.swift`,
  `src/components/native-tab-header.tsx`.
- **Why:** react-native-screens maps `largeTitle` to `.always` or `.never` only.
- **Risk:** it mutates an object the library owns, inside the library's own update.
- **How it fails:** silent. If the KVO stops firing the tabs show the library's `.always` large
  title, a row under the items that collapses on scroll, and the content's padding is measured
  from that bar instead.
- **Removed by:** react-native-screens exposing the display mode.

### 25. `nav-bar-hold`

- **What:** a zero-size view that attaches a non-cancelling press recognizer to the navigation
  controller's view and takes only touches on the bar's largest label showing the screen's title,
  reporting the press and its end for the NSFW hold, and swelling that label on each of the
  hold's beats (a transform animation on a view UIKit owns).
- **Where:** `apps/mobile/modules/nav-bar-hold/ios/NavBarHoldModule.swift`,
  `src/components/native-tab-header.tsx`.
- **Why:** the large title is UIKit's text; nothing of the app's is under the touch.
- **Risk:** it finds the title by walking the bar's subviews for a `UILabel` with the title's
  text, which is public API resting on the bar's internal structure.
- **How it fails:** silent: the hold on the title does nothing.
- **Removed by:** a hold target of our own in the bar, which iOS 26 bars don't take bare.

## Shaped workarounds

These use public APIs, but the shape exists only because of a gap somewhere.

### 11. `menu-anchor`

- **What:** an invisible `UIButton` with a `UIMenu`, laid over a settings row React Native draws.
- **Where:** `apps/mobile/modules/menu-anchor/`, `src/components/settings/select-row.ios.tsx`.
- **Why:** `@expo/ui`'s menu renders pictures at 1×. This replaced the one dependency patch this branch
  ever had.
- **Status:** unreached on iOS since the settings screens became the SwiftUI form
  (`settings-list.ios.tsx`), whose enum rows are the form's own menu pickers. The row file and the
  module are only resolved by the app's own renderer, on Android and web, where the module is null.
- **Done:** deleted, with `select-row.ios.tsx` and its platform-contract line; iOS resolves the
  overlay row, which nothing there renders.

### 12. `shaped-image` and `menu-thumb-files`

- **What:** thumbnails rendered to local files with the corners baked in.
- **Where:** `apps/mobile/modules/shaped-image/`, `src/lib/menu-thumb-files.ts`.
- **Why:** a `UIMenu` row and a bar item draw the bitmap they get and take nothing that shapes it, and
  the row's image must be a local file. This one is mostly how UIKit works, so it is likely to stay.

### 13. `in-tab/` route copies

- **What:** 51 route files under `app/(tabs)/<tab>/in-tab/` — the series, search and results pages
  under every tab, and every settings page under the Settings tab — plus a rewrite of pushes in
  `lib/nav.tsx` (`destinationHref`, `tabHref`).
- **Why:** a series page has to open inside the tab's own stack for the tab bar to stay up. A same-URL
  copy in a group captures plain pushes, so the copies need a real path segment. The settings pages
  are in the Settings tab's stack for the bar: pushed on the root stack they popped back to the tabs
  screen, whose root bar is hidden, and the bar's title drifted as UIKit hid it under the swipe
  (confirmed on a device: a page inside the tab held still, the same page on the root stack
  drifted). A page with a bottom toolbar (the add button, the select mode's verbs) hides the tab bar
  while it is on screen, since the toolbar is laid out beneath the tab bar otherwise.
- **Risks:** a new page that should live in a tab needs a copy per tab. The iOS tab table also still
  exists in more than one place (an open item from the code-patterns audit).

### 14. `BarExtent`

- **What:** a `SafeAreaListener` beside each sliding-bar page, to get the bar's full height.
- **Where:** `src/components/bar-extent.tsx`, `src/hooks/use-native-header.ts`.
- **Why:** the height the stack reports follows the bar out frame by frame, and content padded by it
  rides along under the finger. It relies on UIKit counting a transparent bar in the view's safe area.
- **The store:** the measure is kept per window size (`comical:barExtents`, persisted), and every
  screen reads it from its first frame: the tabs all mount at launch, before any bar is measured,
  and a screen padded by the stack's default (the 44pt bar; the iOS 27 bar is taller) popped down
  when its own measure landed. A shown screen's measure stands; a hidden one's only if larger.
- **Temporary trace (Blocker):** each measure goes to Settings > Diagnostics (`bar-extent` entries:
  window size, shown or hidden, the measure, what was known). Remove once the tabs' first frame is
  confirmed on a device.

### 15. Browse backdrop inside the list

- **What:** on iOS Browse draws its colour backdrop inside the list's content.
- **Where:** `BACKDROP_IN_LIST` in `src/components/content-feed.tsx`.
- **Why:** react-native-screens finds the list by walking first subviews, and anything laid in ahead of
  the list ends that walk. This replaced a module that reached into the bar, so it is the better of the
  two. The rule still applies to every tab root: **nothing renders ahead of the list.**
- **How it fails:** silent. The scroll-edge effect disappears from that screen, which shows once the bar
  has slid away: nothing backs the status bar.

### 16. Reader bar options in both modes

- **Where:** `src/components/series/reader-page.tsx`.
- **Why:** flipping `headerShown` on a modal remounts its content in react-native-screens, so the options
  stay set in both states and only the visibility moves.

### 17. Status bar through the root screen

- **What:** view-controller-based appearance (`app.json`), with each screen's wish carried up to a root
  screen's options.
- **Where:** `src/lib/status-bar.tsx`.
- **Why:** an iOS 27 SDK build ignores the app-wide calls that React Native's `StatusBar` makes, and
  mounting one on iOS now reports an error on every update. react-native-screens looks no further than
  the tab controller or a non-fullscreen modal, so a root screen must answer. Known gap: in webtoon
  mode the glyphs are always white.

### 18. Tab badge rendered only above zero

- **Where:** `src/components/app-tabs.ios.tsx:117,122`.
- **Why:** `NativeTabs.Trigger.Badge` ignores `hidden` when it has children, which showed a permanent 0.
- **Removed by:** the expo-router fix. Harmless if it stays.

### 19. Type casts at library seams

- `src/components/recycler-list.tsx:162`: `refScrollView` through `as unknown as`.
- `src/lib/nav.tsx:150,160`: in-tab hrefs through `as unknown as PushHref`, since typed routes cannot
  know a computed path. A wrong in-tab path is therefore a **runtime** failure, not a type error.
- `navigation.addListener` cast for `transitionEnd`: `app/search.tsx:319`,
  `components/reader/chapter-navigator.tsx:138`, `components/search-field.tsx:93`.

### 27. Room keep rule for R8

- **What:** `-keep class * extends androidx.room.RoomDatabase { <init>(); }`, through
  `expo-build-properties`' `extraProguardRules` in `app.json`.
- **Where:** `apps/mobile/app.json`.
- **Why:** since the SDK 58 upgrade, R8 strips the no-argument constructor from WorkManager's generated
  `WorkDatabase_Impl` (WorkManager comes in with `expo-background-task`). Room creates that class by
  reflection, so every Android release build crashed at launch in `androidx.startup`, before any of
  our code ran, with `Failed to create an instance of class androidx.work.impl.WorkDatabase.canonicalName`.
  Debug builds don't shrink and never showed it.
- **How it fails:** loudly, at launch, release builds only. Drop the rule when Room's own consumer rules
  keep the constructor again: build a release APK without it and check `WorkDatabase_Impl` still has
  `<init>()V` (`dexdump`).

## Timers standing in for a signal

Each of these guesses at something with a clock. A slow device can beat any of them. All were added on
this branch, unless marked otherwise.

| Timer | Where | What it covers | Better signal |
|-------|-------|----------------|---------------|
| 800ms | `app/search.tsx:320` | Focus the search bar if `transitionEnd` never comes | Fallback only |
| 800ms | `components/reader/chapter-navigator.tsx:139` | Treat the push as settled if `transitionEnd` never comes | Fallback only |
| `POSTER_SETTLE_MS` 200 | `components/series/reader-pane.tsx:87` | Poster stays past a page's fade-in | A fade-finished callback |
| `WARM_GRACE_MS` 300 | `components/reader/reader-page.tsx:73` | Holds a warm page's placeholder back | None known |
| `HELD_POPS` | `components/series/use-page-leave.ts:10` | A gesture's pop waits out the double-back guard | Exempt a finished gesture from the guard |
| `MOUNT_BACKSTOP_MS` 2000 | `lib/native-overlay-sheets.ts:40` | Drops a sheet whose route never mounted | Fallback only |
| `PENDING_DRILL_MS` 1500 | `lib/series-nav.ts:96` | Expires a drill held across a pop | Clear it on the pop's completion |
| `SPLIT_HANDOFF_MAX_AGE_MS` 1500 | `components/series/split-handoff.ts:61` | Expires a details to reader hand-off | Key it to the push |
| `SETTLE_MS` 250 | `components/bar-extent.tsx` | A pushed page's bar measure counts once it has held still | The bar's own settle, which nothing reports |
| `RELAYOUT_HOLD_MS` 300 | `lib/row-motion.ts` | Holds the row transition off across a width change | A list's own layout-settled callback |

**Decide:** `HELD_POPS` and `POSTER_SETTLE_MS` are the two worth replacing. The rest are fallbacks that
should never run in normal use.

Already on `main`, so not from this work: `ZOOM_BOUND_WAIT_MS`, `ZOOM_THUMB_PAINT_WAIT_MS`,
`ZOOM_OUT_BACKSTOP_MS`, `ZOOM_THUMB_BIAS_RESTORE_MS`, `POSTER_BACKSTOP_MS`, and the 800ms in
`search-field.tsx`.

## Platform limits

### 21. No bar material on the folded Duo

- **Resolved.** The gap above the bar on the Duo's folded panel (FB24859353) is gone on the current
  iOS: with the material on, the frost reaches the top, checked on a device on the tabs, a settings
  page and the series page. `useBarMaterial` gives every bar the material; `useFoldedBarEdge` and
  the hard-edge switching built on it are deleted, `nav-bar-fade`'s `edgeBacked` registration of
  the title view (item 22) with them.

## Looked at, not hacks

- `plugins/with-cmake-long-paths.js`: local Windows build tooling, gated on the host OS.
- `plugins/with-ios-orientations.js`: the supported way to set per-device orientations.
- The `xml` entry in Metro's `assetExts`: the Material Symbols drawables for the Android menu.

## The update check

Run this on every bump of Expo, expo-router or react-native-screens, on an iOS device. Most of the above
fails silently and only shows here.

- [ ] **Item 4:** with a menu open, tap a button beneath it. The menu closes and the button does not fire.
- [ ] **Item 5:** switch bridge in Browse. The bar does not pop. Open a series and go back. The icon is
      there throughout. The menu rows show pictures.
- [ ] **Item 6:** press Read on a series, and open a History row. Both zoom rather than slide.
- [ ] **Item 7:** hold a series card, release just as the menu opens. Nothing else opens.
- [ ] **Item 8:** scroll a settings page, a series details page and a Browse root. The bar slides away.
- [ ] **Item 10:** on a sidebar layout, the grid fills its column with no gap.
- [ ] **Item 14:** while the bar slides, no row moves under the finger.
- [ ] **Item 15:** a soft edge backs the status bar once Browse's bar has slid away.
- [ ] **Item 17:** in the reader, the status bar hides with the chrome.
- [ ] **Item 18:** with nothing unread, the Activity and Settings tabs show no badge.
- [ ] **Item 21:** folded, no gap above the bar, and Browse, Library and the settings pages back the bar once scrolled. Unfolded in both orientations, the frost reaches the top.
- [ ] **Item 22:** on a series details page, scroll down until the bar slides away, then up once. The
      bar slides back in while its title and frost fade in, and fades back to bare at the page's title.
- [ ] **Item 24:** on every tab, the title is large on the bar's own row beside the items and never
      shrinks to a small one; scrolled down the bar goes, scrolled up it returns over frost, bare
      again at the top. Folded, the title stays on the row while the items are in the vertical bar.
- [ ] **Item 25:** with the hold gesture bound in Settings, hold a tab's title: the beats are felt
      and the title swells with each; holding a bar button opens its menu instead.
