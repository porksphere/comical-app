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

# Platform files are checked against their base

tsc resolves every import to the base file (no `moduleSuffixes`), so a `.ios`/`.android`/`.web`
sibling is never checked against what its callers pass. `src/types/platform-contracts.ts` closes
that: each sibling has a line there, and a dropped export, a changed type, or a prop the base
gained that the sibling never declared fails the typecheck. Give a new platform file its line.
Prefer taking the base's own props type (`series-card-menu.ios.tsx`, `select-row-shared`); a
sibling with its own props lists what it deliberately goes without in its line, so every platform
gap is written down in one place.

# Bottom nav: the system bar on iOS, a custom-rendered bar on Android and web

`apps/mobile/src/components/app-tabs.ios.tsx` is the iOS shell: `NativeTabs`
(`expo-router/native-tabs`) over the real `UITabBarController`, so UIKit itself moves the
bar to the side as a symbol-only column on a regular-width resizable scene and to a sidebar on iPad.
That is the whole reason it exists — a custom bar can only imitate that adaptation. The bar never
minimizes (`minimizeBehavior="never"`), as in most of Apple's own apps: iOS 26's `onScrollDown`
collapsed it to the selected item and re-expanded it only at the very top or on a tap, which is
UIKit's design (react-native-screens #3954), not a list bug — the earlier native shell chased
mid-scroll re-expansion for days and reverted, so don't. The scroll view the bar follows (for the
status bar's tap-to-top) is registered by
`ScreenScrollMarker` (react-native-screens' `ScrollViewMarker`, keyed with the list
it wraps) around each tab ROOT screen's list, under `TabRootScrollContext` from the tab's stack —
never a pushed page's: the registration is a hand-off to UIKit nothing takes back. That part
reaches the TAB screen only, never the stack screen holding the navigation bar. That screen is
told by the local module `apps/mobile/modules/content-scroll-view`
(`UIViewController.setContentScrollView`), because a list under wrappers goes unfound by UIKit and
the bar never slides away from it. So EVERY screen's main list goes through `ScreenScrollMarker`,
pushed pages and the series details included, or that screen's bar stays put; a page that is one
ScrollView uses `ScreenScrollView`. The reader takes no marker: its bar never slides. The screen also
finds the list by a walk of its own, each first subview down from it, to put its iOS 26
scroll-edge effect on the list. Every bar but the reader's has the system's frosted material
(`useBarMaterial` in `lib/native-bar.ts`, in each stack's `screenOptions`): UIKit never once
switched these bars from a bare scroll-edge appearance to the frosted standard one, with or without
the list handed to it, so there is no "bare until scrolled" to be had natively. The tab roots and
the pushed pages make their own (`components/bar-scrolled.tsx`): each stack's `screenLayout`
provides a screen's `scrolled`, the content-scroll-view anchor under the screen's list reports it
natively (a few points past the top, crossings only; `ScreenScrollMarker` for a React Native
list, the settings form for its SwiftUI one), and `TopBar` sets the material as an option on a
pushed page — `none` over the top of the page, the material once content is under the bar —
with `nav-bar-fade` crossfading the switch, as on the series page. The system's soft scroll edge
is hidden on those screens (`HIDDEN_TOP_EDGE`): UIKit fades it in behind the bar's buttons as
content slides under, a half-backed bar for the first points, and cuts it the instant the list is
back at the top. A pushed page's title is a custom title view (`barTitleStyle`), centred by UIKit,
where a plain-text title sat at the leading edge; a text title is also what UIKit registers with
that edge, which drew it behind the title. The tabs' bars are Photos' tab bars: UIKit's
large title on the bar's own row at the leading edge, in its `inline` display mode (the local
module `modules/nav-bar-large-title`, since react-native-screens sets only `always`, a row of its
own under the items that collapses into the inline title on scroll), never collapsing; the items
at the trailing edge; bare over the top of the page (a transparent large-title background, the
bar's scroll-edge appearance) and the material once content is under it (the standard
appearance), switched by UIKit on the list the screen hands it; and the whole bar, title and
material, sliding away on a scroll down and back on a scroll up (`NativeTabHeader`). The system
soft edge is hidden there; the material is the backing. The content pads by the bar's resting
extent as before (`bar-extent`), the title's row included. The series details' bar: bare over the
strip, the series' title a custom title view always in the bar that fades in, centred, with the
scroll as the page's own title (the tabs' heading metrics) goes under it (never an option: UIKit
draws a blank or whitespace text title as quotation marks, and where the back button sits in the
Duo's vertical bar an untitled bar collapses to no height), and the material switched as an option
once that title is past, on the way back up only, crossfaded by the local module
`modules/nav-bar-fade` (`components/series/details-native-bar.tsx`); its bar keeps the list's
edge hidden (`'bar'` in `bar-scrolled`). The folded iPhone Duo's bar takes the material like any
other: the gap above it (FB24859353) is gone on the current iOS, checked on a device. The soft
edge stays on under the material, which hides it while the bar is there; it backs the status bar
once the bar has slid away. Nothing
may be laid in ahead of the list there, so on iOS
Browse's colour backdrop is drawn inside the list's content, behind its rows (`BACKDROP_IN_LIST`
in `components/content-feed.tsx`). Liquid Glass bars tint from the
WINDOW's interface style, not from the content, so `ThemeSchemeProvider` mirrors the theme
preference into `Appearance.setColorScheme` on iOS — without that a dark theme sits over a light
window and the bar glares white. It is
the one place SF Symbols are used instead of lucide, because the system bar draws its own items. Its
triggers are named by ROUTE (`(home)`, `library`, …); the custom shell's `TABS` table keys by tab name
(`browse`, …), and `app-tabs.ios.tsx` maps between the two for scroll-to-top. Per-tab safe-area
insets already include the system bar, so `BottomTabInset` is 0 on iOS and `useHideTabBarOnScroll`
leaves `tabBarProgress` at 0 there; a ROOT overlay (toast, request pill, card context menu) pads by
`RootTabBarInset` instead, since the root provider's insets don't know about the bar. The bar has no
testIDs, so the Maestro `tab.<name>` taps are Android/web only.

The TOP bar follows the same split (`apps/mobile/src/hooks/use-native-header.ts`, `NATIVE_HEADER`):
on iOS each tab directory is its own native Stack (`components/tab-stack.ios.tsx`; a plain `Slot`
elsewhere), so the tab screen gets a UINavigationBar INSIDE the UITabBarController — which is
what lets UIKit carry its toolbar items into the side column together with the tabs. Those screens
render `Stack.Title` / `Stack.Toolbar` / `Stack.SearchBar` items instead of `TabTitleBar`. Every
pushed settings-reachable screen (categories, bridges, registries, downloads, …) is registered
with `useSettingsScreen()` (`lib/native-bar.ts`) so it takes the system bar; its `TopBar` then IS
that bar on iOS — it retitles it and renders the structured `actions` as trailing
`Stack.Toolbar.Button`s (an SF Symbol, or the Select / Done words from `useSelectToggle`),
and draws the custom overlay with the same actions as lucide buttons elsewhere. The system bar
draws its own items, so its `Stack.Toolbar.Button`/`MenuAction` icons are SF Symbols too, and it
has no testIDs either: `screen-title.*`, `*.search-icon`, `browse.bridge-selector`,
`library.collection-selector` are Android/web only. Content pads by `useTopChromeHeight()` (the
native bar's height on iOS, status bar + custom overlay elsewhere), so a screen swaps bars without
relayout. Android and web keep the custom `TopBar`/`TabTitleBar` overlay.

The iOS status bar belongs to the view controllers (`UIViewControllerBasedStatusBarAppearance` in
app.json): a build against the iOS 27 SDK ignores the app-wide calls React Native's `StatusBar`
makes, so never mount it (or expo-status-bar's) on iOS — under this appearance it reports an
error on every update. A screen sets its glyphs or hides the bar with `ScreenStatusBar`
(`lib/status-bar.tsx`), which on iOS asks the ROOT stack's screens to carry it, since iOS asks
the root stack and react-native-screens looks no further than the tab bar controller or a modal
that is not full screen. Elsewhere it is expo-status-bar's.

What goes IN the iOS bar follows Apple's tiering, not the custom bar's row. The bar holds the
tab's large title, its menu and the search (`NativeTabHeader`, above). The BAR slides away
as the content scrolls down and back as it scrolls up: iOS 27's bar
minimization, the way Settings' own pages behave, asked for on every tab and pushed bar
`SLIDE_AWAY_BAR` in `lib/native-bar.ts`, react-native-screens' header config through
expo-router's `unstable_nativeProps`). The props come with react-native-screens 5.0, on its BETA
here (`5.0.0-beta.1`, npm's `next`) until it ships stable, and so do the tsconfig line pointing its `reanimated` types at the folder
its build writes them to and the `metro.config.js` redirect that sends web to its TurboModule
stub (without it web crashes at load). The reader's bar never slides (`never`): it follows the chrome. The title names the view on Browse ("<bridge> <page>") and
Library ("<view> <kind>", the kind only while the view holds more than one), and is the tab's
name elsewhere; on every tab it is also the NSFW hold target, because the bars hold only SYSTEM
items and a `UIBarButtonItem` has no long-press of its own (holding one opens its menu): the
title is UIKit's text, so the local module `modules/nav-bar-hold` reads the bar's touches on its
label and reports the press and its end to the same ramped hold (`useHoldAction`). Each has ONE
`Stack.Toolbar.Menu`, leading the title on a portrait window, where Android's and web's
selector sits (`useMenuLeads`), and elsewhere (a phone on its side, the Duo folded or open, all of
which lay the bar out as a side column) among the trailing items: Browse's in a glass group of its own, a zero-width
`Stack.Toolbar.Spacer` splitting it from the search (UIKit splits one placement's shared glass at
a fixed space), the Library's in one group with the arranging `⋯` menu, what the tab shows and
how it is arranged, with the system search item in its own group at the edge,
flat — inline sections, never submenus, so every pick is open and tap — Browse the current
bridge's thumbnail as a circle over the bridges and then the pages as checkmarked rows
(`components/browse-native-toolbar.tsx`), Library the view's mark (the
collection's initial, All's asterisk) with the views and "Manage collections…" and then the
kind, Series / Chapters / Pages, as a second section while the view holds more than one
(`LibraryCollectionMenu` in `components/library/library-native-toolbar.tsx`) — so UIKit lays
the bar out itself (an image item joins the vertical bar of a folded or landscape display). The
image button keeps its Liquid Glass capsule: a bare circle
(`hidesSharedBackground`, the way a round account picture is itself the button in Apple's bars)
was tried and dropped, because the capsule is what morphs into the pushed series page's back
button, and a bare circle left that button growing out of nothing. (The capsule comes off a
plain image item that way, but NOT off a custom-view item — a title-slot cluster of RN views
was tried and could not be made bare, which is why nothing custom stands in the bar any more.)
A menu row takes its
image only as a local FILE it reads itself, so `lib/menu-thumb-files.ts` renders each bridge
thumbnail (or the bundled Comical asset) down to a 28pt PNG at the screen's scale once per
session; the navigation bar's items and menus read it through React Native's loader as a plain
image, so the SHAPE is in the file: the local Expo module `apps/mobile/modules/shaped-image`
(Swift, iOS only, `null` elsewhere) clips a rendered tile to a corner or a circle and
`menuThumbFile(source, radius)` keeps one file per shape. Neither tab's menu button
or menu is in the header config, though: react-native-screens replaces EVERY bar item,
unanimated, on any change to the config, so a pick that changed the button's picture and the
rows' checks popped the whole bar. Both render `NavBarLeadingMenu`
(`components/nav-bar-leading-menu.tsx`), which gives the config a placeholder that never
changes and hands the live picture, label and menu (inline sections of rows) to the local
module `apps/mobile/modules/nav-bar-leading`, a zero-size view in the page that sets them on
that item in place (found among the bar's items, either side, by the placeholder's label), and again whenever the items are rebuilt,
as they are on every return to the screen. It decodes the files itself: through React Native's loader the bar reads one off
the main thread, uncached, so the button was blank for the first part of every pop back, and a
menu row's never showed, landing after the menu was built (a bar item keeps a copy of its
menu). Without the module the menu goes back into the config. A row without art shows its initial
as an SF `x.square.fill` (`lib/initial-symbol.ts`; `x.circle.fill` for a bar button), and the
All view an `asterisk` — the other place SF Symbols stand in for lucide. The native bar has NO
sticky-header primitive (no title menu, palette or scope bar in react-native-screens 4.30), so
the page picker is a menu in the bar, not a strip under it. Nothing pins under the bar at all:
every surface tried there failed (a band floated, a scrim running up to the bar read as a second
bar, a glass capsule hugging the heading was a badge drifting over the covers), so on iOS
`StickySectionHeader` draws nothing (`IN_BAR`); the inline headings scroll away like any other
row. (A section's label taking the bar's title, measured against the bar's slide by a module
reading the bar's layers, was built and dropped with the title itself.) A series opened from a tab is a real pushed card of that tab's stack (route
`in-tab/series/index` — the tab's `in-tab/series/` directory has no layout on purpose, so the
page IS the pushed screen and its `Stack.Screen` addresses it), so the tab's leading item morphs into its
back button and the slide and edge-pop are the system's; `useNativePush` in
`components/series/viewport.ts` is what the zoom rig gives up there.
The settings screens themselves are ONE model and two renderers, the reader's pattern below:
`components/settings/settings-form.ts` is a screen's sections of fields (toggle, select, link,
action, value, note, custom), the only place a row is added, with `fieldTestID` giving each row
the id its component had; `settings-list.tsx` draws them as the app's cards and rows (Android, web,
the desktop panes) and `settings-list.ios.tsx` as a SwiftUI `Form` filling the screen under the
system bar, its rows the system's switches, menu pickers, buttons and label–value rows, a `custom`
field hosted in a row through `RNHostView`. Each renderer's switch over the kinds is complete or the
typecheck fails. Every settings screen is on it, the list screens and Downloads included: a
section with `onReorder` is a draggable list (the app's `ReorderableList`; SwiftUI's `List.ForEach`
move), a `link` row's `actions` are its swipe actions (`SwipeableSettingsRow`; SwiftUI's
`SwipeActions`), and a section's `selection` is the screen's select mode (the animated check
circle on the app's rows; a check circle the iOS row draws, since the form never enters the
list's edit mode). A section that is `unbounded` (Downloads, a series' chapters) is the screen's
recycled list on the app's renderer, plain rows with the other sections around them, where a drag
down the check circles sweeps; the iOS form is lazy already. A list's `focus` names a row to bring into view and mark for a moment, what the
screen was opened to show (`use-focus-row.ts`). A `text` field is the system's text or secure field on iOS, a `stepper` its
stepper, a `multi` field the overlay's checklist everywhere (a system menu holds one check).
The chrome around a list follows: the add button (`components/add-fab.tsx`) and the select
mode's verbs and staging menu (`components/multi-select/select-pill-bar.tsx`) are the floating
button and pills on Android and web, and on iOS the screen's system bottom toolbar
(`add-fab.ios.tsx`, `select-pill-bar.ios.tsx`: `Stack.Toolbar placement="bottom"`, which hides
the system tab bar while it is on screen, since UIKit lays the toolbar out beneath the tab bar; a
`SelectVerb` and a `MenuRowSpec` carry the SF `symbol` the toolbar draws). On iOS the settings
pages pushed from the Settings tab open INSIDE that tab's stack (their copies under
`app/(tabs)/settings/in-tab/`, `SETTINGS_PATHS` in `lib/nav.tsx`): popped on the root stack they
landed on the bar-less tabs screen and the bar's title drifted as UIKit hid it under the swipe. A selecting row on iOS is plain content
with tap and hold gestures, not a button: a long press on a SwiftUI button swallows its tap.
A bridge's or tracker's descriptors become fields through `useDescriptorFields`
(`components/settings/setting-field.tsx`), one hook holding every sign-in row's state by key;
`bridge-extras.tsx` gives the per-bridge sections as hooks. Colour is one rule: the thing that
acts is tinted (an action's `verb` where it has one, else its label; red when destructive) and
nothing else, which the iOS renderer names explicitly since a SwiftUI button tints its label and a
hierarchical style inside one resolves against that tint. On iOS the enum rows are the form's menu
pickers, so the select row (`SettingsSelectRow`, `select-row-overlay.tsx`, the anchored overlay
picker) is reached only through the app's own renderer, on Android and web. (An iOS row of the
app's own, with a local `menu-anchor` module laying an invisible UIButton's UIMenu over it, was
built for the days before the form and deleted with them; `@expo/ui`'s SwiftUI `Menu` before that
needed a vendored patch to decode pictures at the screen's scale, which is why it went: a missing
native behaviour gets a local Expo module, never a patch, and the repo carries none.) On iOS 26 the tap that closes any
of these UIKit menus is hit-tested through to the view beneath, and React Native's touch handler
(a gesture recognizer, which UIKit does not suppress) would press it: the local module
`apps/mobile/modules/menu-touch-gate` (an app-delegate subscriber, no JS) puts a window-level
recognizer in at launch that has that handler ignore touches while a menu's container is on the
window — the same gate expo-modules-core ships but installs only from its SwiftUI host view,
which these menus never mount. A UIKit menu has no second line, so an OPTION's `description` is not
shown on iOS, and the option test ids (`settings.select.<label>.option.<value>`) are not
reachable there — only the row's. Multi-select enum fields (`MultiEnumRow` in
`setting-field.tsx`) stay on the overlay everywhere: a system menu can't hold several checks.
Long-press menus are the system's context menu on iOS, through the local module
`apps/mobile/modules/system-context-menu` (`components/system-context-menu.tsx`): a
`UIContextMenuInteraction` on the held content, which lifts (or the `SystemContextMenuTarget`
inside it does), and a UIMenu built from the same `MenuRowSpec`s the custom hold menu draws on
Android and web. The rows are asked for when the hold begins and published by the root
`SystemContextMenuHost` while that menu is up, so their queries run once per open, never once per
row of a list: a SwiftUI context menu mounted per card was removed once for exactly that scroll
cost. A row's `symbol` is its SF Symbol there, the third place SF Symbols stand in for lucide.
UIKit has no bold row, so a leading `primary` row gets a section of its own and trailing
`destructive` rows (red there, and red in the custom menu to match) close the menu in another.
`HoldMenu` takes one rows builder and wears whichever menu the platform has (chapter rows use it,
except on Android);
`SystemContextMenuTarget` marks what lifts when that is less than the whole held view. The system
menu's rows carry no test ids, so Maestro reaches these menus on Android only.
On Android a chapter row holds nothing, since a long press in an Android list selects: its
actions sit behind the row's ⋮ (`components/overflow-menu.android.tsx`), Material's dropdown
hosted from Jetpack Compose by `@expo/ui` and mounted only while it is open. Each item draws the
Material Symbol paired with its row's SF Symbol in `components/icons/material-symbols.ts`, so a
row names its glyph once; a symbol missing there draws nothing on Android and warns in
development. Each item carries its row's test id as a Compose test tag.
Series cards there keep the custom hold menu for now.
Series cards and the History and Activity rows wear it through `series-card-menu.ios.tsx`: a
card's cover, or a row's thumbnail, grows into the cover alone (`SeriesCardPreview`), as large as
fits over the menu, the way Books and Photos preview a held item; Android's hold popup grows the
cover to the same size (`coverPreviewSize`). Both draw it as the book the card is (`BookCoverArt`,
which the series page's cover draws too). UIKit clips the grown preview to a rounded rect whose
radius no API sets, so the book sits inside a transparent margin (`platterPreviewSize`) and the
clip cuts only that, never the book's own corners. Tapping the preview does what tapping the item does
(`onOpen`), and Save on a saved series is the collections submenu, checks kept in place.
The preview is drawn by the root host into one native view kept out of the window
(`SystemContextMenuPreviewSlotView`), the way expo-router hands UIKit a link's preview, so a grid
mounts no preview per card.
Secondary controls leave the title: Library's filter/sort share one trailing `⋯`
`Stack.Toolbar.Menu` (`components/library/library-native-toolbar.tsx`) — NOT a
`placement="bottom"` toolbar, which is the navigation controller's toolbar and lays out UNDER
the floating tab bar. The native toolbar
only reads `Stack.Toolbar.*` elements that are its DIRECT children — a component wrapping one is
invisible to it — so shared menus are builder FUNCTIONS returning the element (`libraryFilterMenu`,
`librarySortMenu`, `collectedSortMenu`), one toolbar component per kind, and a screen's trailing
items all go in ONE `Stack.Toolbar`: expo-router keeps each toolbar's items as one option, and a
second trailing toolbar replaces the first's items outright (`navBarLeadingMenuItem` is the tab
menu's item for that toolbar, `NavBarLeadingMenu` the module's view beside it). `useNativeHeaderHeight()`
reports the RESTING height — the stack reports the sliding bar's height as it goes, but the content
pads once, by how far the bar reaches at rest. Each screen whose bar slides measures that itself
(`components/bar-extent.tsx`, the stacks' `screenLayout`: the screen's own safe area, which holds
still while the bar goes), so no row moves under the finger. Its measuring view sits BESIDE the
page: wrapped around it, it put a settings page's list one view deeper, and on a device one wrapper
more around the list stopped the bar sliding.

Pushed screens stay INSIDE the tab on iOS. A series page, a search and its results open in the
focused tab's native stack, not the root stack, so the system tab bar (or its side column) stays up
under them as it does in Apple's apps: every tab directory carries an `in-tab/` copy of
`series/`, `search` and `results` that re-exports the root screens, and `lib/nav` rewrites a push to `/series`,
`/search` or `/results` to the focused tab's copy (`lib/focused-tab.tsx` tracks the tab from the
segments) — on iOS only; Android and web keep the root routes. A new pushed screen that should
behave the same gets a stub in each tab's `in-tab/` and its path in `IN_TAB_PATHS`. Only the ROOT `series` route has
the nested in-series stack (`app/series/_layout.tsx`), so series code asks `useSegments()`, not the
pathname, to know which copy it is in. The series page takes the system bar in BOTH its modes —
one bar, so the back button and the items morph between them: details bare over the strip, the
series' title fading in as the page's own scrolls under the bar and the frost following it, a
toolbar chevron in place of the custom one;
the reader the chapter's name as a plain text title between the back button and save + settings
(`components/reader/reader-native-toolbar.tsx`), the bar
following the chrome's auto-hide through `headerShown` — with every `Stack.Toolbar` unrendered while
it is down, since a mounted one sets `headerShown: true` over the page's own options — and the
system's scroll edge left on to back that text, which does not read over any page as the glass
items do —
and hides the tab bar while the reader is expanded through
`lib/native-tab-bar.ts`, a pin counter like `tab-bar-visibility`'s. The reader's settings are ONE
model and two renderers: `components/reader/reader-settings-form.ts` (`useReaderSettingsForm`) is
the fields in order, each with its value, choices, note, section and what a change sets, and is the
only place a setting is added; both renderers group by the same sections (`readerSettingsSections`).
`settings-panel.tsx` draws it as the custom panel in the shared overlay (Android, web), a choice as
segments, and `settings-panel.ios.tsx` as a SwiftUI `Form` in a system form sheet route, a choice as a
menu row the way Settings' own are, a section's notes under it
(`app/reader-settings`), counted as a system sheet (`holdSystemSheet`) so the reader keeps its holds
under it. Each renderer's switch over the field kinds is complete or the typecheck fails, so a new
kind of field is drawn on both before it ships, and a new field of a known kind appears everywhere. The reader's bottom bar
(`components/reader/chapter-navigator.tsx`) is real Liquid Glass (`expo-glass-effect`) in one
`GlassContainer`, and nothing holding a `GlassView` may fade: UIKit renders an effect wrongly
under any ancestor alpha below 1, and a glass faded out and back can stay gone, so the glass
comes and goes through `glassEffectStyle` and only what sits on it fades; the tab stack's `screenLayout`
applies the series backdrop scale/dim to the screen underneath. Search takes the bar as the
stack's field (`Stack.SearchBar`, `integratedCentered`, uncontrolled: told the committed query,
focused after the push settles) with sort as a trailing menu; the route has no title, so the field
shares the chevron's row instead of sitting under an empty one; its filters are a trailing bar
button opening a system form sheet (`app/search-filters`, `presentation: 'formSheet'`) that hosts
the custom filter rows, not the shutter the custom bars keep. The sheet is its own view controller
and the app-root overlays render behind it, so it runs a stack of its own and `FilterButton`'s
`onOpenEditor` pushes each editor as a screen; the Search screen hands it its filters through
`data/filter-sheet.ts` (a one-slot module store, like `search-intent.ts`), since a root-stack modal
cannot reach the screen's state by context. Search and results share the tab's one UINavigationBar with the screen under
them, so their push animates the bar natively, as does an in-tab series page's. The tab copies
live under each tab's `in-tab/` on purpose: expo-router resolves a plain `/series` to whichever
matching route shares the most groups with the current one, so a copy at `<tab>/series` captures
every push made from that tab on every platform, and off iOS the tab is a `Slot` the page would
replace. Only `tabHref` (lib/nav) names them. The ROOT
`/series` route (deep links) is still a `containedTransparentModal` with its own zoom entrance,
so its first page's bar does not (a page pushed over it in its nested stack is a card again); that modal hosts a nested Stack and the page's `Stack.Screen`/`Stack.Toolbar`
address the nested screen they render in, never the modal: on iOS react-native-screens re-wraps a non-push
screen's content whenever `headerShown` flips (`ScreenStackItem`'s `isHeaderInModal`) and remounts
it, state and all. The
series page flips it twice per visit (details ⇄ reader, the search layer), and when the flip hit
the modal itself the search layer vanished on open and every open mounted the page twice.

`apps/mobile/src/components/app-tabs.tsx` is the Android + web shell (`expo-router/ui`'s headless
`Tabs`/`TabList`/`TabTrigger`, plain `Pressable`s): the icon rail at the regular size class, the
sliding bottom bar on phones, and the web-only panes.

The visible bar there is NOT the `TabList`. Its slide is a Reanimated animated style, which a
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
  this repo — the workspace-root `bun run dev` (one level up) starts comical's
  host-server on :3100 alongside this app's own `bun run dev`, which
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
  `x$.assign(patch)`. A read whose argument comes from render (`x$[key]`, a selector
  closing over a prop) goes through `useSelector`, the same hook: the React Compiler
  knows a hook by its name, `use$` isn't one to it, and it memoized such a read on its
  argument and skipped it on the next render, a hook-count error that kept the app on
  its splash. Legend State no-ops a set to the current value, so no
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

# A list row renders again only for a new item or a new `extraData`

LegendList memoizes each mounted row on its item and `extraData`, never on `renderItem`, so a row
keeps whatever its first closure held until it is recycled. Anything a row reads that is not part of
its item goes in `extraData`. That includes anything worked out from the window (a card width, a
gap, a side inset), and those also size the rows: pass them through `useListLayout`
(`hooks/use-list-layout.ts`), which clears the list's remembered sizes when they change and hands
back the `extraData`. `RecyclerList` already does this for the content width; a list of its own
names its own layout key. Skipping it is how a Browse rail kept the open Duo's spacing after a fold.

# Zoom transitions

The series page grows out of the card that opened it and collapses back into it (`apps/mobile/src/lib/series-zoom.ts`)
— on Android, web and the root `/series` route. Inside an iOS tab it is a native push instead and
none of this runs (`useNativePush` in `components/series/viewport.ts`); the grow-from-the-card there is
UIKit's own iOS 18 zoom transition: the card is a `<Link asChild>` with `<LinkTrigger
withAppleZoom>` (from `@/lib/nav`) and the page's hero cover sits in `<LinkAppleZoomTarget>`.
The href names the card's tab via `TabRouteContext` (`lib/focused-tab.tsx`), since a Link is
built at render time when the focused tab may be another. A push made in code zooms out of a
`ZoomSource` (`components/zoom-source.tsx`) instead: the details' strip, each page tile in the
details, and each History and Activity row's thumbnail. The reader lands on the strip's band of
its page when it came from the strip (`zoomFrom=strip`), otherwise on the whole screen, which
expo-router narrows to the source's shape. The zoom's interactive dismissal follows the screen's
`gestureEnabled`, which the page turns off in the reader, except a paged reader that zoomed in or
that the details pushed: there UIKit's swipe down is the only swipe away (`swipeAway`), and the
reader's own pan is off.
The collapse target is re-resolved when the collapse starts and re-aimed if the card moves while it
runs — a captured rect goes stale the moment a last-read list reorders. Don't freeze it.

The details and the reader are two pages on every platform (`SeriesDetailsPage` and
`SeriesReaderPage` in `components/series/`, hosted by `SeriesRoute` in `app/series/index.tsx`):
`series/index` is the details, whose strip shows the page you are on,
and `series/read` the reader it opens; `lib/nav` sends a reader-first `/series` push straight to
`/series/read`. Off iOS `read` is a transparent modal with no animation over the details, which
stay rendered, and the pages draw the move themselves: the reader page continues the strip's own
open from wherever a drag left it and shrinks back into the strip on the way out, and a reader
that brings up details it was not opened from has them slide up over it (`SplitHandoff`). On
iOS the root route (deep links, opens from outside the tabs) pushes them over each other in its
nested stack as a tab does, the reader zooming out of the strip; only its FIRST page is the
modal with the zoom from the card. A collection's sequence is a reader page too, whose Details
open the visible entry's details over the album.

**The page lands on its own hero cover only while that cover is at least half on screen.** A bound
that has scrolled off is still a bound the page has to fly onto, so aiming at one drags the whole
page up to meet it: the page appears to scroll itself away under the finger. Scrolled past it the
collapse switches to `cover-offscreen` instead — the cover's SIZE, centred on the page, with no
scroll to follow (`ZoomDest` in `apps/mobile/src/components/series/page-motion.ts`). Only the position was ever
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

The two surfaces have their OWN pairs. The reader's dismiss keeps 0.53/0.6; the series back-swipe
runs 0.6/0.8 (`ZOOM_BACK_SWIPE_FOLLOW_*`) and its position IS `held` — nothing runs after the
follow. It used to: the library's exponential rubber band was applied to `held` on the way to
`dragX`, and two resistances compounded had the page at 116pt for a 400pt swipe and 133pt for 600,
which is "the swipe stops a third of the way across". One band, reaching further, gives 154 and
183 and is still moving at the edge. A page put back by hand is expected to go with the hand.

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

# Reader zoom: a page has a REST, and the box it is drawn in never changes

Both paged readers (`use-zoomable.ts` on native, `paged-reader.web.tsx` on web) share
`page-geometry.ts`, which answers two questions about a page from its picture's real dimensions:
the box the picture occupies at 1× (what every pan is clamped to — a zoomed page stops at its own
edge, never slides on into its letterbox), and where the page RESTS. The page fit is `auto`, or
an AXIS — `fit-width` or `fit-height` — where the other axis is whatever the picture's shape makes
it. There is no "fit page": on any screen that is just whichever of the two is smaller, so
fit-width already shows an ordinary page whole on a phone and fit-height shows it whole on a
landscape tablet. `auto`, the default, is the device-independent one: every page whole, and a
SPREAD alone — a picture wider than it is tall — lifted to fit-height and panned sideways, since
it would otherwise lie as a strip; and its mirror, a stitched STRIP of panels (more than
`STRIP_ASPECT` times as tall as wide), laid to the width and panned down from its top, since whole
it is a sliver a few points wide (`stripsUnder`). An ordinary page is never scrolled under it on
any screen.

**A page that fits is drawn in the contain box, under either axis, and that box is the viewport's
size and never changes.** That is the whole reason the reader doesn't shift: a box sized from the
picture's aspect is sized from a GUESS until the picture arrives, and re-centring it then moves
the page (that was built, as the fit-width default, and was the "page shifting around"). Only a
strip — a page that overflows the height under fit-width, or a stitched strip under `auto` — is
drawn in a box its own height (`stripGeometry`; under `auto` the page remounts once its shape says
it is one, so its decode is made against the strip's box, not the screen's), centred like every other box and panned DOWN by the same gesture that pans a
zoomed page, from its top, with the same momentum and the same hand-off to the pager for a
sideways drag. (It used to have a gesture of its own, composed alongside the pager's swipe rather
than blocking it and with no momentum: a thumb drag that started slightly diagonal turned the
page, and one that didn't stopped dead on release.)

The fit itself is a TRANSFORM over that box, the rest. Most pages rest at 1×. Under `fit-height`
every page whose height fit buys more than `FILL_HEIGHT_MIN_GAIN` over contain rests scaled to the
viewport's height, at the edge reading starts from (left for L→R, right for R→L), and reads by
panning sideways; a page near the screen's own shape rests whole, so nothing is zoomed a few
percent for a few points of pan. Under `fit-width` nothing rests zoomed: a spread lies as a strip
across the middle there, and the `switch-fit` double-tap is how it is read. (Laying the page out
at its fit size instead, with the transform at 1×, was built and pulled back out: the box then
changes on load and on every fit switch, the transform lands a frame after the layout, and each
of those is a pop. A `smart` fit — an axis chosen per page from its shape — was pulled too.)

**A rest that follows from the picture's shape is applied BEFORE the render that carries it**
(`settle`, called from `onLoadDims` ahead of the state update), so a page is drawn at rest from
its first frame; a rest that moves under a picture already on screen — a fit switched, the
entrance settling — is animated, and that zoom IS the `switch-fit` double-tap: one gesture that
fits the axis the page does NOT currently fill (`otherFit` — from `auto` that depends on the
page), a zoom in where the other axis has room and a zoom out where it overflows. It is aimed at
the TAP: the content under the finger stays under the finger, clamped to the new rest's bounds,
rather than the page landing at its reading edge. And it is an OVERRIDE (`fitOverride$`), never a
write to the setting — from `auto` there is no single axis to write, and a double-tap is a
moment's choice: it holds across page turns, and the next double-tap, choosing a fit in the sheet,
or leaving the reader clears it.

Nothing locks the vertical axis. At fit-height the content's vertical overhang is zero, so the
clamp is what holds it — the same clamp that stops a 2.5× page drifting into black. Don't add a
rule for it.

A page resting zoomed still has to be LEFT. Its side-zone taps stay live and TURN, exactly as
they do at 1× — they never pan a step first (that was tried, and is not what a reader tapping
"next" asked for). And it is still SWIPED between, the way every native reader does it: the
pager's scroll is never frozen for a zoom but BLOCKED behind the page's pan, which decides on the
UI thread (manual activation, after a short deadzone) whether the drag has anywhere to go. A drag
that can pan activates and cancels the scroll; a drag past the edge the page already shows, or on
an axis it doesn't overflow, FAILS, and the scroll takes the same touch and slides to the next
page. So a spread is read by dragging to its far edge, and the next drag turns. (The first cut
froze the scroll and let a release past the edge JUMP the page; the slide is what the hand-off
should look like.)

Double-tap toggles between the rest and a magnification of it (`DOUBLE_TAP_SCALE × rest`, capped
at `WIDE_ZOOM_HEADROOM × rest` for a page whose rest is already above the old `MAX_SCALE`) — or,
under the `switch-fit` double-tap mode, flips `pageFit` to the other axis (`onDoubleTap`). Either
way a page that is NOT at rest goes back to rest first, so the toggle is always read against a
settled page. Pinching OUT below a spread's rest is allowed, down to 1×, for a look at the whole
thing.

Only the ACTIVE page reports `onZoomChange`. A page leaving the screen is put back to rest
silently and the page arriving reports its own rest on activation; the old arrangement, where the
leaving page reported `false`, would race the arriving spread's `true` in the same commit, in tree
order rather than reading order. A page under the pager's `standby` (the entrance, the collapsed
strip) rests at 1×, to match the poster over it, and zooms to its rest once primary.

# Page curl: a picture of the pager, turned over it

`pageTurn: 'curl'` (Reader settings → Page turn, native only) turns pages as paper curling over,
in single and two-page reading. The pager itself never animates a curl: scrolling is OFF under it,
and a turn is drawn by Skia over a list standing still (`components/reader/use-page-curl.tsx`),
from pictures of the two cells the turn runs between (`makeImageFromView` on each cell's wrapper),
so it turns exactly what was on screen — zoom, fit and all. When the turn lands the list JUMPS to
the spread turned to, under a curl that by then shows exactly that spread, and the curl goes two
frames later. Taps and keys come in through `PagedReaderHandle.turnTo`; a drag is the curl's own
pan, beside the edge pan and blocked by a zoomed page's pan exactly as the scroll is. Under Reduce
Motion, and in the standby strip, it is the slide.

All the geometry (`page-curl-geometry.ts`) is in TURN space, where the leaf lies right of the spine
and goes left; a turn the other way across the screen is the same turn mirrored, and the effect
(`page-curl-shader.ts`, SkSL, checked pixel for pixel through CanvasKit in its test) samples the
pictures through the same flip. A two-page leaf is the page on the side the turn starts from, both
sides printed; a lone page is paper, and turning BACK brings the previous page over the current one
(the forward turn played in reverse). The leaf is bound at its spine — the pull is held inside the
discs that keep the spine's ends down — and its corners are the screen's own wherever the page
reaches into them (`concentric`, the rule iOS 26 rounds nested shapes by), read per corner by the
local module `modules/screen-corners` (iOS 26's concentric corners, else the screen's one radius;
Android's rounded-corner insets), so a folding phone's hard edge stays square. On dark paper —
a black page, or one still loading — dark ink and shadows draw nothing, so there the outline is
light, the roll catches a highlight and the shadows' screentone is grey dots, switched dot by dot at
the brightness where both stand out alike; light paper draws exactly as it did. Pages that don't
fill their halves meet at the spine by default: a drawing across both pages stays whole. The
`spreadFill` reader setting (native only) fills a spread's spare width from the pages themselves:
`sides` keeps the pages at the spine and fills each outer side from its page's outer edge, `middle`
moves each page against the screen's edge and fills the gutter from their inner edges
(`components/reader/spread-gutter.tsx`, `halfLayout`). A fill is one solid colour, the most
frequent along the edge it is beside (colours bucketed, so paper speckle counts as one): the gutter
one colour across both pages' inner edges, each side its own page's outer edge. It is read off the
page as published — expo-image's original on disk (`getCachePathAsync`), or a downloaded page's
file — shrunk by the platform's decoder (expo-image-manipulator, off the main thread; Skia's own
decoders don't read AVIF) and read with Skia on the JS thread, never the UI thread the turns are
drawn on. It is drawn inside each page's half, so under the curl
a filled spread's leaf is the whole half, page and fill (`halfPageBox`): the fill turns with its
page, and the leaf never hinges in empty space.

**What keeps the curl responsive — don't undo any of it.** Each of these was a stall, a freeze or a
missing turn before it was a rule:

- Everything a turn draws comes from the UI thread: the pictures are staged by cell in a shared
  value, the armed turn names its cells by key, the landed turn is held there, and the next turns'
  plans are handed over at the landing. A turn waiting on a React render was 40–120ms of nothing.
- A derived value follows only the shared values read directly in it, never through a helper it
  calls: through one, the curl kept drawing a replaced, disposed picture (black, or nothing).
- A cell's picture (`makeImageFromView`) stops the main thread — the curl's own — for 30–100ms.
  Never take one while anything moves: they are taken at a landing, while the landed spread lies
  flat, or once nothing moves and no finger is down (`whenStill`), and kept until the cell changes,
  not for a set time. A scrub draws its own pictures off the main thread (`scrub-pictures.ts`).
- A picture goes only after the UI thread has drawn without it, and only a cell that has really
  unmounted forgets that its pages have drawn (a new ref every render runs the old one's cleanup).
- The JS side cleans up after a landing a frame and more late: what it clears, it clears on the UI
  thread, and only the turn that landed (`putAway`).
- A scrub's turns run on their own clock after the scrubber (`SCRUB_MAX_SPEED`), and never wait on
  a picture: each pair is handed over at once with one shared blank sheet for any page not drawn
  yet, and again with the pages once they are; only the last turns before the scrubber wait a
  moment for them. A stand-in drawn per page (its placeholder) held enough memory to run out.
- A scrub's pictures are drawn from the pages on disk first, and only a page that wasn't there is
  fetched: a fetch asked for first, of pages already there too, took half a second a pair.
- The pager stands still under a scrub and the release jumps it to where the turns land. Moved
  with the scrub — under the finger, or a spread at a time after the turns — it mounted and
  rendered dozens of times a second, and the JS thread the pictures are drawn on stalled.
- More than `SCRUB_CAP` turns behind, the turns finish the one under way and cut, between two
  spreads lying flat, to a few short of the scrubber, once the pair they land on is in. Every page
  turned ran on for seconds after a fling; the cut that dropped the turn first showed the pager.

The scroller standing still under the curl is also what stops holding off iOS 26's swipe back from
anywhere on a page: the slide's UIScrollView claimed every sideways drag first, so the reader never
noticed it was on (react-native-screens turns it on by default there). The reader turns it off
(`fullScreenGestureEnabled: false`); its swipe away is the swipe down and the edge's. A drag that
doesn't turn — another gesture took it, it was too steep, the JS side or the pictures lagged — goes
in the Diagnostics log as `page-curl`, which a development build also prints to Metro, along with a
line for every drag.

# iPhone Duo folds: a resize, not a rebuild

Folding or opening an iPhone Duo resizes the same scene, animated by UIKit: Apple's own apps look
ready mid-fold because their layout runs inside that animation. Ours can only match it with layout
that FLEX decides, which Fabric re-runs synchronously when the root resizes; anything sized from
the window in JS lands a render after the animation, and is what shows as a jump. So:

- Read the window through `useWindowSize` (`hooks/use-window-size.ts`), never React Native's hook:
  folding, React Native first reports the open size turned upright, larger than the screen, and
  laid out for it the app worked a whole layout for nothing. `onBeforeWindowResize` runs before a
  new size renders (the grids hold their first visible card through a column change with it), and
  `useWindowResizing` is true from a new size until a second after it settles.
- A card grid's cells take their column by flex (`columnPlacement`), cards fill them, and
  `SeriesCard` is memoized, so a new width renders the cells and not the cards. A rail can't: its
  list places cards at offsets JS computes, along the axis a fold widens, so its cards keep the
  compact (folded) size on a wide window rather than resize a render late (`cardWidthFor` in
  `rail.tsx`). Flexbox can't choose a count from a width; only native layout code could.
- Type stays compact on an iPhone, open Duo included (`useCompactType`): by the window, every fold
  changed every card's and heading's type.
- Tabs out of sight are frozen only while the window resizes (`tab-stack.ios.tsx`), and catch up a
  second after, as a transition React renders in slices: frozen all the time, a tab came up black
  until the JS side heard of the switch. (React's `Activity` hides its content the same way, and
  takes down its effects while hidden.)
- The reader's pager still remounts on a fold (pairing is fixed for its lifetime), under the poster.
- History and Activity don't render again on a fold: nothing in them reads the window on a device
  (`useIsDesktop` is false there without reading it, `useCenterInset` is 0). Give either a layout
  that depends on the width and it renders on every fold again, under the screen being folded — read
  the size in the one component that needs it, not at the screen.

# Headings are set in the title typeface, and nothing else is

Shippori Antique B1 (`lib/title-font.ts`) sets the tabs' titles (off iOS, Browse's and Library's
are their bars' selectors, `useSubtitleSelectorStyle`: a heading that opens a menu, and the rows of
those menus are too, `OptionRow`'s `titleFace`, since a pick becomes the title), the series page's title (and the
bar's copy of it), the feeds' section headings and the empty screens' headlines. The heavier
mincho and gothic faces were tried and read too serious for a comics app. Text that is read
or tapped — cards, rows, buttons, settings, the reader — stays in the system face: at card sizes
a display face loses its shape. (The home bookshelf's spines are the one exception, in a face of their
own: see there.) The bundled file is cut down to Latin, so a heading whose words
aren't ours (a series' name, a bridge's section) takes it through `useTitleFontFor`, which falls
back to the system face for a title it can't set whole; iOS would otherwise fill the missing
letters from the system face one by one, one title in two typefaces.

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

# Downsampling is the reader's choice, not expo-image's default

`allowDownscaling` defaults to TRUE, so every page was already being decoded at the size of its box
before anything here said so. That default is right for a cover and only half right for a reader,
because a reader magnifies: zoom is a TRANSFORM on an ancestor (`useZoomable`), so the `<Image>`'s
bounds never change and nothing re-decodes — a page pinched to 4x is a box-sized bitmap blown up,
and a spread resting at `restScale > 1` is soft before you have touched it. Mihon escapes this by
tiling (`SubsamplingScaleImageView` re-decodes tiles as you zoom in); we can't, so it is a reader
setting instead — `downsample`, on by default, which is where Suwatte lands too.

`enforceEarlyResizing` is the iOS half and is not cosmetic. Without it SDWebImage decodes the page
at full size and expo-image redraws it smaller AFTERWARDS, so the peak never drops and the
full-size copy stays in the memory cache beside the one being drawn. It is passed ONLY where the
box is exact at request time — it reads the view's bounds when the load starts and never
re-decodes when they change — which means `fit="contain"` and never `fit="width"`, whose height is
a guess (`DEFAULT_ASPECT`) until `onLoad` reports the real aspect. Android needs none of it:
Glide's `ContentFitDownsampleStrategy` already downsamples during the decode.

Neither half covers a strip NARROWER than the view: `shouldDownscale` requires the image to exceed
the view on BOTH axes, so an 800x10000 webtoon page is decoded whole on every platform. That one is
`page-slicing.ts`'s.

# A stitched strip is CUT UP, because Android can't draw one

A bitmap longer than the driver's `GL_MAX_TEXTURE_SIZE` cannot be uploaded as a texture at all:
hwui logs "Bitmap too large to be uploaded into a texture" and draws NOTHING. No exception, no
`onError` — a blank page, and the reader has no way to find out. It is the failure behind every
"black screen on long strip" report a webtoon reader collects.

It is not rare. A survey of the most-followed Long Strip titles on a large aggregator (90 pages, 13 titles)
found a median page 760x5508 and **a third of pages over 8192 tall**, clustered by TITLE rather
than scattered — 7 of 13 titles had one, and within those most pages did, so an affected series is
blank *everywhere* while its neighbours are perfect. Eleven pages sat at exactly 10000, which is
that site's upload ceiling and not a preference: the distribution is censored, and a source without
that cap goes higher. Official platforms are fine (WEBTOON slices everything to 800x1280); this is
an aggregator problem.

So `page-slicing.ts` cuts a page that can't be drawn into equal pieces that can, and
`use-sliced-page.ts` performs the cut. Three things about it are load-bearing:

- **`MAX_DRAWABLE_PX` is 4096, not the 8192 most phones report.** The limit is the driver's and
  there is no floor to it. A cap that is wrong is worth nothing, because the page it is wrong about
  is blank and silent.
- **The strip test (`height > width * 3`) is not redundant with it.** Without it a genuinely huge
  single page — a spread scanned at 300dpi — would also be cut, putting a seam through artwork
  drawn to be seen whole. Nothing drawn as one picture is three times taller than it is wide.
- **It runs off the already-loaded page, and one page at a time app-wide.** Deciding earlier means
  knowing the picture's shape before it arrives, which costs a decode or a range request on every
  page in the chapter to serve the few that need it. The queue is because a cut holds the whole
  picture and its pieces at once, and a reader windows several rows ahead.

The cut is only applied where the picture FILLS its box (`fillsBox`) — a `width` row, or the paged
reader's strip box — since only there do bands that tile the box add back up to the picture. A
contained page in a viewport-sized box is excluded and doesn't need it: containing a tall picture
is the exact shape `shouldDownscale` already decodes down.

**ANDROID ONLY, because Android is the only platform that can't draw one.** A browser tiles a large
image itself and iOS renders a 10000px page correctly. Running it everywhere was tried and crashed
the reader on Dungeon Reset: a cut costs a SECOND full decode of the biggest picture in the chapter
plus its pieces, alive together, on top of the copy the view holds and the full-size one in
expo-image's memory cache — so on a platform with nothing to gain it only raised the peak. The
"it also bounds per-slice memory" argument for doing it on iOS was simply wrong, in the direction
that matters. Where the page draws, leave it alone.

# Home-screen widgets: the app writes a feed, the widget draws it

Continue Reading is the History tab's newest rows and New Chapters the Activity tab's unread ones,
each in three layouts. The drawing is native and written once per platform, since a widget is not
a React Native view on either: on iOS `apps/mobile/targets/widgets`, a WidgetKit extension in Swift
(added to the generated project by `@bacons/apple-targets`; `expo-target.config.js` there is its
settings), and on Android Jetpack Glance in `modules/home-widgets/android`. Everything before the
drawing is one implementation in JS. A widget reads none of the app's state, only a folder the app
writes the feed to (`data/home-widgets/`, through the local module `modules/home-widgets`):
`snapshot.json` and a `covers` folder beside it. `docs/WIDGETS.md` is the contract both platforms
draw to: the feed's format, the module's functions, and what each widget shows in each layout. A
change to a widget is made on both platforms and in that file.

**The widget decides nothing.** A row's text and the link a tap opens are worked out in the app,
from the helpers the tabs' own rows use (`lib/series-links.ts`, `lib/history-sub.ts`,
`data/activity/feed-rows.ts`), so the widget's row and the tab's cannot say or open different
things. A change to what a row says or opens goes in those helpers. The link is a plain `/series`
deep link, the root route's.

**The feed is written when it may have moved while a widget could be seen:** as the app is left
(`installHomeWidgets`), and at the end of a background chapter check (`activity/background.ts`).
A widget is never on screen while the app is, so nothing writes while it is in use. The module
reloads the widgets only when the file changed: a reload from the background comes out of a daily
budget. Covers are rendered by the app to small JPEGs (a widget can't send a bridge's headers, and
its process has little memory), named for their URL so each is rendered once, and a row goes out
without its cover rather than wait on one.

**NSFW follows the STORED choice** (`hidesNsfwDurably`), never a session override: an override
lasts until the app is left, and the widget is what is on screen after that.

The rest is iOS's alone. On Android a widget's receiver runs in the app's own process and reads
the app's files, so there is no shared container to find and nothing to sign.

**The App Group's name is found at run time, never written down.** A sideload signer registers the
group under the installing Apple ID and has to rename it (AltStore and SideStore append the team
id), so `group.com.porksphere.comical` is not the group a sideloaded build has.
`SharedContainer.swift` looks for the real one where a signer leaves it: the `ALTAppGroups`
Info.plist key, then the embedded provisioning profile. The app's module compiles a copy of that
one file (`plugins/with-widget-shared-sources.js`), so the two sides cannot resolve different
folders. This is why the widgets are not `expo-widgets`: it reads the group from a fixed
Info.plist key, in the extension too, and under a renamed group the app and its widgets share
nothing.

**The IPA is ad-hoc signed with the App Group entitlement** (`build-ios-reusable.yml`, the
packaging step). A signer learns what an app asks for from the binary's signature; an unsigned
binary has none, and the group is never registered. Only the group is in it. Don't add an
entitlement a free Apple ID can't be given (push is already in the generated file, and is left out
for that reason).

# Home bookshelf: lit geometry on WebGPU, the same scene on every platform

Comical Home opens on what you are reading as books on a shelf (`components/home-bookshelf`): spine
out, the one in the middle pulled forward and turned to show its cover, in colour against a shelf
drawn in screentone. Half its books are the History tab's newest rows and half the Activity tab's
unread ones, each making up the number where the other runs short (`pickShelf`,
`useBookshelfEntries`); a series in both is one book. They stand with what matters most in the
MIDDLE — the book read last, then the two halves by turns to either side of it (`arrangeShelf`) —
and the shelf opens on the middle, so the least of them is furthest out whichever way the reader
goes. Once the reader has moved the shelf, the book in front is kept by what it is, not where it
stands (`ShelfDriver.setBooks`): the one just read moves to the middle while the reader is away in
it. Until then every new set opens on its middle: the first is whichever half answered first. A History row says what its
series is as an object (`coverForm`, `readingDirection`), written by the reader with the read that
made it and kept with the row by a host that knows the fields (comical's "History rows keep each
series' cover hints"; an older host drops them and answers without); a row without them, and an
Activity row, are asked of the library and then of the details where they have been read this
session. The details alone
were not enough: they are not kept past the session, and a CG set from a bridge of doujinshi
stood on the shelf as a doujinshi again after every restart. A tap on the front book or
on its caption — the caption is the button, there is no other — pushes what the History row pushes
for a series that has been read (`historyResumeParams`, the caption RESUME) and what the Activity
row pushes for one that has only its new chapters (`activityReadParams`, READ), so the shelf cannot
say or open something those tabs don't. The caption is a view over the canvas, so a tap on it is
told by where it hangs (`captionHang`), not by a touch target of its own. Until the renderer has
started the stage shows a placeholder of a cover and spines. Settings → General → Home bookshelf
turns it off.

**The books are real geometry under a real light, drawn by three.js on WebGPU.** On iOS and Android
that is `react-native-webgpu` (Dawn, over Metal and Vulkan); on the web it is the browser's own
WebGPU, or WebGL 2 where there is none, which three's renderer falls back to by itself — the reason
`shelf-canvas.web.tsx` is a plain canvas and not react-native-webgpu's, whose web build has only
the first. One scene (`scene.ts`) and one shader, written in three's node language, which compiles
to WGSL or GLSL as the backend needs. Filament is the faster engine and was passed over for having
no web build and shaders compiled ahead of time; expo-gl is OpenGL ES. Skia stays what draws the
reader: it is 2D, and a book is not. (The same scene written straight on WebGPU, with no engine —
its own matrices, triangles and WGSL — was built beside three's and taken out. It ran a twentieth
of the script a frame and still drew fewer frames on a phone: its first cut, one shader that chose
by the surface with every face drawn, cost three times three's GPU time a pixel, and split into a
shader a surface it was still the slower on a device. Script is the half of a frame a browser's
clock shows.)

- **Import `three/webgpu` and `three/tsl`, never bare `three`.** They are different builds of the
  same classes, and one of each in a bundle is two libraries that don't recognise each other's
  objects.
- **`three` and `react-native-webgpu` are pinned exactly, together.** The renderer reaches into
  the canvas and the device the package hands it. Skia 2 has no part in this; Skia 3 draws through
  the same Dawn, and from then the two packages must be a pair their docs list as compatible.
- **Nothing here is imported until the shelf is on screen**, and all of it through `engine.ts`:
  three is most of a megabyte. Asked for from two places it was two chunks on the web, and three,
  shared by both, went to the main bundle.

**One camera, written twice.** `ShelfScene.resize` and `setView` set it for the renderer and
`projectToStage` (`lib/bookshelf`) is the same camera as arithmetic, which is how the callouts — the
burst for new chapters, the caption for where you stopped, the tab over each shelved book with
something new — stand on a book's corners while being plain views over the canvas. Change one and
change the other; `bookshelf.test.ts` holds the arithmetic, and nothing holds the two together but
this. The stage runs under the safe area's sides (the bar the wide iPhones stand beside the
content), and the camera looks square on to the middle of what is left (`ShelfStage.centre`), so
the shelf crosses the whole screen while the book in front stands where the rest of the page is.
On the web the page is a column centred in its pane and the shelf's row stands in that column, so
the stage is pulled back by the centre inset too (`lead`): without it the stage began at the
column's edge and ran off the right of a wide window. In the desktop app the scene is drawn at 1.5×
(`SHELF_ZOOM`, `ShelfStage.zoom`): the shelf is built in a phone stage's points, and both copies of
the camera frame a stage a zoomth the size, so the books, the gaps between them and the callouts
grow together, and so does a finger's travel for one book.

**A book's room along the shelf is the room it has at rest** (`placeShelf`): what it has with the
book before the place in front, and with the book after, and the share of each the shelf is
between them. So the spines beside the two books trading places move once, one way. It was the
room each takes at its own angle at that instant, which swells half way through a turn and is
least exactly edge-on, and the book leaving the front turns a little past edge-on: every step
pushed the spines out, drew them in and pushed them out again, three times as far as they ended
up moving. The turn and how far forward a book stands are not part of this, so the flip is what
it was, and at rest nothing differs. Two books bound on opposite sides turn toward each other and
would meet inside that room, so a turning book is moved along just far enough to clear the two
before it (`shelfOverlap`), which for such a pair comes to about what the old room gave.

**Spines shoved to make room knock into each other** (`stepKnocks`, `KNOCK`). A spine the row
pushes along to make room for the book in front leans back against the push, swings past upright
as the push stops and rocks to rest on a loose spring, and pulls on the ones beside it, so a knock
runs two or three books down the row and dies away. It leans by how fast it is shoved RELATIVE to
the row: the row's own slide, read off the books three and more from the front, which only ever
slide, is taken out, or every move rocked the whole shelf like a carriage. The book turned to the
reader leans in its tone's measure (`ink`), so it stands still while the knock runs on through it.
A lean pivots on the edge of the foot it leans toward (`leanedPlace`, a place's `roll`, which the
scene and `bookPoint` follow), and nothing knocks under Reduce Motion. The frames go on until the
last spine has stopped rocking, under a finger as well.

**Everything that moves is `ShelfDriver`'s, outside React.** Where along the shelf the reader is,
the drag, the spring, the press of a tap, the view's drift, and the only place a frame is
drawn from. It keeps what the scene is to show until there is a scene: the renderer starts after
the first books arrive. It runs on the JS thread, as three does, but it keeps no clock: its frames
are the display's own (`useFrameCallback`, handed across one at a time, so a slow frame is a
dropped frame and never a queue), because React Native's `requestAnimationFrame` ticks at 60
whatever the screen does. A shelf that is moving takes every frame. One that stands takes about
every other, for its drift, and none once it has scrolled off the top, lost the screen, or under
Reduce Motion. How the frames are going is told by Settings → Developer → Bookshelf frame stats
(`frame-stats.ts`): a line over the stage for the last second and one in the Diagnostics log for
each time the shelf has moved, giving the frames the display OFFERED a second against those drawn
(on iOS they come from react-native-worklets' display link, which lowers its own rate — 120, 60,
30 — by how long the UI thread's frame work has been taking: `IOS_DYNAMIC_FRAMERATE_ENABLED`, on by
default), the frames skipped at the hand-off, a frame's script, and how long after it the GPU was
done (`ShelfScene.drawn`). The line is a view of its own over a store of its own: set in the
shelf's state it rendered the shelf every second, on the thread whose frames it counts.

**A draw is the cost, not a triangle.** Each is a trip through three in an interpreter, and a book
built of loose boxes with a material a face was sixteen of them, twice over with the shadow's
pass: that was the shelf at half its frame rate on a phone. A bound book is four (both boards and
its lid as one piece of cloth, its picture, its page block, its back), the
block alone casts its shadow, the cut-paper edge is drawn by the material from the block's own
depth rather than sampled, and the shadow is cast again only when a book has moved, so a shelf
that only drifts casts none. Merge by hand (`merged`): three's own merge is an addon, which imports
bare `three`.

**The view drifts, and the phone only adds to it.** A couple of degrees of turn over seconds
(`driftAt`), with the device's tilt (`DeviceTilt`: gravity's direction, measured from how the
phone is being held, so a tip eases back to nothing) laid on top at no more than the drift's own
size. It is a component, mounted only while the shelf may drift: the sensor runs for as long as
its hook is mounted, and as a hook of the shelf's it ran under every other tab and the reader. The stickers ride the drift through the camera and take a few points more from the tilt.
Each is put on afresh for each book that comes forward: the caption leaning one way or the other,
the burst's star turned at random under lettering that stays level — twelve points, since
sixteen were too fine for the turn to show and a star stretched so that it would only looked
slanted. A book the reader brings
forward ticks (`hapticSelection`); the one the shelf opens on does not.

**A tap presses the book before it opens the page.** The front book gives under the finger —
back into the shelf on a stiff spring as the finger comes down (`pressIn`, which is also when the
fetch is warmed) — and springs out past where it stood as it lifts (`pressOut`, `PRESS`), and the
page is pushed at the furthest it comes. Never sooner: what the push starts takes the thread the
frames are drawn on, so the book stops wherever it is when that begins, and the end of its move is
the place to stop. A finger that goes on to drag, or holds too long to be a tap, lets the book
back out and opens nothing. Before this a tap opened the book: its cover swung round to a spread
of panels, a CG set fanned its prints, and the stage zoomed in over the wait for the reader's page.
It was taken out for the press — a board hung to swing, a pair of page sheets and the spread's
picture were what the shelf carried for a quarter of a second of it, and the wait showed however
it was dressed.

**A mouse draws out the spine it is over** (a mouse or trackpad on any platform; never a finger or a
Pencil, which `Gesture.Hover` also reports, so its `pointerType` is checked): `ShelfDriver.hover`
eases that spine part way out (`HOVER`: pulled toward the reader and tipped forward on the front
edge of its foot, as a finger hooked over its head would; an easing, not the press's spring, so a
pointer sweeping the shelf doesn't set a row of them ringing), and the web cursor turns to a pointer
over anything a click does something to. The tip is a place's `tip` and `y`, which `bookPoint`
follows too, so a tab stays on a tipped spine. The book in front doesn't move, and nothing does
while the shelf is being dragged.

**Spines are read.** They are lettered in Shippori Mincho B1 at its medium weight (`SPINE_FONT` in
`lib/title-font.ts`), the serif a volume's spine is set in — the one place it is used, and the one
heading not in the title typeface. Its bolder weights were more than a spine wants, and
Dela Gothic One, tried first, was far too bold for a row of spines. It is loaded from its own
FILE (`prepare`): asked for by name, a Skia paragraph looks in the system's fonts, where a bundled
face is not, and every spine was set in the system's. The chapter the book opens at is at its
foot, two digits at least (`spineNumber`). A shelved spine's cloth is cut to the covers' own coarse
steps, and its lettering is half that tone and half laid on SOLID, light on cloth that comes out
dark and dark on light (`lettered` and `LETTER_GRAIN` in `scene.ts`, which tells lettering from
cloth by the picture's own colour). All tone, the dither ate the strokes, and turning the dither
down did not bring them back: under the shelf's light the lettering falls on a middle step, hard
by the cloth's. At steps fine enough to keep them (eight was tried) the spine stopped reading as
tone at all, and all solid the lettering lay on the spine like a label.

**A cover has its relief, and a CG set is its card.** The hinge's groove and lip, the catch of
light on the fore-edge and head (`emboss`) are the card's own shading (`SPINE`, `FOLD`, `EDGES` in
lib/book-cover) laid over the picture in the material. A bound cover is cut to a cover's outline,
its two free corners rounded and the bound ones square, with the board's edge rolled over and the
picture stopping short of it, and its laminate is rubbed pale along the free edges and at those
corners: a rectangle with a razor's edge was a picture pasted on a box. The rub along its head and
foot carries on round a hard cover's back (`rubbedEnds`), as wide and as strong as where the two
meet and starting where the cover's picture does, inside the board's rolled edge: stopping at the
hinge it was a seam down any book whose cover it shows up on, and begun at the back's very rim it
was a bright ring round the spine's ends, half a point off the cover's band. (The picture carried
round onto the spine, and a band of gloss sliding with the drift, were drawn up beside these and
not taken.) A CG set is the card's two prints (`PRINT`)
as two cards with the book's depth between them, each leaning its own way on a corner and the one
behind set to the side, further than the card tips it (`PRINT_LEAN`), the picture on the one behind
dimmed as the card dims it. A stack of sheets one behind the other was tried first and read as a
thin white book.

**The dots under it are the system's on iOS** (`modules/page-dots`, UIPageControl, which takes a
tap or a scrub); elsewhere they only tell. The scene's top and bottom fade into the page, so the
canvas has no edge.

**The shelf is the feed's header, not a row of it** (`ContentFeed`'s `hero`). A row is unmounted a
little way off screen, and a renderer is costly to start again, and every restart was a new device
and its pipelines; the list never unmounts its header. Its height is given rather than measured, so
the sticky heading and the tint bands below keep their offsets.

**The canvas is opaque and paints the page's own colour.** A canvas cannot be transparent on
Android, so the scene draws the background itself, tone and all, and no tint band is laid behind
the shelf: one would only show as a frame around it.

**The tone is the page curl's.** Books off the front are drawn in a 4×4 ordered dither between an
ink and a paper (`inked` in `scene.ts`, the matrix of `page-curl-shader.ts`), cut from the colour
as it is shown on screen, after lighting; the shelf itself is always tone, so the shadows the
books cast on it are screentone and not a blur. A sticker is ink on paper whatever the theme.

**Textures are made where each platform can make them** (`pictures.ts`, `pictures.web.ts`), a few
covers at a time from the middle of the shelf outward: only the books near the front are drawn,
so a long shelf costs a picture a book and little else, but a shelf's worth decoded at once was a
stall as the app started. A cover is expo-image's own copy on disk, shrunk by the platform's decoder and read back through
Skia, as the cover glow reads its tints; on the web it is FETCHED and drawn to a canvas, since a
picture a canvas can't read back can't be a texture, and the desktop shell grants that read to what
the page fetches and not to its images: asked for as a cross-origin `<img>`, every cover on desktop
stayed plain cloth. A spine is lettered with a Skia
paragraph, so a title the heading face has no letters for falls back a glyph at a time. A book's
cloth is the colour of its cover beside the binding (`boardColour`). A cover that can't be had
leaves the book in plain cloth.

**A renderer that cannot start takes the shelf away, not the screen** (`markHomeBookshelfUnavailable`):
the rails begin the page as they did, until the app is next opened.

# Testing: new screens need a flow

A new top-level screen, tab, or interactive feature needs a Maestro e2e flow, not just a testID.
See `apps/mobile/e2e/README.md` for the authoring/running workflow (two copies per flow — `apps/mobile/e2e/mobile/` and
`apps/mobile/e2e/web/` — plus the web-only selector/gesture quirks to check against before assuming a mobile
flow ports over as-is). CI's `check:flow-coverage` (advisory-only) flags a new tab/screen/Settings
category with no flow referencing it yet, but can't tell when an *existing* flow has gone stale
because a screen it already covers changed — that's on the PR author, not the check.
