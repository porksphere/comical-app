- [ ] Add "page" favoriting mechanism
- [ ] Genericize the series metadata contract — typed credits/facets are handled
      inconsistently. Some are a fixed, first-class field on `SeriesInfo` (the
      single `author`/`authors`) while others are just another entry in the
      free-form `tagGroups` list, even though both are really the same kind of
      thing: a typed, named, searchable facet of a series. A source has to pick,
      somewhat arbitrarily, which axis each facet lands on, and the app then
      renders and searches them through two different code paths (a fixed author
      chip vs a dynamic tag-group chip). That split is clunky and is why closely
      related facets keep needing special-casing to search correctly. Design one
      generic model for these typed facets (label + kind + values + how each
      value searches) so every client treats them uniformly. Related, and
      probably the harder half: to support library maintenance and search over
      *saved* series, we likely need a way to massage a source's loose, dynamic
      series shape into a more concrete, normalized "library series" shape — a
      stable projection the library can index and query, independent of how any
      given source happens to structure its metadata.
- [ ] Genericize "home" / page-surface behavior — the landing surface is wired up
      through the magic string `'home'` and ad-hoc `page: true` / `id === 'home'`
      special-casing scattered across `(tabs)/index.tsx` and `data/api.ts`, instead
      of one model. Today a bridge's landing tab can be any of three things decided
      by scattered conditionals: the built-in *composed* Home (rails + grid from
      `page: false` lists — `composedHome = page === 'home' && !homeList`), a
      `page: true` list whose `id` is literally `"home"` that *replaces* the composed
      surface (`homeList = lists.find(l => l.id === 'home' && l.page)`, mirroring
      comical-web's `selectHomeTab("home")` special case), or — when a bridge has
      neither — its first `page: true` list (the `hasHomeList` fallback in the lists
      effect). The string `'home'` is also the initial `page` state, the value the
      Series tag/meta focus effect force-sets, the `backLabel`/`selectedList`
      home branch, and is filtered out of the Page selector in `pageOptions`
      (`api.ts`: `if (l.page && l.id !== 'home')`). `'favorites'` is a second magic
      page value layered on the same axis. Design one flexible model for "what
      surfaces exist, which is the landing surface, and how each is rendered/paged"
      (e.g. a typed list of page descriptors with an explicit `home`/landing flag and
      a render-kind), so the `'home'`/`'favorites'` strings and the `page`/`id`
      coupling live in exactly one place rather than being re-derived everywhere.
- [ ] Investigate if we can have varied height thumbnails without weird page shifting now that we use legend list
- [ ] Apply the release-scroll card optimizations to the series page's **page-thumbnail cards**
      (`PageThumb`/`PageThumbList`, `components/series/chapters-section.tsx`): fixed-height cells so
      LegendList stops re-measuring on scroll (mirror `series-grid.tsx`'s `cellHeight` +
      `estimatedItemSize`), and build any per-render allocation (e.g. an href) lazily on press
      (mirror `series-card.tsx`'s `buildHref`). NUANCE: `PageThumb` renders in TWO places — the series
      page grid AND the card long-press popup (`series-card-context-menu.tsx`) — so the fixed height
      must NOT be baked into `PageThumb`; the series page and the popup should each wrap it in a
      container that defines the fixed height for THAT context. See the A–D plan for the why.
- [ ] Investigate **app-side image downsampling** (decode to the displayed size, not the source size).
      Even with correct-aspect small covers, a source is often larger than the card renders — e.g. one
      bridge's smallest 2:3 cover variant is ~360×540 / ~80 KB where a grid card is only ~130–180px
      wide, vs another bridge's ~256px / ~40 KB thumbnail. Decoding to the view bounds cuts decode CPU +
      memory + GC per card. Check whether expo-image already downsamples to the view size on
      iOS/Android or needs an explicit target (e.g. a decode/thumbnail size hint); measure whether it's
      worth it — probably marginal now that the big source-side win landed (see A–D plan option D), but
      worth confirming on a fast fling through many cards. For a source whose only smaller variant is a
      square crop, downsampling its 2:3 variant app-side is the only remaining size lever.
- [ ] Hunt down the spammy `[Reanimated] Reading from 'value' during component render` warning.
      Something reads a shared value's `.value` (or `.get()`) on the JS render thread instead of in a
      worklet/`useAnimatedStyle`/`useDerivedValue`. It floods the Metro logs and can cost frames.
      Surfaced during the downloads work (2026-07); a likely suspect is one of the animated download
      widgets (`download-radial.tsx` / `cumulative-radial.tsx` / `disk-space-bar.tsx` / the swipe row's
      derived values) or a shared-value read in a render body. Reproduce with reanimated strict mode on,
      trace the offending component from the (JS) stack, and move the read into a worklet.
- [x] Infinite paging loading skeleton doesn't add skeleton entries to incomplete rows,
      it should ideally finish an incomplete row then add an additional row (the
      loaded grid already padded a short last row with invisible spacer cells so it
      wouldn't stretch, but that padding stayed blank even while a next-page fetch was
      in flight — the fresh skeleton rows below it always started a new row rather
      than finishing the one already on screen. Those spacer cells now render as
      skeleton cards instead of blank views while `loadingMore` is true.)
- [ ] Page loading skeleton does'nt reflect mobile / multiple dimensions correctly
- [ ] Series `isFavorite` check fires a slow per-series scrape on every open. The star
      state (`GET /bridges/{id}/favorites/{seriesId}`, `SeriesBody` in `series.tsx`) is
      requested ~immediately on opening any series with a bridgeId, and on some bridges it's
      a 1–4s scrape purely to fill the ★/☆ label. (1) DONE — the Favorite action button is
      now `disabled` while `favorited === null` (series.tsx), matching the reader panel; and
      `isFavorite` was actually added to `NO_PERSIST_KEYS` (query-client.ts) so a stale
      persisted value no longer rehydrates a tappable star / races the optimistic toggle —
      this also fixed the "favorite reverts almost instantly while the favorites page shows
      it favorited" flake (a late/stale scrape clobbering the optimistic `true`; the toggle
      now re-asserts the confirmed state in `onSuccess`). (2) TODO — investigate
      avoiding/deferring the scrape itself: only fire it for a favorites-capable bridge,
      and/or defer well past the open (e.g. on first interaction with the actions) instead
      of on mount. Keyed `['isFavorite', mock, bridgeId, seriesId]`, 5-min staleTime.
- [ ] Virtualize the series screen's **chapter list** too (deferred from the page-thumb
      work above). Left as a plain `head.map`/`tail.map` (+ first-N/last-N collapse) for
      now: `ChapterRow` is two `Text`s (no image), so 200+ mounted rows is cheap relative
      to the page tiles, and virtualizing it forces the bigger disruption — on large
      screens chapters live in the right column beside the web sticky cover, which a
      single vertical list can't reproduce (chapters would have to move full-width below
      the hero). Not the nav stall either (Profiler cleared chapter render). Revisit only
      if a genuinely huge chapter list hurts on device.
- [ ] Excluded tags don't appear to persist on iOS between restarts (unsure about genres).
      (1) DONE — `TagExclusionsControl`'s save (bridge-extras.tsx) never invalidated the
      `['bridgeSettings', bridgeId]` query its own `initialTags`/`initialLabels` come from,
      unlike `GenreExclusionsControl` (which does `invalidateQueries` after its PUT) and the
      parent screen's own settings save — fixed so it matches. (2) TODO — this only fixes
      same-session staleness; the actual on-device persistence path (host-rn's
      `NativeBridgeProvider.updateSettings` merging onto `asyncStorageSettings` — an
      AsyncStorage-backed `SettingsStore` in `data/embedded/settings-store.ts`, keyed
      `comical:embedded:settings:{bridgeId}`, shared with regular bridge settings) reads
      architecturally sound end-to-end from static inspection; confirming why it'd actually
      lose data across a real app-kill-and-relaunch on iOS needs on-device
      reproduction/logging, which wasn't done here.
- [ ] Buggy behavior when opening a bridge sub-page then changing the bridge, it uses the old bridge sub-page data
- [x] Loading skeletons for bridge series don't line up correctly with the legend list, this is worse on searches that have a "<- Home" button, we should account for that space
      DONE — two independent skeleton/grid mismatches, both in `(tabs)/index.tsx`: (1)
      `SkeletonCard` wrapped itself in the bare `cell` style instead of `gridCell`, so it
      lacked the same top/bottom padding real cards get — visible where it fills spare slots
      directly inside a real grid row (the `loadingMore` last-row filler) alongside
      `gridCell`-wrapped `SeriesCard`s. (2) `GridSkeleton`'s `skelRow` used `Spacing.three`
      (16px) as its column gap where the real grid's `columnWrapperStyle` uses
      `GRID_COLUMN_GAP` (8px) — double, so skeleton columns sat at different x-offsets than
      the real cards that replace them. Not actually caused by the back button's header row —
      the header (`listHeader`, including the back banner) is identical between the skeleton
      and loaded states of the same list instance, so it doesn't need separate accounting.
- [x] Navigating to a sub-page other then home, clicking a series, clicking a tag, then shows the search with "<- Home" instead of the correct sub page it came from
      DONE — the Series screen's `BrowseIntent` (`data/browse-intent.ts`) now carries an
      optional `originPage`. `series-card.tsx` forwards the Browse `page` it's rendered on as
      a `fromPage` route param (only from Browse's own results-grid card; other tabs omit it);
      `series.tsx` reads it and hands it back as `originPage` on a tag/meta tap; Browse's focus
      effect (`(tabs)/index.tsx`) does `setPage(intent.originPage ?? 'home')` instead of always
      forcing Home. From a different tab (no Browse sub-page to return to) it still falls back
      to Home, unchanged.
- [x] "<- Home" button feels very slow, it seems blocked on a network request maybe?
      DONE — not a network wait, a self-inflicted debounce: `exitDrilldown` cleared
      `filterValues`/`sortValue` but not the derived `committedFilters`/`committedSort` (only
      updated 500ms later by the filter-change debounce effect), and `inResults`/the back
      banner read the committed values — so a tag/filter-driven search (the only signal
      keeping `inResults` true, since it has no `query`) stayed on screen for up to
      `FILTER_DEBOUNCE_MS` after the tap. `exitDrilldown` now also clears
      `committedFilters`/`committedSort` synchronously.
- [ ] Investigate legend state
- [x] Come up with a way to open the app on iOS/android from a web button. This way a github repo can have a button that installs a registry with one click.
      (1) DONE — in-app half of the deep link: `comical://add-registry?url=<index.json
      URL>` now resolves (via expo-router's automatic scheme routing, `scheme: "comical"`
      in app.json) to a new confirm-and-add screen (`src/app/add-registry.tsx`) that calls
      `ds.addRegistry` and lands on `registry-browse`. Works today for anyone who already
      has the app installed; a bridge/tracker repo's README can link straight to it.
      (2) TODO — the "not installed yet" half. A plain `comical://` link silently no-ops
      if the app isn't installed, so a true one-click *install* needs Universal Links
      (iOS) / App Links (Android) on a verified HTTPS domain (comical-web's prod domain is
      the natural candidate) so the same `https://.../add-registry?url=...` link either
      opens the app or falls back to a landing page with store badges — this needs
      `.well-known/apple-app-site-association` + `assetlinks.json`, native config
      (`associatedDomains`/`intentFilters`), and an EAS rebuild (not OTA-able). Beyond
      that, carrying the registry URL *through* a fresh install (so it's auto-added on
      first launch rather than requiring a second tap) has no free solution on iOS short
      of a paid deferred-deep-link SDK (Branch/AppsFlyer/Firebase Dynamic Links) — ruled
      out as unwanted heavy deps; a lightweight fallback would be the landing page copying
      the registry URL to the clipboard before redirecting to the store, and the app
      offering to add it from the clipboard on first cold launch (accepts iOS's one-time
      "pasted from Safari" banner). Deferred pending appetite for the domain/EAS work.
- [ ] Have the URL show the bridge ID so we properly get back to the right bridge in various situations.
- [ ] A fair amount of flashing occurs when switching bridges ( on bot hthe filters and the cards )
- [x] Enable resuming from series details page if not already (i.e. instead of Read Chapter 1, it's Resume Chapter 3 or something), this should work when clicking the big series cover as well.
      The cover tap and primary button already shared `startReading()`, which already
      resumed correctly (both navigated to the history entry's chapter/page) — only the
      *label* was stale, always showing the server's `readLabel` (first chapter's name,
      e.g. "Chapter 1") since that value has no notion of this device's local reading
      history. Added a `resumeLabel` in `series.tsx` derived from the existing
      `resumeEntry` lookup — "▶  Resume {chapterName}" when there's a history entry (or
      plain "▶  Resume" for a direct/chapterless series), falling back to `readLabel`
      otherwise — and used it for both the primary button label and the cover's
      `accessibilityLabel`. Verified empirically with Playwright against the live dev
      server: opening "Sakamoto Days" (a mock history entry at "Days 1") now shows
      "▶ Resume Days 1" as the primary button (screenshot-confirmed).
      Follow-up: the label went stale after backing out of the reader — reading
      progress (`recordChapterProgress`/`recordReadingHistory` in `reader.tsx`) never
      invalidated the `['history', mock]` query, so `historyQuery`'s 5-min `staleTime`
      kept showing the pre-read position on return to the series screen. Both write
      paths now chain `queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) })`
      on success.
- [x] Navigating to a series view FROM a series view (i.e. recommended / related series) does'nt push the new series onto the nav stack, it replaces the current
- [ ] Related series scrolling seems bugged on iOS
- [x] When there aren't any related series / any content below a direct series page thumbnails, don't show the "Show all" button at all, just paginate
- [x] Virtual recycled page thumbnails don't show the loading placeholder, they show stale images. Look at how the bridge series cards do it.
- [x] Add hovering to UI elements in series details view
- [x] Make the #tags to cut off until showing the +X tags button row / viewport size relative, we can comfortably show more on desktop
- [x] The chapters header bar (overview, all, etc) shouldn't expand all the way to the width of the page, however, the sort should come right after it as well.
- [x] Clicking the page settings button after it's already open should close it, not re-open it.
      Fixed at the shared `useAnchoredOverlay()` hook level (`overlay.tsx`), not per
      call-site: `OverlayProvider.open()` now returns the id it assigned, and the
      provider exposes `topId` (the currently-topmost item). The hook remembers its
      own opened id and, if a second press comes in while that id is still topmost,
      calls `closeTop()` instead of opening another one — otherwise it opens/stacks
      as before. This covers every `useAnchoredOverlay()` consumer (settings gear,
      filter rows, selectors, tracker panel, etc.) automatically, with no call-site
      changes needed.
- [x] When the page pill is selected, it should select all of the text inside it
      Added `selectTextOnFocus` to the page-jump `TextInput` in `progress-pill.tsx`
      (the same established pattern `filter-button.tsx`'s `NumberFilterRow` already
      uses), so tapping the pill and typing immediately overwrites the current page
      number instead of requiring a manual select-all first. While in there, also
      fixed a related bug reported after this: tapping the "Go" button did nothing
      (only Enter worked) because tapping "Go" blurs the still-focused `TextInput`
      first, and the old `onBlur` closed the editing row synchronously — unmounting
      "Go" out from under its own press before it could fire. `onBlur` now defers the
      close by 200ms so a tap on "Go" (or Enter, which calls `submit` directly) gets
      a chance to complete first.
- [x] Keyboard page navigation shouldn't animate, it should instantly go to the next page like tapping
      Fixed: keyboard nav (`reader.tsx`) routed through the animated `prev`/`next`
      callbacks; switched to the instant `turnPrev`/`turnNext` (same ones tap zones
      use) and deleted the now-dead `prev`/`next`. Verified empirically with
      Playwright against the live dev server — track element's `style.transition`
      reads `"none"` after each keypress.
- [x] A/D should work like arrow keys <-/-> in reader pages
      Fixed: same keydown handler now treats `d`/`D` as `ArrowRight` and `a`/`A` as
      `ArrowLeft`, respecting `settings.direction` (rtl swap) like the arrows already
      did. Verified empirically — all four keys advance/retreat the correct page.
- [x] Up/down/W/S should scroll the webtoon view (smoothly up and down, ensure holding doesn't result in weird behavior) (left and right should do the full transition as it is now, but ensure when it's held it doesn't stutter as it does right now)
      Fixed: two parts. (1) `webtoon-reader.web.tsx` gained a smooth-scroll effect —
      Up/Down/W/S set `held.up`/`held.down` booleans and drive a `requestAnimationFrame`
      loop that moves `scrollTop` by a fixed `900px/sec * realDeltaTime`, so scrolling is
      frame-rate-independent and constant-speed instead of jumping per keydown; the loop
      self-terminates once both keys are released, and `keyup`/window `blur` clear the
      held state. (2) The Left/Right/A/D stutter was the browser's own OS-level key-repeat
      (uneven, sometimes very fast `keydown` events with `repeat: true`) driving page turns
      directly; `reader.tsx`'s keydown handler now ignores repeat events and instead fires
      the first turn immediately then drives repeats itself via a fixed `setInterval` at
      180ms, cleared on matching `keyup` or window `blur` — same fixed-cadence approach as
      the reader-nav interval it now double-purposes. Also added an INPUT/TEXTAREA focus
      guard to both handlers so the progress-pill's page-jump text field isn't hijacked by
      these keys. Verified empirically with Playwright against the live dev server: holding
      ArrowDown in webtoon+fit-width mode produced smooth ~165-180px/180ms scroll deltas
      (matching the 900px/sec target) that stopped instantly and cleanly on keyup with no
      drift 400ms later; ArrowUp reversed direction correctly. In paged mode, holding
      ArrowRight for ~1000ms advanced pages 1→7 via the controlled 180ms-interval cadence
      and stopped dead at keyup (no further advance 500ms later); ArrowLeft held for 600ms
      correctly reversed and also stopped cleanly.
- [x] Center screen tapping in reader view to open overlay should be a larger percentage of the tappable area
      Fixed: widened the center chrome-toggle zone from 20% to 40% of width on both
      web (`paged-reader.web.tsx`) and native (`zoomable-page.tsx`), a 30/40/30 split
      instead of 40/20/40. Verified empirically — a tap at x=450 of a 1280px-wide
      viewport (inside the new center band, was inside the old left band) now toggles
      chrome instead of turning the page.
- [x] Enable mouse hovering to show overlay (near top of screen and bottom for settings / page selector)
      Fixed: web-only `mousemove` listener in `reader.tsx` calls the existing
      `showChrome()` whenever the cursor is within 80px of the top or bottom edge,
      re-arming the auto-hide timer on every move inside the band so chrome stays up
      for as long as the cursor sits there. Verified empirically — sustained hover at
      the top edge (jittered moves over 3.5s) kept the toolbar's opacity at 1 the
      whole time, vs. it auto-hiding to 0 after 3s when the cursor isn't in the band;
      bottom-edge hover also confirmed.
- [x] On web, can't select any of the page reader overlay buttons after the first time it's shown
      Fixed: `ReaderToolbar`/`ProgressPill`/`SettingsControl` all embedded `pointerEvents`
      inside their `Animated.View`'s `style` array alongside a Reanimated
      `useAnimatedStyle` object. Reanimated's web `Animated.View` updates the animated
      (opacity) part of that array imperatively on the UI thread but wasn't reliably
      re-diffing the static `pointerEvents` sibling on every JS re-render — after a
      hide/show cycle the DOM node's raw inline style could be left with a stale
      `pointer-events: none`, invisible to the eye (opacity still animated correctly)
      but blocking clicks, so taps fell through to the page image underneath instead
      of hitting the gear/toolbar/pill. Moved `pointerEvents` to its own component
      prop (React Native's recommended form, and one RNWeb resolves to a stable atomic
      CSS class instead of a per-render inline style) on all three. Verified
      empirically with Playwright: reproduced the stuck `pointer-events: none` via
      `getComputedStyle`/raw `style` attribute inspection before the fix, then
      confirmed a second gear click after a hide/show cycle now reopens the settings
      popover (screenshot-verified).
- [x] Filter popups don't have hover highlighting on desktop. Fixed: `TriRow` and the
      `MultiEditor` option rows (filter-editors.tsx) never wired `useHover` at all, unlike
      every other row-list in the app; both now tint `backgroundSelected` on hover like
      `FilterButton`/`SortButton`/`OverflowChip` already did. Follow-up: the bridge/page
      picker (`selector.tsx`) had the same gap — its option rows were an inline anonymous
      `Pressable` with no `useHover` wiring. Extracted a `SelectRow` component (mirroring
      `MultiRow`/`TriRow`) so it tints on hover too.
- [x] Filters for single entry fields (bools/ints/strings) could use a little reworking, they shouldn't open up a new popup / overlay, they should be editable directly (for example, a bool should just be clickable as the whole thing, then the whole thing changes color to reflect bool state (with text on left showing true/false etc). The style of the filters along with their header labels should be preserved.
      Fixed: `FilterButton` (filter-button.tsx) now dispatches by `def.type` — `toggle`/
      `string`/`number` render inline (`ToggleFilterRow`/`StringFilterRow`/`NumberFilterRow`)
      directly on the row with no overlay; `multi`/`includeExclude`/`tags` still open the
      anchored overlay as before (`OverlayFilterRow`). A toggle's whole row is the control:
      tapping flips it and the row background switches to the accent colour with an "On"/
      "Off" label; number gets an inline −/+ stepper; string gets an inline text field. Same
      row height/radius/label styling preserved throughout.
- [ ] Mock data isn't really well mocked right now, it should instead be an artificially injected bridge that serves data exactly the same way (with delays internal to it)
- [x] Add a bool filter to a fake bridge so the toggle-filter control can actually be tested.
      First added to the `direct-example` demo bridge ("Illustration Gallery (Demo)"), but it
      still wasn't reachable through the running app after a rebuild+restart, so per feedback
      the same toggle was added to `example-bridge` ("Example (Demo Library)") instead —
      `getFilters()` now also returns `{ type: "toggle", key: "ongoing", label: "Ongoing
      only" }`, and `getListItems`/`getSearchResults` narrow to `data-status="ongoing"` cards
      when it's on (`fixture-backend.ts`'s `seriesCard()` now stamps that attribute, matching
      `direct-fixture-backend.ts`). Mirrored identically into `comical-app/external/comical`
      (the submodule the app actually bundles/typechecks from). Tests added in both copies
      (`bridges/example-bridge/test/conformance.test.ts`); confirmed live via
      `curl localhost:3100/bridges/example/filters` after a dev-server restart. `direct-example`
      keeps its own toggle too, just isn't the one used for day-to-day testing.
- [x] Date/int filter selectors should allow clicking the value to type it in via keyboard,
      not just +/- stepper taps. Superseded by dropping the stepper entirely (see below) —
      `NumberFilterRow` is now just a label + an always-mounted `TextInput`, no separate
      edit mode to swap into.
- [x] Click-to-type on number filters was hiding/resizing the whole row instead of just
      enabling typing in place (regression from the first pass above, which conditionally
      swapped a `Pressable`+`Text` for a differently-styled `TextInput`). Fixed by dropping
      the +/- stepper UI entirely, per feedback: `NumberFilterRow` (filter-button.tsx) now
      renders a single always-mounted `TextInput` (same pattern as `SearchField`) — tapping
      the value just focuses it in place, numeric keyboard, select-on-focus, clamped to
      `min`/`max` on blur/submit. No popup, no stepper buttons, no layout shift.
- [x] When the filter bar is squashed, text should shrink instead of hiding filter controls
      (e.g. "Minimum chapters" was pushing the old +/- stepper out of its slot entirely).
      Root cause: `FilterButton`'s shared `label` style was `flexShrink: 0`, so a long label
      never gave up width, and the row (inside `FilterBar`'s `filterSlot`, `flex: 1`) simply
      overflowed its slot — silently clipped by the bar's own `overflow: 'hidden'`, hiding
      whatever came after the label. `label` is now `flexShrink: 1, minWidth: 0` with
      `numberOfLines={1}` (+ `adjustsFontSizeToFit`/`minimumFontScale` as a native-only
      progressive enhancement — react-native-web doesn't implement font auto-shrinking, so
      truncation is the cross-platform guarantee that keeps the value visible). The stepper
      itself is gone now (see above), which frees up most of the row's width anyway.
- [x] String filter's inline text field wasn't aligned with its label and had a distracting
      default focus ring instead of a real highlight. Reused the exact pattern from the
      app's `SearchField`: the row reserves a `borderWidth: 1` always (`transparent` at rest)
      and turns `theme.accent` while focused, plus a `Platform.select({web: {outlineStyle:
      'none'}})` reset so the browser's native `<input>` focus ring no longer shows through.
      Re-reported as still misaligned after that first pass — actual root cause was missing
      `lineHeight`/incomplete `padding` reset on the `TextInput` versus `ThemedText`'s default
      metrics (`fontSize: 16, lineHeight: 24`); both `StringFilterRow` and `NumberFilterRow`'s
      inputs now set `padding: 0` (both axes) and `lineHeight: 24` explicitly. Placeholder
      color also made more subtle (`${theme.textSecondary}99`, translucent) instead of full
      `textSecondary`, so it reads as a hint rather than real content.
- [x] Filters that have more content than the overlay / popup allows, have weird bars on the top and bottom that cutoff the internal content when scrolling. We should just use the bounds of the overlay/popup. But ensure when scrolled to the top, the inner content isn't flush to the top, there should be a bit of space to keep it looking nice at the top.
      First attempt threaded the popover's measured content bound down through a new
      `OverlayContentBoundsContext` so `useListMaxHeight`'s manual pixel-budget arithmetic
      (window/anchor height minus handle/insets/gaps/safety-margin constants) sized against
      the popover instead of the sheet formula — this only patched the popover path and the
      cutoff reportedly persisted, since the whole approach was fragile (every consumer had to
      measure its own header via `MeasuredHeader`'s `onHeight` and hold that height in state;
      any slightly-off constant reintroduces the same bug). Replaced entirely with plain
      flexbox: `OverlaySheet`/`OverlayPopover`'s outer container gets an explicit `maxHeight`
      (window- or anchor-space-based), every wrapper in between gets `flex: 1, minHeight: 0`,
      and `OptionList` itself is `flex: 1, minHeight: 0, maxHeight: LIST_MAX_HEIGHT` (a 7-row
      UX cap, not a correctness cap) — so it fills exactly whatever space is left after its
      sibling header, computed by the layout engine, with zero manual height math anywhere.
      `useListMaxHeight`, `OverlayContentBoundsContext`, and every `onHeight`/`headerHeight`
      plumbing line were deleted (`overlay.tsx` + 6 consumers). Also kept the small
      `paddingTop` on the list's content so a scrolled-to-top list isn't flush against its own
      top edge.
- [x] Fixing the cutoff above revealed a full 1px border around the whole desktop popover
      card (`styles.popover`, previously clipped at the bottom by the cutoff bug so it went
      unnoticed) — reported as reading like an unwanted boxed-in outline, particularly along
      the bottom. Changed to `borderLeftWidth`/`borderRightWidth` only (dropped top/bottom),
      same color.
- [ ] Build a committed **fixture-registry e2e harness**, so registry states no real registry can
      produce become testable. The immediate gap: the contract-**incompatible** entry rendering in
      `registry-browse.tsx` ("Unsupported" instead of Install, plus a "Needs contract X · this app
      has Y" note) has no automated coverage — the repo convention is a Maestro flow per screen,
      and this state is unreachable from one, because every real bridge/tracker declares contract
      `1.0.0`, exactly what the runtime supports. It was verified once by hand against a throwaway
      `Bun.serve` registry. Commit that fixture instead (an `index.json` with a same-version pair
      of each kind — one at `contractVersion: "1.0.0"`, one at `"2.0.0"` — plus a stub bundle),
      start it alongside the web dev server in the e2e run, and add a flow that adds it as a
      registry and asserts the `registry-browse.{bridge,tracker}.<id>.unsupported` / `.install`
      testIDs. The same fixture then unlocks the other registry states real data can't reach: an
      entry with a pending update, a discontinued entry, and an id colliding across two registries.

## Publish `@comical/*` packages instead of tsconfig-paths/local-stub hacks

Shipped in PR #32 (`import-comical-contract-types`): `apps/mobile/src/data/api.ts`'s
hand-rolled `Api*` types (duplicating `@comical/contract`'s zod-inferred shapes) are
now `import type`/`export type` re-exports of the real types, resolved via a
`tsconfig.json` `paths` entry pointing straight at the sibling `comical` repo's
source (`../../../comical/packages/contract/src/index.ts`) — no new dependency, no
Metro config change. Being type-only, the import is fully erased by Babel before
Metro bundles anything, so this has zero runtime/CI impact today: confirmed
`expo export --platform web` builds clean and the served bundle has zero
`require("@comical/contract")` references.

- **The catch, confirmed by testing:** this only works because nothing in CI
  currently runs `tsc`/`bun run typecheck` — verified by temporarily pointing the
  `tsconfig.json` path at a nonexistent directory (simulating "no sibling `comical`
  checkout," which is CI's actual state) and re-running `bun run typecheck`: it
  fails with `TS2307: Cannot find module '@comical/contract'`. So a local `comical`
  checkout next to `comical-app` is required for type-checking/editor support, but
  is silently unnecessary for building/shipping — an easy footgun if a typecheck
  CI step is ever added without also fixing this.
- **Future fix — once `comical` (starting with `@comical/contract`) is published:**
  drop the `tsconfig.json` paths entry entirely and add it as a real
  `package.json` dependency resolved through GitHub Packages. This needs the
  scope-auth infra that used to live here for the (now-removed) `@porksphere/core`
  stub: an `.npmrc` mapping the scope to `npm.pkg.github.com`, plus a
  `NODE_AUTH_TOKEN` with `read:packages` on the `bun install` CI steps
  (`build-android`/`build-ios`/`deploy-web`) — both were deleted when the stub went,
  so re-add them then. A genuinely published package needs no
  `watchFolders`/`nodeModulesPaths` Metro hacks (those remain only for the
  `@comical/*` submodule source resolution). This removes the "must have a sibling
  checkout" caveat above and makes it safe to add a `typecheck` CI step.
- **`@comical/library`/`@comical/runtime` are a different, bigger lift:** unlike
  `@comical/contract` (type-only usage today, could stay a `devDependency`), these
  are real runtime code Metro must actually bundle for the on-device API→library
  connectivity the app will eventually need — per `apps/mobile/AGENTS.md`, blocked
  until a Hermes/QuickJS-compatible `BundleEvaluator` exists
  (`comical/packages/core/src/evaluator.ts`, Node-`vm`/browser-`new Function()`
  evaluators only today). Once that lands, they'd need the full
  published-GitHub-Packages-dependency treatment (real `dependency`, Metro resolves
  through `node_modules` same as above) rather than any tsconfig-paths trick — but if the
  publish pipeline is already built for `@comical/contract`, extending it to these
  is close to free.

## Perf: virtualize composed-home rails (mount/memory — NOT scroll)

From the card-scroll perf investigation (2026-07). Browse's composed home is already one
vertical scroll: a single `SeriesGrid` (`AnimatedLegendList`) whose `ListHeaderComponent`
(`listHeader` in `src/app/(tabs)/index.tsx`) holds *all* the rails + section blocks, with the
terminal section's cards as the grid's `data`.

The catch: **`ListHeaderComponent` is never virtualized.** So every rail on a composed home is
mounted at once (N rails = N live horizontal `AnimatedLegendList`s), even ones scrolled far
off-screen. That's a **mount/memory** cost, *not* a per-scroll-commit cost — during a vertical
scroll the rails sit static in the header and don't re-commit, so this is unrelated to the
`completeRoot`/`replaceContainerChildren` scroll cost (that's the terminal grid's row commits,
already optimized in the perf commits `8efaf7f`→`7f83bbb`).

**Fix (only if a rail-heavy composed home shows an enter/mount lag):** make the rails
**virtualized items of the vertical list** instead of header children — outer `data` =
`[rail-1 … rail-N, grid-rows…]`, `renderItem` switching on item type (`<Rail>` vs card-row), so
off-screen rails unmount (the Netflix-home pattern).

**Caveats / why it's not obviously worth it:**
- Does **nothing** for the scroll-commit jank (rails don't commit during scroll).
- Cards **still** can't recycle between a rail and the grid — horizontal vs vertical scroll axis =
  separate virtualization pools. Architecturally impossible, not a bug.
- Mixed item types + variable heights (rails tall, grid rows short) make `estimatedItemSize`
  fuzzier; LegendList recycling across item types is limited, so rails likely mount/unmount
  rather than recycle (acceptable — they're few).
- Re-tangles the crossfade / reveal-dim / sliding-header wiring on `index.tsx`.

**Decision gate:** first confirm a composed-home *enter/mount* actually lags at a realistic rail
count. Skip if homes are only ~3–5 rails.

### SPIKED on branch `spike/virtualize-home-rails` (2026-07-13, commit 69deefe)
Full-fidelity build of the fix above: a new `components/home-feed.tsx` (`AnimatedLegendList`,
`numColumns=1`) renders a flat `HomeRow[]` (`data/home-rows.ts`: rail / gridBlock / terminalHead /
gridRow + skeletons) built by `buildHomeRows` in `index.tsx`, which now branches
`!inResults ? <HomeFeed> : <SeriesGrid>`. `HomeGridBlock` was extracted to its own file (kept its
own `useInfiniteQuery` "Load more" — pages survive unmount via the query cache). `rail.tsx` exports
`railRowHeight()`/`SECTION_HEAD_HEIGHT` for `getFixedItemSize`. A "Rail Stress (Demo)" mock bridge
(18 rails) was added to profile against. Builds clean (typecheck: no new errors; web export OK).
**Still un-measured** — needs a browser/on-device run to (1) confirm off-screen rails unmount,
(2) profile enter/mount stress-home before vs. after, (3) check the two risks: the rail title-peek /
iOS long-press lift not being clipped by the virtualized item container, and the See-all↔exit
transition (now a HomeFeed↔SeriesGrid remount, not crossfaded — brief skeleton flash). Decide
merge-or-drop from that measurement.

## Perf: release-jank investigation plan (A–D)

A **release** build was confirmed janky (2026-07) — so this is real, not dev-mode overhead. All the
dev-profile wins (`8efaf7f`→`7f83bbb`) shipped; remaining plan, in order:

- **A. Get a release profile (DO FIRST).** `react-native-release-profiler` works in release. Link
  its pod into a release build, expose start/stop behind the Settings toggle instead of `__DEV__`,
  and — release has no Metro to receive the upload — have `stopProfiling(true)` save the trace to
  device Files and share it out (OS share sheet). One capture of the janky moment ranks B/C/D:
  Fabric commit vs image decode vs bridge marshaling. **In progress.**
- **B. If it's the embedded bridge/fetch.** Scraping runs off-thread in the native engine
  (JSC/QuickJS), BUT the `@comical/host-server` router, the cross-engine proxy marshaling (JSON in/out),
  and result processing (`JSON.parse` + React-Query normalize/dehydrate) all run **on the Hermes JS
  thread**. So a big payload landing stalls the render thread. Manifests at **fetch boundaries**
  (loadMore mid-scroll, screen open, bridge/page switch), NOT pure scroll. Precedent: the ~400ms
  dehydrate stall `shouldDehydrateQuery` fixed. Fixes: defer result-processing via
  `InteractionManager.runAfterInteractions`; shrink payloads / defer heavy fields (tags, description)
  to the detail fetch; smaller pages; move marshaling `JSON.parse` off-thread if the native module allows.
- **C. If it's rendering (Fabric persistent commit).** Tune LegendList `drawDistance` down (smaller
  render window = fewer rows committed per step); virtualize composed-home rails (only if *enter*-lag —
  see section above); keep trimming the card's host-view count.
- **D. If it's image decode.** Ensure bridges serve **thumbnail-sized** covers, not full-res
  (downsample at source / via expo-image); limit concurrent decodes. Many full-res decodes during a
  fast fling is a classic RN scroll killer. (Cover-size audit of the API-based bridge in progress —
  it passes covers through from the source un-resized, so cover size = whatever the source stores.)

### What actually shipped from A (release profile, 2026-07-12)
Release profile (real binary, dev noise gone): **80% idle** — the felt jank is spikes, not load. Top
JS costs were **`propagateParentContextChanges` 20%** (React 19 context walk) and **GC ~11%** (the
biggest single stalls); Fabric commit was only ~7% (C was over-weighted). Both #1 and #2 traced to
**render churn + allocation**, not the commit. Fixes shipped:
- **GC:** build the card `href` lazily on press instead of per render (`series-card.tsx` `buildHref`).
- **Context walk (#1 cost):** the 20% was a *symptom* of LegendList re-measuring variable-height cards
  every scroll (`commitLayoutEffect → measure → set$/updateItemSizes → batchedUpdates → the walk`).
  Fixed by pinning every grid cell to a constant height (`series-grid.tsx` `cellHeight`, matching
  `estimatedItemSize`) so rows never re-measure. Theme itself was a red herring (stable, no new context).

### TODO — extend the card fixes to series-page page thumbnails
The two fixes above landed on the series-CARD grid only. The series page's **page-thumbnail grid**
(`PageThumb`/`PageThumbList`, `components/series/chapters-section.tsx`) has the same variable-row
re-measure problem and should get the same treatment (fixed-height cells + lazy per-render alloc).
IMPORTANT: `PageThumb` also renders inside the card long-press popup (`series-card-context-menu.tsx`),
so the fixed height can't be baked into `PageThumb` itself — the series page and the popup should each
wrap it in a container that supplies the fixed height for that context.
