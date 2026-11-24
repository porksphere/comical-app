# Android: Material 3 Expressive — plan

The iOS overhaul moved iOS off the shared custom chrome and onto the system's own: UIKit bars and
menus, SwiftUI forms, system sheets. Android and web were left sharing one set of custom-drawn
React Native components, many of them drawn to look like iOS (frosted menus, the sheet that pushes
the app back, the spoked refresh spinner, Apple's system tints). This plan does for Android what
that did for iOS, toward **Material 3 Expressive**, the current revision of Material 3 (Android 16).

Phase 0 is built (see its section for what moved to later phases); the rest is not. Versions checked against the pins in `apps/mobile/package.json`:
`@expo/ui` 58.0.23, `expo-router` 58.0.26, `react-native-screens` 5.0.0-beta.1.

## Where Android stands

- Three files host Jetpack Compose: `overflow-menu.android.tsx` (the chapter row's ⋮ menu) and the
  two sliders (`range-slider.android.tsx`, `int-stepper.android.tsx`). Everything else is the
  custom view web also draws.
- Ten `.ios` files have no Android sibling: `app-tabs`, `tab-stack`, `add-fab`, `select-pill-bar`,
  `settings-list`, `settings-panel`, `series-card-menu`, `int-stepper`, `range-slider`,
  `zoom-cover-copy`.
- There is no Material theme: no colour roles, no dynamic colour, no shape, type or motion scale.
  `constants/theme.ts` has one fixed palette (pure black, an iOS blue accent, raised surfaces
  sampled from iOS); radii and shadows are set per file.
- A forced light or dark theme never reaches the Android window (`ThemeSchemeProvider` calls
  `Appearance.setColorScheme` on iOS only), and each Compose host is handed its scheme and colours
  by hand.
- The models the iOS renderers read already exist and are the seam for this work:
  `settings-form.ts`, `reader-settings-form.ts`, `MenuRowSpec`, `SelectVerb`, `TopBarAction`.

## What the pinned packages give Android

Read from the packages' source, not from memory.

| Piece | On Android | Verdict |
|---|---|---|
| `@expo/ui/jetpack-compose` | Compose Material 3 1.5.0-beta01; every `Host` is wrapped in `MaterialExpressiveTheme` with wallpaper colours on Android 12+, or a `seedColor` / `colorOverrides`. Ships `NavigationBar`, `DropdownMenu`, `ModalBottomSheet`, `AlertDialog`, `Snackbar`, `FloatingActionButton` (four sizes), `HorizontalFloatingToolbar`, `ListItem`, `Switch`, segmented buttons, `ToggleButton`, chips, `SearchBar`, `LoadingIndicator`, `LazyColumn`, `RNHostView`. `getMaterialColors()` hands the palette to JS synchronously. | The route. It is to Android what SwiftUI and UIKit were to iOS. |
| `@expo/ui` gaps | Its `NavigationBar` is Compose's original 80dp bar, not Expressive's `ShortNavigationBar`, and there is no navigation rail. `TopAppBar` is the small bar only, with no scroll behaviour. No reorderable list, no swipe-to-dismiss row. | Each is either drawn by the app to Material's spec or a local Expo module. expo-modules-core's Compose views (`ExpoComposeView`), which `@expo/ui` is itself built on, are open to a local module. |
| expo-router `NativeTabs` | Material Components' `BottomNavigationView` (a View, not Compose), dynamic colours, badges. Never a rail. Its `testID` is a view tag Maestro cannot read. | Not taken: see Navigation. |
| Stack header (the legacy stack expo-router renders) | An AppCompat `Toolbar` with scroll flags of 0. Large titles, hide on scroll and native bar menus are all no-ops on Android. | Not taken. |
| react-native-screens "Stack v5" | `MaterialToolbar` in a `CollapsingToolbarLayout`, scroll flags, native toolbar menus, predictive back. Marked experimental, and expo-router 58 does not render it. | Watch. It is the native top bar, once expo-router adopts it. |
| expo-router `Stack.Toolbar` on Android | Compose icon buttons and a `DropdownMenu` laid into the legacy header's left and right views. | Not needed without that header. |
| `formSheet` | Material `BottomSheetBehavior`; no nested stack on Android. | Not taken: Compose's sheet is. |
| Link zoom, `Link.Preview`, `Link.Menu` | iOS only. | The app's own zoom stays. |

## Principles

1. **One model, three renderers.** The base file stays as web's and the desktop's; Android gets a
   `.android.tsx` sibling reading the same model, with its line in `platform-contracts.ts`. A
   renderer's switch over field kinds is complete or the typecheck fails, as on iOS.
2. **What pops up is Compose; what scrolls is React Native.** Menus, sheets, dialogs, the snackbar,
   the navigation bar, the FAB and the selection toolbar are Material's own components. Lists,
   cards, chips and anything a list holds by the dozen stay React Native views, drawn from Material
   tokens. A `Host` is costly to mount (`IntStepper` already waits 600ms for its own), so: few
   large hosts, mounted on demand, never one per row.
3. **One palette.** A single `MaterialHost` wrapper gives every Compose island the scheme, seed and
   overrides; `useTheme()` on Android is derived from the same `getMaterialColors()` result, so a
   React Native row and the Compose switch on it cannot disagree.
4. **Icons.** Lucide in React Native content, as now. Material Symbols where a Compose component
   draws its own items, the way SF Symbols stand in on iOS. A row still names its glyph once:
   `material-symbols.ts` pairs each SF name with a drawable. It maps 8 today against about 35 SF
   names in use; the map becomes typed on the union of those names so a missing pair is a
   typecheck error, not a blank icon.
5. **A missing native behaviour gets a local Expo module, never a patch.** Unchanged.
6. **Test ids survive.** A Compose item carries its row's id as a test tag, which Maestro reads
   (`series.chapter-menu.*` already works this way). 30 of the 31 mobile flows tap `tab.<name>`.
7. **Web does not move.** No base file changes its look for web in this work.

## Decisions

Settled:

1. **Colour.** Wallpaper colour (Material You) on by default on Android 12+, with Settings →
   General gaining "Use wallpaper colours" and "Pure black dark theme"; when off, a palette seeded
   from the app's blue. Material's dark surface is a tinted near-black, not #000, which is why
   pure black is its own switch (`colorOverrides` on the surface roles). The reader's chrome stays
   dark over the page under either.
2. **Bottom navigation.** A Compose navigation bar drawn inside the existing shell, with labels and
   Material Symbols, in place of the icon-only bar — and it is Expressive's bar,
   `ShortNavigationBar`, which `@expo/ui` does not ship, so it comes from a local module (phase 2).
   `NativeTabs` was the iOS answer because UIKit moves the bar to the side by itself; on Android
   it never becomes a rail, Maestro cannot reach its items, it cannot slide away with the scroll,
   and it would replace the tab routing the series zoom and its backdrop are built on.
3. **A long press on a series card** stays a menu, as Material's (the cover lifting, a
   `DropdownMenu` beside it, no blur). The Android convention is that a long press in a list
   selects, which chapter rows already follow; doing that for cards needs a card select mode that
   does not exist yet, so it is a follow-up, not part of this.

4. **Predictive back** goes on. It is switched off in `app.json`
   (`predictiveBackGestureEnabled: false`) for no reason the docs or the reachable history give.
   The flag flips in phase 5, with the back handlers checked on a device, not before.

## Phases

Each phase ships by itself and leaves the app whole. The order follows the iOS overhaul's where it
can: transient surfaces and the reader's settings first, bars and the settings screens after.

### 0. Foundations (built)

No screen is redesigned here; colours and feedback change everywhere at once.

- `constants/material.ts`: the colour roles mapped onto the existing token names
  (`background` → surface, `backgroundElement` → surfaceContainer, `backgroundSelected` →
  surfaceContainerHighest, `overlaySurface` → surfaceContainerHigh, `accent` → primary,
  `accentOn` → onPrimary, `danger` → error with a new `dangerOn`, `textSecondary` →
  onSurfaceVariant, the hairlines → outlineVariant, the chip tokens → secondaryContainer), so
  call sites do not change. The status colours and the prints' paper keep the app's own. Plus the
  scales the theme lacked: shape, elevation, state layers, and Expressive's spring motion scheme
  for Reanimated.
- `useTheme()` on Android reads that mapping (`lib/material-colors.android.ts` reads the palette,
  again each time the app comes back, since the wallpaper can change meanwhile). The two
  preferences from decision 1 are one persisted store and two rows in Settings → General.
- `MaterialHost`, and the three existing Compose files moved onto it. The sliders take Material's
  own colours now.
- `ThemeSchemeProvider` sets the window's scheme and background on Android too.
- `useRipple`: Material's pressed state layer for a `Pressable`. Every existing ripple and the
  chips take it.
- `lib/haptics.ts` asks for the system's feedback effects on Android (`performAndroidHapticsAsync`,
  the four constants every Android version has), where expo-haptics' own calls are raw vibrator
  waveforms that ignore the user's touch-feedback setting.
- Floating surfaces are opaque on Android (`FROSTED` in `context-menu-material.tsx`). expo-blur
  draws no blur there without a blur target, which none of these named, so the "frosted" menus,
  toast and pills were see-through tints over the page.
- `material-symbols.ts` is typed: `MenuRowSpec.symbol` and `SelectVerb.symbol` take only names
  with a drawable.
- `build-android-devclient.yml`, beside the iOS one. Not run yet: a manual workflow can only be
  dispatched once its file is on the default branch.

Moved out of this phase, because each needs a device to judge:

- The type scale behind `ThemedText` (phase 4): line heights feed layout constants throughout.
- Ripples on series cards and the series page's buttons (phase 4): a cover is a book's shape and
  a round button's pressable includes its label.
- The navigation bar's contrast on gesture and three-button devices: to be looked at on the first
  dev-client build.

### 1. What pops up (built)

Lowest layout risk, largest change in feel; everything here mounts on demand. Each surface is a
platform pair: a base stub and an `.android.tsx` the host picks on Android.

- **Menus.** `MaterialMenu` (`components/material-menu.tsx`) draws any `MenuRowSpec[]` as
  Material's dropdown, hung from the view it is laid over; a `primary` row and trailing
  `destructive` rows are divided off, and an `active` row is checked. The chapter row's ⋮ and
  every `openContextMenu` request (`material-context-menu.android.tsx`: hold menus, the select
  mode's staging menu) use it. Nothing is peeked under a held finger on Android: the menu opens
  and a row is tapped.
- **Sheets.** An overlay item that is a sheet is Compose's `ModalBottomSheet` holding the same
  React Native content through `RNHostView` (`overlay/material-overlay-sheet.android.tsx`);
  `useOverlay`'s API does not change. The page neither dims nor scales back under one. The
  settings select row, the filter editors and the reader's settings all arrive this way.
- **Dialogs.** `confirm-popup` is an `AlertDialog` (`material-confirm.android.tsx`), the verb and
  Cancel its two text buttons; `useConfirmRun` is the async and error handling both renderers
  share.
- **Snackbar.** `toast` is a `Snackbar` (`material-toast.android.tsx`), with Material's two
  lengths in place of the request's own.
- **Reader settings.** `reader-settings-fields.android.tsx`: `reader-settings-form.ts` drawn as
  one Compose column inside the sheet — a choice as segmented buttons, a toggle as Material's
  switch, a stepper as the slider.

What the reader settings showed for phase 3 (the **spike**): a Compose column sized to its content
(`matchContents`) inside a React Native scroller works. It lays out, its controls take taps, and
the scroller scrolls with a finger on it. How long it takes to mount could not be judged on
software emulation and still has to be timed on a phone.

Moved out of this phase:

- The Browse and Library title selectors and the sort and filter menus (to phase 2): they are
  option lists with thumbnails and sections, not `MenuRowSpec` rows, and hang from the bars that
  phase redraws. On a phone they are still the app's own popover, or a Material sheet when long.
- The collection picker: a floating card of its own, not an overlay item. It is opaque now and
  otherwise unchanged.

Not checked: the mobile Maestro flows against these surfaces (each control keeps its id as a
Compose test tag, and `confirm.cancel` is now the Cancel button, not the backdrop), and whether a
drag down from the top of a sheet's list takes the sheet with it.

### 2. The shell

- **Navigation bar and rail.** A local module, `modules/material-navigation`, hosts Expressive's
  two navigation components: `ShortNavigationBar` on a compact window and `WideNavigationRail` on
  a wider one, where the app draws its own icon rail today. One module, one set of items (icon,
  selected icon, label, badge, test tag), themed from the same palette as every `MaterialHost`.
  The visible bar in `app-tabs.tsx` is already not the `TabList`, so on Android it becomes that
  view, switched through `useTabTrigger`, keeping the slide on scroll, the reselect
  scroll-to-top, the badges and the `tab.<name>` ids. `BottomTabInset` follows its height.
  The module repeats `@expo/ui`'s Compose and Material 3 versions, checked in CI the way
  `check:android-host-deps` checks the runtime's.
- **Top bars stay React Native, drawn to Material's spec.** No native bar open to expo-router
  collapses or scrolls (see the table), and the custom bars already behave as Material's
  enter-always bar does (`use-sliding-bar`). What changes: the role colours, the bar taking
  surfaceContainer once content is under it in place of the hairline (`bar-scrolled` gets a
  React Native source), 48dp targets, ripples, Material's type for a pushed page's title. The
  tabs' titles keep the title typeface.
- **Search.** `search-field` drawn as Material's search bar; the field stays a React Native
  `TextInput`.
- **FAB.** `add-fab.android.tsx`: Compose's floating action button.
- **Select mode.** `select-pill-bar.android.tsx`: `HorizontalFloatingToolbar`, which is what the
  component is for, the single-verb case in its FAB slot.
- **Pull to refresh.** The gesture stays (`use-touch-pull-to-refresh`); the spoked spinner is
  replaced on Android by Material's `LoadingIndicator`, driven by the same progress. This reverses
  the note in `use-pull-to-refresh.ts` that one overlay everywhere beats Material's on Android.

### 3. Settings screens

`settings-list.android.tsx`, in the two steps iOS took.

- **Row-only screens first** (toggle, select, link, action, value, note, text, stepper, chips):
  one host per screen, a `LazyColumn` of `ListItem`s in Android 16's grouped style, a `custom`
  field through `RNHostView`.
- **List screens** (a section that reorders, swipes, selects or is unbounded) stay on the app's
  renderer, drawn from the same tokens and metrics as `ListItem`, because `@expo/ui` has neither a
  reorderable list nor a swipe row. A screen with any such section uses the app's renderer whole,
  so one screen is never two renderers.
- If the phase 1 spike shows a hosted form mounting too slowly, this phase is instead the app's
  renderer restyled, with Compose controls only where a row opens one (a menu, a dialog).

### 4. Content

React Native views throughout; this is tokens, shape and motion.

- Cards, chips, badges, empty and retry states, the series page's buttons, skeletons.
- `ActivityIndicator` (43 uses) tinted from the palette; full-page loads take `LoadingIndicator`.
- `SettingsTint`'s Apple palette replaced on Android.
- The series card's hold menu, per decision 3.
- The series zoom is already a container transform and stays; its corner and easing take the
  motion tokens. The reader's page chrome keeps its own dark ink.

### 5. The system

- Predictive back turned on (decision 4). What it buys here: the home screen showing behind the
  app as a swipe back is about to leave it, and Compose's sheets, menus and dialogs following the
  finger. It does not preview one screen behind another: the stack expo-router renders has no
  support for that (Stack v5 does). What has to be checked: the opt-in changes how back reaches
  the app, and the popups, the series layers, the reader and the search layer each handle back
  themselves through `BackHandler`, in a set order.
- The Glance widgets: the hard-coded colours (`#1A1A1A`, `#2563EB`) become theme roles, in
  `docs/WIDGETS.md` first.
- Splash background by theme.
- AGENTS.md gains the Android section these rules add up to; `docs/ARCHITECTURE.md`'s line that
  the tab bar is one component on every platform is corrected.

## Risks

- **Host cost.** The one thing that can change the plan's shape. Measured in phase 1 before phase
  3 depends on it.
- **A beta under a beta.** `@expo/ui` builds on a beta of Compose Material 3 (1.5.0 is stable
  now), beside the react-native-screens beta the app already carries. Each `@expo/ui` bump is a
  device check.
- **React Native inside Compose.** `RNHostView` documents touch workarounds, and a `Host` nested
  directly in another's content mis-measures. The sheet is the first place this is exercised.
- **Two looks on one platform, mid-way.** Between phases an Android screen mixes Material and the
  old chrome. Phase 0's colours make the old chrome sit in the new palette, which is most of what
  the eye catches.
- **Flows.** 14 Android-only blocks in the mobile flows tap controls this work replaces (mostly the
  reader settings' segments). Each phase updates the flows it breaks; the e2e workflow is manual,
  so it has to be run.
- **Nothing here can be checked without a device.** The emulator in CI is software-rendered and
  slow; the dev-client workflow in phase 0 exists for that.

## Looking at it without a device

Each phase is screenshotted on a local emulator, including on a machine with no hardware
virtualization (a cloud container), where it is slow but works. What that takes, since none of it
is obvious:

- **The build:** `expo prebuild --platform android`, then
  `./gradlew assembleRelease -PreactNativeArchitectures=x86_64` with
  `EXPO_PUBLIC_COMICAL_DEMO_MODE=1` (mock data, no server) and `SENTRY_DISABLE_AUTO_UPLOAD=true`.
  One ABI is about a third of the native compile: 27 minutes cold on four cores, three for a
  JS-only change. Don't run the emulator beside a cold build; together they ran out of memory.
- **The image:** `system-images;android-34;aosp_atd;x86_64`. It boots in under five minutes on
  software CPU emulation, which the emulator only does with `ANDROID_I_WANT_MY_TCG=yes` and
  `-accel off`.
- **It draws nothing until told to:** the ATD images ship with
  `debug.hwui.drawing_enabled` off, so every capture is black until
  `adb shell setprop debug.hwui.drawing_enabled 1` (before the app starts; it resets each boot).
- **The renderer:** `-gpu swangle_indirect`. On `swiftshader_indirect` the emulator's own render
  thread segfaulted on Browse and the series page. `-feature -Vulkan` as well: the home
  bookshelf's WebGPU device took the emulator down, and without Vulkan the app shows the rails in
  its place.
- **Memory:** an incremental rebuild fits beside the running emulator; a typecheck or lint
  beside a build does not. One heavy thing at a time.
- **Taps are slow to land.** `adb shell input` takes seconds to start, so a chain of taps fired
  blind lands on whatever the screen has become. Capture after each step and aim the next from
  the capture; a toast has to be caught with a burst of captures started with the tap.
- **Logs:** `console.warn` in a release build reaches `adb logcat` under `ReactNativeJS`, which is
  the quickest way to see why something native-facing did nothing.
- **Quiet:** `settings put global hide_error_dialogs 1` (the system raises "isn't responding"
  dialogs at this speed), animations scaled to 0, and `pm disable com.android.bluetooth`, which
  otherwise restarts in a loop.
- **Covers** need the machine's outbound proxy CA trusted by the emulator, where there is one:
  as root, the certificate at `/data/misc/user/0/cacerts-added/<subject_hash_old>.0`. The app
  trusts user CAs (`with-user-server-network`).
- Expect a tap to take half a minute to land, and the app two to three minutes to start.

## Not in this plan

- A native top app bar. It waits on expo-router rendering react-native-screens' Stack v5.
- A select mode for series cards (decision 3).
- Web and the desktop app.
