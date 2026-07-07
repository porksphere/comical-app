- [x] Overlay system has slowed down after adding more filter UI (`FilterButton` was
      unmemoized and re-created its `onChange` closure per render, so any one filter
      change re-rendered every sibling; `OverlayProvider` called every open overlay's
      `render()` afresh on each of its own re-renders too. Fixed: `FilterButton` is
      `React.memo`'d and takes `onChange: (id, v) => void` directly instead of a
      per-item closure, wired to a `useCallback`-stabilized setter in Browse; overlay
      items now store the rendered `ReactNode` once at `open()` time instead of a
      `render` function re-invoked every render.)
- [ ] Add "page" favoriting mechanism
- [x] More hover highlights on desktop web, feels bery unresponsive right now (new
      shared `useHover` hook, `apps/mobile/src/hooks/use-hover.ts`, wired into
      `FilterButton`, the sort/overflow chips, `Selector`'s bridge/page trigger, and
      the desktop top-right tab icons — all tint with `theme.backgroundSelected` on
      hover now.)
- [x] Thumbnail top bar very cramped on mobile (`Selector`'s trigger set `flexShrink:
      1` but not `minWidth: 0` — and RN's default `flexShrink` is 0, unlike web CSS's
      1 — so the truncating label never actually got to shrink against its sibling;
      it just crowded the row. Added `minWidth: 0` to the trigger and `flexShrink: 1`
      + `minWidth: 0` to the label itself.)
- [x] Desktop web version of overlay system, looks a bit odd on desktop to deal with a swipedown
- [x] When refreshing page on narrow web viewports, the filters briefly display all
      small and cramped then correctly collapse into overflow (the bar's width comes
      from its parent's flex layout, not from its own children, so on the very first
      render — before `onLayout` reports the real width — `fitCount` fell back to
      showing every filter uncollapsed. Now that first frame renders at `opacity: 0`
      instead, so the fit is only ever seen already correct.)
- [x] Flashlist investigation (used legend list instead)
- [ ] Investigate if we can have varied height thumbnails without weird page shifting now that we use legend list
- [x] Line highlight on search field does not appear on mobile after closing keybkard
      and immediately reselecting (the Android-web keyboard-close workaround just set
      `focused` to `false` directly, desyncing app state from the real DOM focus — the
      `<input>` never actually lost it — so retapping never fired a fresh `focus`
      event. Now it calls `.blur()` on the input instead, forcing a real DOM blur so
      state updates via the normal `onBlur` handler and a later tap fires a genuine
      `onFocus`.)
- [x] Chapter sorting in the series details view is weird, example -> sakamoto days is
      weird (sorted purely by `date`/publish timestamp, never by parsed chapter number
      — mock data's `date` happens to stay perfectly monotonic with chapter number,
      masking the bug there, but any real bridge with same-day batch uploads, backfills,
      or bonus chapters uploaded out of order will show a `date` order that disagrees
      with the true sequence. Now parses the chapter number out of the display name
      — "Chapter 176 — ..." → 176 — as the primary sort key, falling back to `date`
      only when a number can't be parsed from one side, e.g. a oneshot/extra.)
- [x] There are some expo WARNS, fix em
      Web  WARN  "shadow*" style props are deprecated. Use "boxShadow". (converted
      every `shadowColor`/`shadowOpacity`/`shadowRadius`/`shadowOffset` block to a
      `boxShadow` string, across overlay.tsx, series-card.tsx, card-badge.tsx, series.tsx)
      Web  WARN  props.pointerEvents is deprecated. Use style.pointerEvents (moved
      every `pointerEvents="..."` JSX prop into its `style` array instead — ~20 call
      sites across overlay, filters, tabs, and reader components)
- [x] Clicking on a "popular" shows the back arrow to go home, "popular" should be a
      top level page, nothing selected in the page selector should result in showing
      more for a certain category/rail (the "← Home" banner was gated on the same
      `inResults` flag used for grid-vs-rails layout, so picking any page-flagged list
      from the Page selector — not just search/filter/"See all" — showed it, even
      though the Page selector itself already shows which page is active and is how
      you get back to Home. Split it into a separate `showBackBanner` that drops the
      plain page-selection case, keeping the banner only for actual drill-downs
      layered on top — search, "See all", or a live filter/sort — same as it would
      from Home; a rail's "See all" ("nothing selected in the page selector", i.e.
      still on `page === 'home'`) is unaffected and keeps showing "more" for that rail.)
- [x] Infinite paging loading skeleton doesn't add skeleton entries to incomplete rows,
      it should ideally finish an incomplete row then add an additional row (the
      loaded grid already padded a short last row with invisible spacer cells so it
      wouldn't stretch, but that padding stayed blank even while a next-page fetch was
      in flight — the fresh skeleton rows below it always started a new row rather
      than finishing the one already on screen. Those spacer cells now render as
      skeleton cards instead of blank views while `loadingMore` is true.)
- [ ] Support landscape image cards
- [x] The mock data should all be non-existant website names, we don't want to associate with any scraping (mock bridge names replaced; scrubbing git history was assessed and declined — would've required force-pushing ~86% of main's commits)
- [ ] Infinite series scroll: an incomplete last row loses its already-loaded thumbnails
      when the loading skeleton disappears. Once the next page settles, the whole
      incomplete row appears to clear its covers, not just the still-unloaded cells —
      the loaded ones should stay put. Likely the spacer→skeleton→real-cell transition
      for that partial row re-keys/re-mounts the already-rendered cards (see the
      "Infinite paging loading skeleton" item above that made spacer cells render as
      skeletons while `loadingMore`).
- [ ] VirtualizedList perf warning in the Android debug log: `VirtualizedList: You have
      a large list that is slow to update - make sure your renderItem function renders
      components that follow React performance best practices like PureComponent,
      shouldComponentUpdate, etc. {"contentLength": 7281.90478515625, "dt": 559,
      "prevDt": 1447}`. Audit the grid's `renderItem`/cell components for unmemoized
      props/closures forcing re-renders (relates to the Flashlist investigation item).
- [ ] Series `isFavorite` check fires a slow per-series scrape on every open. The star
      state (`GET /bridges/{id}/favorites/{seriesId}`, `SeriesBody` in `series.tsx`) is
      requested ~immediately on opening any series with a bridgeId, and on atsumaru it's
      a 1–4s scrape purely to fill the ★/☆ label. (1) Make the Favorite action button
      **visibly disabled until the state resolves** — today `favorited` is `null` while
      loading so `toggleFavorite` no-ops, but the button still renders as a tappable
      `☆ Favorite`; give `ActionButton` a `disabled` while `favorited === null`. (2)
      Investigate avoiding/deferring the scrape itself: only fire it for a
      favorites-capable bridge, and/or defer well past the open (e.g. on first
      interaction with the actions) instead of on mount. Keyed `['isFavorite', mock,
      bridgeId, seriesId]`, 5-min staleTime, and excluded from the persisted disk cache
      (see the query-client persist fix), so it re-scrapes after an app restart too.
- [ ] Virtualize the series screen's chapter list + page-thumbnail grid. Today neither
      is virtualized: `ChaptersSection` renders chapter rows with plain `head.map`/
      `tail.map` (+ a first-N/last-N collapse), and `PageThumbGrid` renders `.map` with
      a home-grown progressive-reveal *sentinel* — a `setInterval` (250ms) that polls
      its on-screen position and streams in `BATCH_ROWS` at a time. Both live inside the
      series screen's `ScrollView`, and that's the reason: a vertical VirtualizedList
      (FlatList/LegendList) can't be nested in a `ScrollView`, so the `.map` + sentinel
      is the deliberate workaround. Proper fix = convert `series.tsx` from a `ScrollView`
      to a single `LegendList` (hero/meta/tabs → `ListHeaderComponent`, related rails →
      `ListFooterComponent`, chapters or page-thumbs → the list `data` with `numColumns`
      for the page grid), which lets us delete the sentinel entirely. Payoff is memory on
      a 300+ chapter/page series and removing the polling hack — NOT the nav stall: a
      React `<Profiler>` wrapped around the series body logged zero commits ≥80ms during
      the on-device js-jank, so chapter/page *rendering* is not what stalls the thread
      (that traced to per-card image work, since fixed). Highest-risk part is the web
      large-screen sticky cover-column (`leftColSticky`, a `position:sticky` inside the
      current ScrollView) + the chapter tabs/sort header, both of which the LegendList
      restructure has to preserve. Do it as its own isolated change, not bundled with
      unrelated work. Related: the js-jank/nav-timing investigation that ruled render out.

## Reader (page viewer)
- [x] Image retry-with-backoff on page load failure (currently just shows a placeholder) —
      `reader-page.tsx` retries automatically (1s/2s/4s) then falls back to a tappable
      Retry chip. Required a companion fix in both native (`zoomable-page.tsx`,
      `webtoon-reader.tsx`) and web (`paged-reader.web.tsx`, `webtoon-reader.web.tsx`)
      so the turn-page/toggle-chrome tap zones don't swallow the Retry tap on a
      failed page — web's Paged reader in particular runs its own pointer-capture
      gesture system that would otherwise never let the nested Retry button see a
      pointerup at all.
- [x] Prefetch N pages ahead for smoother paging — within-chapter prefetch already
      existed; `reader.tsx`'s warm-ahead effect now also prefetches the next
      chapter's first few page *images* (not just its page-URL list) once it's
      warmed into the query cache.
- [x] "Next chapter" sentinel / auto-advance at the end of a chaptered read — fully
      automatic (no confirmation UI) in both Paged and Webtoon modes, on native and
      web. Falls back to a real `seriesDetail` fetch when the next chapter isn't
      already cached (e.g. opened via History's Resume, bypassing the series
      screen) so it doesn't silently fail to advance. Also fixed a related
      pre-existing bug where the web Paged/Webtoon readers could visually strand on
      page 1 when deep-linked to a non-zero start page, since their internal
      position only seeded from `initialPage` once at mount.
- [x] Persist read progress ("continue reading") across sessions — chapter-progress
      recording already worked; the series screen's own "Read" button now resumes
      from the last-read chapter/page (via the same reading-history lookup the
      History tab's Resume action already used) instead of always restarting.
- [x] Overlay does not stay open when in settings / typing page — settings moved to
      the shared overlay system (see below), which has its own lifecycle fully
      decoupled from the chrome auto-hide timer; the page-number input now
      explicitly suspends/resumes that timer while editing.
- [x] Settings look ugly on ios in general, they should peobably take up most of the
      screen — reader settings now open via the app's existing overlay system
      (`components/overlay/overlay.tsx`), the same one Browse's filter UI uses: a
      near-full-width bottom sheet with a drag handle on mobile, and an anchored
      popover (matching the filter buttons) on wide desktop web instead of a sheet.

## Add real crash reporting (Sentry) — no way to see iOS crashes today

Worked on branch `claude/ios-crash-launch-drvv37`. Spent a full evening chasing an
iOS launch crash blind: the only signal available was `.ips` files manually pulled
off the device (Settings → Privacy → Analytics Data), which never carry the actual
JS error/stack — only that React Native's default fatal handler aborted the
process. Three JS-level interception attempts (`global.ErrorUtils.setGlobalHandler`,
plain / deferred-alert / re-installed-after-require) all failed identically — that
particular crash never reached `ErrorUtils` at all. Only a hand-rolled native
`RCTSetFatalHandler` hook (injected into `AppDelegate.swift` via an Expo config
plugin) finally surfaced it: a `react`/`react-native-renderer` version mismatch
(see the entry below — now fixed and guarded against). That diagnostic plugin was
real but the *wrong* shape for production (its first attempt — showing the alert
immediately — itself crashed by racing iOS's scene-connection lifecycle creating a
fresh `UIWindow`; even fixed, it's a one-off hand-rolled tool, not a permanent
capability) and has been removed. The actual fix: **`@sentry/react-native`**.

- **Why Sentry specifically, not another hand-rolled hook:** it hooks both JS
  errors *and* native crashes (NSException/signal handlers) at the same low level
  the diagnostic plugin reached for, but solved correctly — no UIWindow/scene
  timing landmines, because it persists the crash report to disk and uploads on
  the *next* launch rather than trying to act mid-crash. Free tier is fine for a
  side-loaded hobby app; no Apple Developer account needed, just network egress at
  crash-report-upload time.
- **Setup, specific to this repo's pipeline:**
  - [x] Added `@sentry/react-native` to `apps/mobile/package.json` (via
        `bunx expo install`, which picked `~7.11.0` as the SDK-56-compatible
        version — not the interactive `@sentry/wizard`, which assumes a plain
        npm/yarn flow and prompts for a login this pipeline can't do
        non-interactively) and the `@sentry/react-native/expo` config plugin
        to `app.json`'s `plugins`, plus `apps/mobile/metro.config.js` now uses
        `getSentryExpoConfig` (needed for the bundle's Debug ID — not
        mentioned above, but required for sourcemaps to symbolicate at all).
  - [x] Confirmed: this repo does **not** use EAS Build, and that's fine —
        `apps/mobile/ios`/`android` are gitignored and regenerated by
        `expo prebuild` on every CI run, so the Sentry Expo plugin's
        prebuild-time native patching (Xcode build-phase script + Gradle
        plugin injection) runs fresh every build; no separate explicit
        `sentry-cli`/export step was needed after all. Wired
        `SENTRY_AUTH_TOKEN` through `on.workflow_call.secrets` + job `env` in
        both reusable workflows, and `secrets: inherit` on the three caller
        jobs (`build-ios.yml`, `build-android.yml`, `release.yml`'s `ios`/
        `android` jobs) — safe since none of them trigger on `pull_request`.
  - [x] Wired `Sentry.init({ dsn: ... })` at the top of `src/app/_layout.tsx`
        (no separate `instrument.ts` — `main` is fixed to `expo-router/entry`
        by Expo Router, and Sentry's own Expo Router docs put `init` directly
        in `app/_layout.tsx`), disabled on web (`Platform.OS !== 'web'` — the
        `deploy-web.yml` GitHub Pages preview is a public, unauthenticated
        URL with no native crash surface, no reason to burn free-tier quota
        on anonymous visitors there), default export wrapped in `Sentry.wrap`.
  - [x] Kept the existing root `<ErrorBoundary>` (`src/components/error-boundary.tsx`,
        wraps everything in `_layout.tsx`) — Sentry doesn't replace it. The boundary
        still gives a friendlier in-app recovery screen for render-phase errors;
        Sentry is for *capturing* the error (with stack/breadcrumbs) regardless of
        where it's thrown, including the event-handler/effect/native-crash cases
        the boundary structurally can't catch. Added `Sentry.captureException`
        to its `componentDidCatch`.
  - [x] Real Sentry project created (org `comical`, project `comical-app`,
        platform React Native) — `app.json`'s `organization`/`project` and
        `src/lib/sentry.ts`'s default DSN now use the real values instead of
        `TODO-SENTRY-*` placeholders.
  - [x] `SENTRY_AUTH_TOKEN` repo secret added (Organization Auth Token).
        Confirmed working end-to-end via a manual `workflow_dispatch` run of
        `build-android.yml` (run #44): first attempt (#43, no `@sentry/cli`
        devDependency yet) failed with `A problem occurred starting process
        '.../node_modules/@sentry/cli/bin/sentry-cli'` — Bun's isolated
        linker only symlinks a package into `apps/mobile/node_modules` when
        it's a *direct* dependency of that workspace, and `@sentry/cli` was
        only a transitive dep of `@sentry/react-native`, so the Gradle task
        Sentry's plugin injects (which shells out to that exact path)
        couldn't find it. Fixed by adding `@sentry/cli` as an explicit
        `apps/mobile` devDependency. Re-run succeeded and the log shows the
        real upload: `Uploaded files to Sentry` / `Organization: comical` /
        `Projects: comical-app` / `Release: com.porksphere.comical@0.0.1+1`,
        with a Debug ID matching the one Metro embedded in the bundle — the
        sourcemap pipeline is confirmed live, not just "didn't crash the
        build." Since this is a public repo, Actions minutes are free
        regardless of runner OS, so also ran `build-ios.yml` (run #54, no
        code changes needed — same `@sentry/cli` fix covers both platforms)
        and confirmed both halves of the iOS path: sourcemap upload
        (`Uploaded files to Sentry` / `Organization: comical` /
        `Projects: comical-app`) *and* dSYM upload (`Found 22 debug
        information files` → `Prepared debug information files for upload`
        → `File upload complete`). Both platforms' CI pipelines are now
        confirmed working end-to-end, not just "builds successfully."
  - [ ] **Still to do:** the actual on-device verification — a deliberate
        `throw` in a button handler should show up in the Sentry dashboard,
        symbolicated (real file/line, not a minified offset), within the
        unsigned/sideloaded build. Also worth a one-time check that Sentry's
        *native* crash capture (not just the JS handler) actually catches
        something like the original react/react-native-renderer mismatch,
        since that's the whole reason this work exists —
        `Sentry.nativeCrash()` is a lower-effort synthetic test if
        reproducing the original bug is too invasive.

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
  `package.json` dependency resolved through GitHub Packages, exactly like the
  already-documented `@porksphere/core` cut-over plan (`README.md`'s "The
  business-logic core" section — `.npmrc` maps a scope to `npm.pkg.github.com`,
  `NODE_AUTH_TOKEN` with `read:packages` auth's CI, `bun install --frozen-lockfile`
  resolves it like any other package). No `watchFolders`/`nodeModulesPaths` Metro
  hacks needed for a genuinely published package — those exist only for
  `@porksphere/core`'s current *local stub* dev-linking, not real npm resolution.
  This removes the "must have a sibling checkout" caveat above and makes it safe to
  add a `typecheck` CI step.
- **`@comical/library`/`@comical/runtime` are a different, bigger lift:** unlike
  `@comical/contract` (type-only usage today, could stay a `devDependency`), these
  are real runtime code Metro must actually bundle for the on-device API→library
  connectivity the app will eventually need — per `apps/mobile/AGENTS.md`, blocked
  until a Hermes/QuickJS-compatible `BundleEvaluator` exists
  (`comical/packages/core/src/evaluator.ts`, Node-`vm`/browser-`new Function()`
  evaluators only today). Once that lands, they'd need the full
  `@porksphere/core`-style treatment (real `dependency`, Metro resolves through
  `node_modules` same as above) rather than any tsconfig-paths trick — but if the
  publish pipeline is already built for `@comical/contract`, extending it to these
  is close to free.

## react/react-native-renderer version guard (shipped)

`apps/mobile/scripts/verify-react-versions.js` runs as a `postinstall` hook (so
every `bun install`, local or CI, checks it automatically — no separate CI step
needed). It compares the installed `react` version against the version string
baked into react-native's *bundled* `react-native-renderer` (not a resolvable npm
dependency — it ships inside `react-native`'s own published files, hard-locked to
whichever React version that release was built against). A normal peer-dependency
range (react-native@0.85.3 declares `"react": "^19.2.3"`) is too loose to catch
this — `19.2.7` legitimately satisfies that range while still being a fatal,
exact-version mismatch at runtime. This is exactly the class of bug the Sentry
work above would also have caught (eventually, after the first crash report came
in) — the guard script catches it before a single build is even attempted.

## Web document-level scroll (so iOS collapses its browser toolbar)
Full design + risk register + verification plan: **`apps/mobile/docs/web-document-scroll-plan.md`**.
Worked on branch `claude/mobile-topbar-scroll-animation-m7xqot` (the mobile top-bar
animation + bottom-bar fade are already shipped there; this is the remaining piece).

Context to resume cold:
- **Goal:** on web mobile, scrolling down should let iOS Safari/Chrome collapse their
  bottom toolbar (~60px). They never do today because the app scrolls an inner
  `<div>` (the Browse `FlatList`), not the document — iOS only collapses on a
  *document/root* scroll.
- **Why it's not a one-liner (proven via Playwright on a real `expo export`):** the
  documented fix (remove `<ScrollViewStyleReset/>` in `src/app/+html.tsx`) is NOT
  enough. ~12 framework-generated `flex:1` navigator divs (expo-router Stack+Tabs)
  cap height; removing the reset alone collapses the chain to `0px`. The document
  only scrolls when `height/flex-basis` is overridden on ALL ~12 divs, and there's
  no class selector that targets only them (`r-13awgt0` = RNW `flex:1`, app-wide).
- **Can't just swap the list (researched):** RNW `FlatList`/`ScrollView` don't
  support body scroll (necolas/react-native-web#1120 — workaround uses private
  `_listRef._onScroll`, loops `onEndReached`). FlashList "uses ScrollView under the
  hood", external/fullscreen scroll closed "not planned" (Shopify/flash-list#873);
  v2 renders better on web but still owns its scroller. Pure-web virtualizers
  (TanStack Virtual / react-window) DO window-scroll but aren't RN components.
- **Proper approach — ONE shared scroll primitive, screens stay single-source**
  (max reuse, least web-only code; supersedes the earlier `index.web.tsx` fork):
  - [ ] `src/components/screen-scroll.{tsx,web.tsx}` (new): FlatList-shaped API
        (`data/renderItem/numColumns/ListHeaderComponent/onEndReached` + exposed
        `scrollY`). Native = pass-through to today's `Animated.FlatList`
        (virtualization unchanged). Web = document-flow grid (no RN ScrollView) +
        `window` scroll → `scrollY` + `IntersectionObserver` → `onEndReached`. Web
        file ALSO does the navigator-unlock internally (ref-walk to `#root` setting
        `flexBasis/height:auto`, restore on unmount) so only `ScreenScroll` consumers
        are unlocked — reader/placeholders untouched.
  - [ ] `src/app/+html.tsx` (web-only): drop `ScrollViewStyleReset`, let `html/body`
        scroll (`overflow-y:auto; overscroll-behavior-y:none`).
  - [ ] `src/app/(tabs)/index.tsx` (SHARED, no fork): swap inline `Animated.FlatList`
        → `<ScreenScroll>`; point the top-bar animation at its `scrollY`.
  - [ ] `src/components/app-tabs.web.tsx` (already web-only): bottom bar
        `absolute`→`fixed`; fade hook scroll source → `window` (so fade lands after
        the toolbar collapses).
  - Net new web-only code = `+html.tsx` (~5 lines) + `screen-scroll.web.tsx` + small
    `app-tabs.web.tsx` edits. Placeholder tabs need ZERO changes now; adopt
    `<ScreenScroll>` (written once) when they get real content.
- **Constraints:** native + reader untouched; horizontal rails keep inner scroll;
  reuse existing post-mount `hydrated` gate. Web list is non-virtualized — fine for
  mock data; escape hatch is TanStack Virtual behind the same primitive.
- **Verify:** Playwright @ iPhone viewport on a real export asserts document scrolls
  (`scrollHeight > innerHeight`, `window.scrollTo` moves) + paging/animations; add a
  CI assert so an Expo upgrade that re-locks the chain fails loudly. Real iOS Safari
  & Chrome pass for the actual toolbar collapse (headless can't show that). Serving:
  `bun run build:web` then `bunx serve dist -l 8099`; global Playwright at
  `/opt/node22/lib/node_modules`, Chromium at `/opt/pw-browsers/chromium`.
- **Open question before coding:** keep native + reader out of scope, or also cover
  pushed detail/series screens? (Default: tabs first, reader excluded.)
