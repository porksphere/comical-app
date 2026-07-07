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
- [ ] Excluded tags don't appear to persist on iOS between restarts (unsure about genres)
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
