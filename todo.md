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