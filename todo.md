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
- [ ] Infinite paging loading skeleton doesn't add skeleton entries to incomplete rows,
      it should ideally finish an incomplete row then add an additional row (the
      loaded grid already padded a short last row with invisible spacer cells so it
      wouldn't stretch, but that padding stayed blank even while a next-page fetch was
      in flight — the fresh skeleton rows below it always started a new row rather
      than finishing the one already on screen. Those spacer cells now render as
      skeleton cards instead of blank views while `loadingMore` is true.)
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
- [ ] Related series scrolling seems bugged on iOS
- [ ] When there aren't any related series / any content below a direct series page thumbnails, don't show the "Show all" button at all, just paginate
- [ ] Buggy behavior when opening a bridge sub-page then changing the bridge, it uses the old bridge sub-page data
- [ ] Virtual recycled page thumbnails don't show the loading placeholder, they show stale images
- [ ] Navigating to a series view FROM a series view (i.e. recommended / related series) does'nt push the new series onto the nav stack, it replaces the current
- [ ] Loading skeletons for bridge pages don't line up correctly with the legend list, this is worse on searches that have a "<- Home" button, we should account for that space
- [ ] Navigating to a sub-page other then home, clicking a series, clicking a tag, then shows the search with "<- Home" instead of the correct sub page it came from
- [ ] "<- Home" button is very slow on iOS
- [ ] Enable resuming from series details page if not already (i.e. instead of Read Chapter 1, it's Resume Chapter 3 or something)
- [ ] Keyboard page navigation shouldn't animate, it should instantly go to the next page like tapping
- [ ] A/D should work like arrow keys <-/-> in reader pages
- [ ] Up/down/W/S should scroll the webtoon view (smoothly up and down, ensure holding doesn't result in weird behavior) (left and right should do the full transition as it is now, but ensure when it's held it doesn't stutter as it does right now)
- [ ] Center screen tapping in reader view to open overlay should be a larger percentage of the tappable area
- [ ] Enable mouse hovering to show overlay (near top of screen and bottom for settings / page selector)
- [ ] On web, can't select any of the page reader overlay buttons after the first time it's shown
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
      The `direct-example` demo bridge (`comical/bridges/direct-example`, "Illustration
      Gallery (Demo)") had no `getFilters()` at all. Added `capabilities: [..., "filters"]`
      and `getFilters()` returning a single `{ type: "toggle", key: "ongoing", label:
      "Ongoing only" }`; `getListItems` now reads a new `data-status` attribute the fixture
      backend (`@comical/testkit`'s `DirectFixtureBackend`) stamps on each catalog card and
      filters to `status === "ongoing"` when the toggle is on. Added one `"ongoing"`-status
      fixture entry ("Serialized Oddities") since all six original catalog entries were
      `"completed"`, which would've made the toggle filter everything away with nothing left
      to show. Mirrored identically into `comical-app/external/comical` (the submodule the
      app actually bundles/typechecks from — see its own `CLAUDE.md`/AGENTS notes) and
      rebuilt its bridge dist so the running app picks it up. Tests added in both copies
      (`bridges/direct-example/test/filters.test.ts`); full `bun test` suite still green in
      both the sibling `comical` checkout and the submodule.
- [x] Date/int filter selectors should allow clicking the value to type it in via keyboard,
      not just +/- stepper taps. There's no separate date filter type in `FilterDef`
      (`filter-types.ts` only has `number`), so this applies to `NumberFilterRow`
      (filter-button.tsx): tapping the current value now swaps it for an inline `TextInput`
      (numeric keyboard, autofocus, select-on-focus) that commits (clamped to
      `min`/`max`) on submit or blur, falling back to the prior value if what's typed isn't a
      finite number.
- [x] When the filter bar is squashed, text should shrink instead of hiding the +/- stepper
      buttons (e.g. "Minimum chapters" was pushing the stepper out of its slot entirely).
      Root cause: `FilterButton`'s shared `label` style was `flexShrink: 0`, so a long label
      never gave up width, and the row (inside `FilterBar`'s `filterSlot`, `flex: 1`) simply
      overflowed its slot — silently clipped by the bar's own `overflow: 'hidden'`, hiding
      whatever came after the label. `label` is now `flexShrink: 1, minWidth: 0` with
      `numberOfLines={1}` (+ `adjustsFontSizeToFit`/`minimumFontScale` as a native-only
      progressive enhancement — react-native-web doesn't implement font auto-shrinking, so
      truncation is the cross-platform guarantee that actually keeps the stepper visible);
      `stepper` got an explicit `flexShrink: 0` so it's never what gives way.
- [x] String filter's inline text field wasn't aligned with its label and had a distracting
      default focus ring instead of a real highlight. Reused the exact pattern from the
      app's `SearchField` (the reference the feedback pointed at): the row now reserves a
      `borderWidth: 1` always (`transparent` at rest) and turns `theme.accent` while
      focused/editing, plus a `Platform.select({web: {outlineStyle: 'none'}})` reset so the
      browser's native `<input>` focus ring no longer shows through. Applied to both
      `StringFilterRow` and `NumberFilterRow`'s new inline edit mode (see above), so number
      and string filters share the same focus treatment as the search field.
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
