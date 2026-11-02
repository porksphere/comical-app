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
  walking first subviews.
- **Where:** `apps/mobile/modules/content-scroll-view/`, `src/components/screen-scroll-marker.tsx`, and
  around every screen's main list.
- **Why:** react-native-screens' legacy stack, which expo-router uses, never names the list. Its newer
  stack does, with this same call. Left to itself, UIKit found the list under one wrapper and lost it
  under two, and the bar stopped sliding. That depth limit is **observed on one device, not documented**.
- **Status: naming is unverified on a device.** The test that found this confirmed only the
  one-wrapper case. If naming does not work, every wrapped screen stays put.
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

## Shaped workarounds

These use public APIs, but the shape exists only because of a gap somewhere.

### 11. `menu-anchor`

- **What:** an invisible `UIButton` with a `UIMenu`, laid over a settings row React Native draws.
- **Where:** `apps/mobile/modules/menu-anchor/`, `src/components/settings/select-row.ios.tsx`.
- **Why:** `@expo/ui`'s menu renders pictures at 1×. This replaced the one dependency patch this branch
  ever had.
- **Removed by:** a fully native settings screen, or `@expo/ui` decoding at screen scale.

### 12. `shaped-image` and `menu-thumb-files`

- **What:** thumbnails rendered to local files with the corners baked in.
- **Where:** `apps/mobile/modules/shaped-image/`, `src/lib/menu-thumb-files.ts`.
- **Why:** a `UIMenu` row and a bar item draw the bitmap they get and take nothing that shapes it, and
  the row's image must be a local file. This one is mostly how UIKit works, so it is likely to stay.

### 13. `in-tab/` route copies

- **What:** 26 route files under `app/(tabs)/<tab>/in-tab/`, plus a rewrite of pushes in `lib/nav.tsx`
  (`destinationHref`, `tabHref`).
- **Why:** a series page has to open inside the tab's own stack for the tab bar to stay up. A same-URL
  copy in a group captures plain pushes, so the copies need a real path segment.
- **Risks:** a new page that should live in a tab needs a copy per tab. The iOS tab table also still
  exists in more than one place (an open item from the code-patterns audit).

### 14. `BarExtent`

- **What:** a `SafeAreaListener` beside each sliding-bar page, to get the bar's full height.
- **Where:** `src/components/bar-extent.tsx`, `src/hooks/use-native-header.ts`.
- **Why:** the height the stack reports follows the bar out frame by frame, and content padded by it
  rides along under the finger. It relies on UIKit counting a transparent bar in the view's safe area.

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

- **What:** the bar has no frosted material on the Duo's folded panel, only the soft scroll edge.
- **Where:** `useBarMaterial` in `src/lib/native-bar.ts`.
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
- [ ] **Item 21:** folded, no gap above the bar. Unfolded in both orientations, the frost reaches the top.
