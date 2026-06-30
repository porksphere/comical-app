- [ ] Overlay system has slowed down after adding more filter UI
- [ ] Add "page" favoriting mechanism
- [ ] More hover highlights on desktop web, feels bery unresponsive right now
- [ ] Thumbnail top bar very cramped on mobile
- [ ] Desktop web version of overlay system, looks a bit odd on desktop to deal with a swipedown
- [ ] When refreshing page on narrow web viewports, the filters briefly display all small and cramped then correctly collapse into overflow

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
- **Recommended approach (Option C in the doc), roll out Browse-first:**
  - [ ] `+html.tsx`: drop `ScrollViewStyleReset`, let `html/body` scroll on web
  - [ ] Route-scoped effect that unlocks the navigator flex chain (fragile core —
        guard it + add a Playwright/CI assert so an Expo upgrade fails loudly)
  - [ ] New `src/app/(tabs)/index.web.tsx`: Browse grid in document flow (no outer
        ScrollView), infinite scroll via `IntersectionObserver`, top-bar
        expand/divider animation driven off `window` scroll. Keep native
        `index.tsx` as-is.
  - [ ] Top bar (index) + bottom bar (`components/app-tabs.web.tsx`) →
        `position: fixed`; switch the bottom-bar fade hook's scroll source to
        `window` (it currently reads inner FlatList scroll via capture listener)
  - [ ] Verify other tab screens (library/history/activity/settings placeholders)
        still center inside the unlocked chain; reader stays EXCLUDED (own
        scroll+pinch-zoom)
- **Constraints:** native + reader untouched; horizontal rails must keep inner
  scroll; reuse existing post-mount `hydrated` gate to avoid hydration mismatch.
- **Verify:** Playwright @ iPhone viewport on a real export asserts document scrolls
  + paging/animations; real iOS Safari & Chrome pass for the actual toolbar collapse
  (headless can't show that). Test serving: `bun run build:web` then
  `bunx serve dist -l 8099`; global Playwright at `/opt/node22/lib/node_modules`,
  Chromium at `/opt/pw-browsers/chromium`.
- **Open questions for the user before coding:** (1) keep native + reader out of
  scope, or also cover pushed detail/series screens? (2) OK to maintain a second
  Browse impl (`index.web.tsx`)? If not, "leave inner scroll" stays the high-ROI
  option since the fade already works.