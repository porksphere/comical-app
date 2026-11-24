# Android: Material 3 Expressive — plan

The iOS overhaul moved iOS off the shared custom chrome and onto the system's own: UIKit bars and
menus, SwiftUI forms, system sheets. Android and web were left sharing one set of custom-drawn
React Native components, many of them drawn to look like iOS (frosted menus, the sheet that pushes
the app back, the spoked refresh spinner, Apple's system tints). This plan does for Android what
that did for iOS, toward **Material 3 Expressive**, the current revision of Material 3 (Android 16).

Nothing here is built yet. Versions checked against the pins in `apps/mobile/package.json`:
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
| `@expo/ui` gaps | `TopAppBar` is the small bar only, with no scroll behaviour. No navigation rail, no short navigation bar, no reorderable list, no swipe-to-dismiss row. | Each is either drawn by the app to Material's spec or a local Expo module. |
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

## Decisions to make first

Each has a recommendation; the phases below assume it.

1. **Colour.** Recommended: wallpaper colour (Material You) on by default on Android 12+, with
   Settings → General gaining "Use wallpaper colours" and "Pure black dark theme"; when off, a
   palette seeded from the app's blue. Material's dark surface is a tinted near-black, not #000,
   which is why pure black is its own switch (`colorOverrides` on the surface roles). The
   alternative is to keep the app's own palette on every device and only express it as roles.
   The reader's chrome stays dark over the page under either.
2. **Bottom navigation.** Recommended: Compose's `NavigationBar` drawn inside the existing shell,
   with labels and Material Symbols, in place of the icon-only bar. `NativeTabs` was the iOS
   answer because UIKit moves the bar to the side by itself; on Android it never becomes a rail,
   Maestro cannot reach its items, it cannot slide away with the scroll, and it would replace the
   tab routing the series zoom and its backdrop are built on.
3. **A long press on a series card.** Recommended for now: keep it a menu, as Material's (the cover
   lifting, a `DropdownMenu` beside it, no blur). The Android convention is that a long press in a
   list selects, which chapter rows already follow; doing that for cards needs a card select mode
   that does not exist yet, so it is listed as a follow-up, not part of this.
4. **Predictive back** is switched off in `app.json` (`predictiveBackGestureEnabled: false`) and
   neither the docs nor the reachable history say why. If the reason is known, it decides phase 5.

## Phases

Each phase ships by itself and leaves the app whole. The order follows the iOS overhaul's where it
can: transient surfaces and the reader's settings first, bars and the settings screens after.

### 0. Foundations

No screen is redesigned here; colours and feedback change everywhere at once.

- `constants/material.ts`: the colour roles mapped onto the existing token names
  (`background` → surface, `backgroundElement` → surfaceContainer, `backgroundSelected` →
  surfaceContainerHigh, `overlaySurface` → surfaceContainerHigh, `accent` → primary, `accentOn` →
  onPrimary, `danger` → error, `textSecondary` → onSurfaceVariant, `hairline` → outlineVariant,
  the chip tokens → secondaryContainer), so call sites do not change. Plus the scales the theme
  lacks: shape (4, 8, 12, 16, 20, 28, full), elevation, the type scale behind `ThemedText`'s
  variants on Android, and Material's spring motion tokens for Reanimated.
- `useTheme()` on Android reads that mapping; the two preferences from decision 1 are persisted
  stores (`persisted$`) and Settings rows.
- `MaterialHost`, and the three existing Compose files moved onto it.
- `ThemeSchemeProvider` sets the window's scheme on Android too; the navigation bar's contrast
  under edge-to-edge is checked on gesture and three-button devices.
- Press feedback: one helper that gives a `Pressable` a ripple in the right role on Android, and
  the cards, chips and series buttons that only dim today take it.
- `lib/haptics.ts` maps to the platform's haptic constants on Android
  (`performAndroidHapticsAsync`) where one fits.
- The experimental Dimezis blur comes off Android (`ANDROID_BLUR`, 20 sites): Material surfaces
  are tonal, not frosted.
- The typed Material Symbols map (principle 4).
- An Android dev-client workflow beside the iOS one, since every later phase is checked on a
  device.

### 1. What pops up

Lowest layout risk, largest change in feel; everything here mounts on demand.

- **Menus.** `overflow-menu.android.tsx`'s menu becomes a root `MaterialMenuHost` that draws any
  `MenuRowSpec[]` at an anchor: hold menus, the select mode's staging menu, the Browse and Library
  title selectors, sort and filter, and the settings select row (replacing the anchored overlay
  picker on Android). Submenus nest. A `primary` row and trailing `destructive` rows are sectioned
  with dividers.
- **Sheets.** The overlay's phone sheet becomes Compose's `ModalBottomSheet` holding the same
  content through `RNHostView`; `useOverlay`'s API does not change. The pushback (the app scaling
  to 0.93 behind a sheet) goes on Android. The sheet has two resting heights, not arbitrary
  detents. The filter editors and the collection picker come with it.
- **Dialogs.** `confirm-popup` is an `AlertDialog` on Android.
- **Snackbar.** `toast` is a `Snackbar` on Android, which also gives a toast an action.
- **Reader settings.** `settings-panel.android.tsx`: `reader-settings-form.ts` drawn as one
  Compose column in that sheet — a choice as a segmented button row, a toggle as a switch, a
  stepper as the slider it already is. This is the first whole form in Compose and the
  **spike** for phase 3: its mount time and scrolling on a mid-range phone decide how far the
  settings screens go.

### 2. The shell

- **Navigation bar.** The visible bar in `app-tabs.tsx` is already not the `TabList`; on Android
  it becomes a hosted `NavigationBar`, switched through `useTabTrigger`, keeping the slide on
  scroll, the reselect scroll-to-top, the badges and the `tab.<name>` ids. `BottomTabInset`
  follows its height.
- **Rail.** `@expo/ui` has none. First cut: the existing rail drawn from Material tokens. If that
  reads as an imitation next to the bar, a local module hosts Compose's rail.
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

- Predictive back, per decision 4: the Compose surfaces follow it by themselves; the series
  layers' `BackHandler` stack is what has to be checked against it.
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

## Not in this plan

- A native top app bar. It waits on expo-router rendering react-native-screens' Stack v5.
- A select mode for series cards (decision 3).
- Web and the desktop app.
