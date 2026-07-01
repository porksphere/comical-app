- [ ] Overlay system has slowed down after adding more filter UI
- [ ] Add "page" favoriting mechanism
- [ ] More hover highlights on desktop web, feels bery unresponsive right now
- [ ] Thumbnail top bar very cramped on mobile
- [ ] Desktop web version of overlay system, looks a bit odd on desktop to deal with a swipedown
- [ ] When refreshing page on narrow web viewports, the filters briefly display all small and cramped then correctly collapse into overflow
- [ ] Flashlist investigation
- [ ] Line highlight on search field does not appear on mobile after closing keybkard and immediately reselecting

## Reader (page viewer)
- [ ] Image retry-with-backoff on page load failure (currently just shows a placeholder)
- [ ] Prefetch N pages ahead for smoother paging
- [ ] "Next chapter" sentinel / auto-advance at the end of a chaptered read
- [ ] Persist read progress ("continue reading") across sessions
- [ ] Overlay does not stay open when in settings / typing page 
- [ ] Page pill wiuld look better on the bottom of the page like the old version

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
  - [ ] `bunx @sentry/wizard@latest -i reactNative` (or manual: add
        `@sentry/react-native` to `apps/mobile/package.json`, add the
        `@sentry/react-native/expo` config plugin to `app.json`'s `plugins`).
  - [ ] This repo does **not** use EAS Build (`build-ios-reusable.yml` /
        `build-android-reusable.yml` run raw `expo prebuild` + `xcodebuild archive`
        / `gradlew assembleRelease` directly in GitHub Actions) — Sentry's usual
        "automatic sourcemap upload via EAS hooks" doesn't apply here. Add an
        explicit `sentry-cli` (or `@sentry/react-native`'s Metro export) step to
        both reusable workflows, after the JS bundle is produced, before/alongside
        packaging — needs a `SENTRY_AUTH_TOKEN` repo secret.
  - [ ] Wire `Sentry.init({ dsn: ... })` at the top of `src/app/_layout.tsx` (or a
        dedicated `instrument.ts` required first, per Sentry's RN docs).
  - [ ] Keep the existing root `<ErrorBoundary>` (`src/components/error-boundary.tsx`,
        wraps everything in `_layout.tsx`) — Sentry doesn't replace it. The boundary
        still gives a friendlier in-app recovery screen for render-phase errors;
        Sentry is for *capturing* the error (with stack/breadcrumbs) regardless of
        where it's thrown, including the event-handler/effect/native-crash cases
        the boundary structurally can't catch.
  - [ ] Verify end-to-end: a deliberate `throw` in a button handler should show up
        in the Sentry dashboard, symbolicated, within the unsigned/sideloaded build
        — this is the part most likely to silently not work (sourcemap upload
        path) and worth confirming before relying on it.

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