# Native hacks: the release checklist

Every workaround the iOS native work (`feat/native-tabs-ios`, PR #157) needs, in one place, so each
one gets a decision before this ships. Compared against `main` at `8137a856f8`.

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
| 1 | react-native-screens nightly, with a Metro redirect and a tsconfig path | Pre-release dependency | Blocker | [ ] |
| 2 | Bar test screens | Throwaway code | Blocker | [ ] |
| 3 | iOS 27 SDK on a preview runner, PR lane only | Build | Blocker | [ ] |
| 4 | `menu-touch-gate` | Private class name, runtime view walk | Decide | [ ] |
| 5 | `nav-bar-leading` | Takes over a library-owned bar item | Decide | [ ] |
| 6 | `ZoomSource` | expo-router internals | Decide | [ ] |
| 7 | `system-context-menu` | Custom module, touch handler reach | Decide | [ ] |
| 8 | `content-scroll-view` and `ScreenScrollMarker` | Public API, undocumented reason | Decide | [ ] |
| 9 | `HeaderHeightContext` deep import | Package internals | Keep | [ ] |
| 10 | `unstable_nativeProps` | Unstable API | Keep | [ ] |
| 11 | `menu-anchor` | Invisible control over a React Native row | Keep | [ ] |
| 12 | `shaped-image` and `menu-thumb-files` | Bitmaps baked to shape | Keep | [ ] |
| 13 | `in-tab/` route copies | 26 duplicate route files | Keep | [ ] |
| 14 | `BarExtent` | Measuring through the safe area | Keep | [ ] |
| 15 | Browse backdrop inside the list | Layout bent around a library walk | Keep | [ ] |
| 16 | Reader bar options in both modes | Avoids a library remount | Keep | [ ] |
| 17 | Status bar through the root screen | Routing around React Native's StatusBar | Keep | [ ] |
| 18 | Tab badge rendered only above zero | Library bug | Keep | [ ] |
| 19 | Type casts at library seams | Typing | Keep | [ ] |
| 20 | Timers standing in for a signal | Time-based guesses | Decide | [ ] |
| 21 | No bar material on the folded Duo | Pose inferred around a UIKit limit | Keep | [ ] |
| 22 | `nav-bar-fade`, with a temporary trace | Animates a library-owned bar | Blocker (the trace), then Decide | [ ] |
| 23 | `nav-bar-edge` | Reads a library-owned bar's layers every frame | Decide | [ ] |

## Blockers

### 1. react-native-screens nightly

- **What:** `react-native-screens` is pinned to `4.31.0-nightly-20261030-ec16f25b7`.
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
- **Upstream:** the web stub and the `reanimated` entry are worth reporting. Neither has been filed.

### 2. Bar test screens

- **What:** diagnostic screens for the bar slide-away.
- **Where:** `apps/mobile/src/components/bar-test.tsx`, routes `app/bar-test.tsx`,
  `app/bar-test-upstream.tsx`, `app/(tabs)/settings/in-tab/bar-test.tsx`, their registrations in
  `app/_layout.tsx`, and the rows in `app/settings-developer.tsx` and `app/(tabs)/settings/index.tsx`.
- **Removed by:** deleting them once the slide-away is confirmed on a device.

### 3. iOS 27 SDK on a preview runner

- **What:** only the PR lane builds against the iOS 27 SDK, on the `xcode-27` image, which is a public
  preview. `main`, nightly and release stay on `macos-26`.
- **Where:** `.github/workflows/build-ios.yml:92`, `.github/workflows/build-ios-reusable.yml` (`runner`).
- **Why it blocks:** every iOS 27 behaviour compiles away on `macos-26`. As this stands, what gets
  tested in PR builds is **not what a release would ship**: no bar slide-away, no preferred sidebar
  placement, no vertical bar on a folded display, no opt-out from the reader's horizontal bars.
- **Removed by:** moving release to an image with the iOS 27 SDK. Choose that deliberately, either
  releasing from the preview image or waiting until it leaves preview. Then make the runner the same
  on every lane and drop the conditional.

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
  observes `leftBarButtonItems` with KVO, and sets the picture, label and menu directly on an item
  react-native-screens created.
- **Where:** `apps/mobile/modules/nav-bar-leading/ios/NavBarLeadingModule.swift`,
  `src/components/nav-bar-leading-menu.tsx`.
- **Why:** three react-native-screens behaviours together.
  - Any header config change replaces every bar item with no animation, so a menu pick tore down the
    bar.
  - Its image load is asynchronous and uncached, so the button was blank through a pop.
  - A bar item copies its menu, so async menu images never arrive.
- **Risk:** this mutates an object a library owns. It relies on the library putting a placeholder at
  `leftBarButtonItems.first` and on KVO firing when it rebuilds.
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
- **Status: naming is unverified on a device.** The test that found this confirmed only the
  one-wrapper case. If naming does not work, every wrapped screen stays put. The SwiftUI search,
  `tabBar` and `scrollToTop` are unverified too: if the search fails, the settings screens' bars stay
  put and the Settings tab's reselect scrolls nothing.
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
  `src/components/series/details-native-bar.tsx`, in every tab's `NativeTabHeader` (the material
  switching on scroll) and in `TopBar` on iOS (the pushed pages' custom title, registered for the
  folded Duo's edge).
- **Why:** react-native-screens applies header options unanimated, so the bar's title and material
  switched in one frame. UIKit's own scroll-edge crossfade was tried instead and never ran.
- **The title isn't part of it:** the series title is a custom title view that is always in the
  bar, its opacity following the scroll, so it never goes through an option change. A plain-text
  title went through one, and where the back button sits in the Duo's vertical bar an untitled bar
  collapses to no height, so the first title grew it from nothing in one frame (a trace on the
  device: 0pt at the switch, 58pt a frame later). A blank plain-text title kept the height but got
  the system's backing, a visibly empty bar. Only the unfolded material switch is faded now.
  Confirmed on a device, unfolded.
- **Folded edge backing:** the folded Duo's bar has no material (`useBarMaterial`); its backing is
  the scroll view's hard top edge. UIKit draws a scroll edge only behind what the bar registers, a
  text title but not a custom view, so the series bar was bare there. The view adds a
  `UIScrollEdgeElementContainerInteraction` (iOS 26) to the navigation item's title view, for the
  page's list (the nearest scroll view at least half the window tall), while `edgeBacked` is on:
  folded, following the title view as the bar sets it. The edge itself is switched by the list's anchor
  (`bar-scrolled`: the series bar manages its screen's edge, `'bar'`): react-native-screens' walk
  never reaches the series list, which mounts after the series loads, and a hard edge at rest drew
  a band behind the bar's empty items over the strip. The registration stays through the switch:
  one dropped at the title took the backing with it in a frame, where the edge's switch animates.
- **Temporary trace (Blocker):** the view also reports each switch to Settings > Diagnostics
  (`bar-fade` entries): the bar's height, where its content sits and what's on screen, and the
  animations running, at the switch and 50ms and 350ms after. Remove the `onTrace` event, and the
  handlers in `details-native-bar.tsx`, `native-tab-header.tsx` and `top-bar.tsx`, once the folded
  edge backing and the tabs' and pushed pages' crossfade are confirmed on a device (`material`
  entries at each switch; `edge: on` / `edge: off` entries, or why it couldn't: no title view, no
  scroll view).
- **Risk:** it animates a layer UIKit owns, and relies on KVO firing inside the library's update.
- **How it fails:** silent. If the KVO stops firing, the switch is instant again. If UIKit starts
  backing a custom title view, the bare bar shows a band over the strip. If the title view or list
  can't be found, the folded bar stays bare past the title.
- **Removed by:** react-native-screens animating option changes.

### 23. `nav-bar-edge`

- **What:** a zero-size view on Browse and Library finds the screen's navigation bar through the
  responder chain and, once a frame on a `CADisplayLink`, reads where the bar subview holding the
  title sits on screen, through its presentation layer. It reports how far that is above the lowest
  it has been (the rest, forgotten when the bar changes height), and the screen hands that to the
  sticky section header as its `barOffset` (`useNativeBarOffset`, `components/native-bar-edge.tsx`).
- **Where:** `apps/mobile/modules/nav-bar-edge/`, and the probe in `app/(tabs)/(home)/index.tsx` and
  `app/(tabs)/library/index.tsx`.
- **Why:** the section label in a tab's bar changed as a heading passed the line where the bar rests.
  The bar slides away with the scroll, so the swap landed under a bar half slid away. iOS bar
  minimization moves the bar's content, not the bar, and reports nothing, so its edge has to be read.
- **Risk:** it leans on the minimization moving the subview that holds the title view, and on a
  display link running while the tab is on screen.
- **How it fails:** silent. If the content stops moving where this looks, the offset stays 0 and the
  label changes at the bar's rest again, as before. A bar already slid away when the screen appears
  reads as at rest until it comes back once.
- **Removed by:** UIKit or react-native-screens reporting the bar's minimization progress.

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
- **Removed by:** deleting `select-row.ios.tsx` and the module once no iOS screen draws the app's
  own rows, or `@expo/ui` decoding at screen scale.

### 12. `shaped-image` and `menu-thumb-files`

- **What:** thumbnails rendered to local files with the corners baked in.
- **Where:** `apps/mobile/modules/shaped-image/`, `src/lib/menu-thumb-files.ts`.
- **Why:** a `UIMenu` row and a bar item draw the bitmap they get and take nothing that shapes it, and
  the row's image must be a local file. This one is mostly how UIKit works, so it is likely to stay.

### 13. `in-tab/` route copies

- **What:** route files under `app/(tabs)/<tab>/in-tab/` — the series, search and results pages under
  every tab, and every settings page under the Settings tab — plus a rewrite of pushes in
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

**Decide:** `HELD_POPS` and `POSTER_SETTLE_MS` are the two worth replacing. The rest are fallbacks that
should never run in normal use.

Already on `main`, so not from this work: `ZOOM_BOUND_WAIT_MS`, `ZOOM_THUMB_PAINT_WAIT_MS`,
`ZOOM_OUT_BACKSTOP_MS`, `ZOOM_THUMB_BIAS_RESTORE_MS`, `POSTER_BACKSTOP_MS`, and the 800ms in
`search-field.tsx`.

## Platform limits

### 21. No bar material on the folded Duo

- **What:** the bar has no frosted material on the Duo's folded panel. A tab's stack and every settings
  screen take the system's hard scroll edge in its place, which shows only once content is under the bar.
- **Where:** `useBarMaterial`, `useFoldedBarEdge` and `useSettingsScreen` in `src/lib/native-bar.ts`, used
  by `tab-stack.ios.tsx`, `screen-scroll-marker.tsx` and the two root layouts.
- **Why:** UIKit starts the bar below a strip at the top of that panel, and no bar background reaches
  into it, in a bare UIKit app too. FB24859353 on Apple's side, closed as a platform limit by
  react-native-screens (#4956). The other way out is a view of our own above the bar, which would not
  slide with it.
- **How it fails:** the pose is inferred, a vertical bar in a tall window. A folded pose it misses shows
  the gap; a pose it wrongly catches loses the frost.
- **Removed by:** Apple extending the bar's background.

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
      On the folded Duo the same, with the hard scroll edge behind the title in place of the frost.
- [ ] **Item 23:** on Browse, scroll down slowly from the top. The bar's title becomes the first
      section's name only once the bar has slid away, never while it is half gone; scroll back up and
      it returns with the bar.
