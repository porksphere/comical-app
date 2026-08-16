# Page favorites — proposal

## The problem

`todo.md`'s first open item is "Add 'page' favoriting mechanism". Today the app can save a
**series** (library entries + custom lists) and can star a series on the upstream source
(bridge-account favorites), but there is **no per-page user state of any kind** — reading progress
is a single overwritten `lastPage` per chapter and that's the lot. A reader who hits a panel worth
keeping has nowhere to put it.

This adds favoriting an **individual page**, independent of the library, plus a browser in the
Library tab that can be flipped through holistically, grouped by series, or by date, with
user-created **collections** so favorites can be filed.

## Naming — the collision to avoid first

`favorites`, `useFavorite`, `queryKeys.isFavorite`, `browseGrid({ kind: 'favorites' })`,
`/favorites-import` and `e2e/*/favorites-import.yaml` are **already taken** by the remote
per-series bridge-account favorite (starring a series on the source site). That concept is remote,
per-series, capability- and login-gated, and has no notion of a page.

New code says **`favoritePage` / `favoritePages`** throughout (`usePageFavorite`,
`queryKeys.favoritePages`, `/library/favorite-pages`); the UI label is **"Favorite pages"**.
`src/hooks/use-favorite.ts` is still the right *template* for the optimistic toggle — copy its
shape, not its name.

## Guiding UX

Three decisions drive the rest:

1. **The affordance is in the reader chrome you already reveal by tapping**, not behind the
   settings gear. Favoriting a page is a reflex action taken mid-read; it should cost one tap from
   the overlay that's already up, not three through a pull-up sheet. The sheet still gets a mirror
   of the action (shared cache key, always in lockstep) for discoverability, but it isn't the
   primary.
2. **The browser is a view inside the Library tab**, reached from the title dropdown that already
   switches between "Library" and each custom list. No sixth tab, no new chrome — the tab's
   existing selector grows a second section.
3. **Store coordinates, not pictures.** A favorite is `(bridgeId, seriesId, chapterId, pageIndex)`
   plus a snapshot for offline display and a captured thumbnail. Page URLs from a bridge are
   scraped and frequently signed — storing one as the render path guarantees rot.

## 1. Data model

Two documents, shaped after `LibraryEntry` / `LibraryList` so every existing pattern transfers.

```ts
// src/data/types.ts — the UI mirror of @comical/library's canonical type

export type FavoritePage = {
  /** `${bridgeId}:${seriesId}:${chapterId}:${pageIndex}`, URL-encoded. Derived, not random —
   *  favoriting is idempotent and "is this page favorited" is a lookup, never a scan. */
  id: string;
  bridgeId: string;
  seriesId: string;
  chapterId: string;       // DIRECT_CHAPTER_ID ('__direct__') when the series is chapterless
  pageIndex: number;       // 0-based; indexes getChapterPages() / getDirectPages()
  favoritedAt: number;     // epoch ms — the date axis
  collectionIds: string[]; // [] = uncollected
  // Snapshot so a tile still renders with the bridge uninstalled or the source down — the same
  // reason LibrarySnapshot / HistoryEntry carry one.
  seriesTitle: string;
  chapterName?: string;
  pageCount?: number;
  /** The source URL at capture time. Debug/fallback only — never the primary render path. */
  sourceUrl?: string;
  /** A thumbnail blob was captured → served at /library/favorite-pages/{id}/thumb. */
  hasThumb?: boolean;
};

export type FavoriteCollection = { id: string; name: string; order: number };
```

**Store keys** in `src/data/embedded/library-store.ts` (`AsyncStorageLibraryStore` — one
AsyncStorage doc per key, every method wrapped by the existing `serializeAsyncMethods`, since
concurrent read-modify-write on a shared doc silently drops records):

```
comical:lib:favorite-pages        → { [id]: FavoritePage }
comical:lib:favorite-collections  → FavoriteCollection[]
```

`diskUsage()` already sums `comical:lib:*`, so the Storage screen picks these up for free.

### Thumbnails — the one genuine gap

`getPageThumb(bridgeId, seriesId, pageIndex)` (`src/data/api.ts:679`) is **series-level and takes
no `chapterId`**, so for a chaptered series there is no existing way to fetch a thumbnail of page N
of chapter C. Its query key is also in `NO_PERSIST_KEYS` (`src/data/query-client.ts`), so it never
survives a restart. A favorites grid built naively on it would be blank for most of the library.

The fix is the pattern the app already uses for guaranteed-offline library covers — capture the
bytes once and serve them back through the router:

- New `src/data/embedded/favorite-thumbs-store.ts`, a near-copy of
  `src/data/embedded/covers-store.ts` (`expo-file-system` `Directory`/`File`/`Paths`, a `BlobStore`
  **with** `read`), rooted at `comical-favorites` rather than `comical-covers`.
- Wired in `src/data/embedded/startup.ts` beside the existing
  `covers: { blobs: expoCoversBlobStore, fetchPage: devicePageFetcher }` as
  `favoritePages: { blobs: expoFavoriteThumbsBlobStore, fetchPage: devicePageFetcher }`.
- The capture itself lives server-side in `@comical/library`, exactly as cover capture does.
- Render order per tile: **captured blob → bridge `getPageThumb` (direct series only) →
  re-resolved page URL via `getChapterPages` → skeleton.** No tile ever hard-fails.
- There is **no `expo-image-manipulator` dependency**, so v1 captures the page bytes as-is (what
  cover capture does today). Downscaling is a follow-up if favorites get heavy — worth stating
  plainly rather than shipping full-size blobs quietly.

## 2. REST surface and DataSource methods

Routes (submodule `host-server` router; typed wrappers in `src/data/api.ts`):

```
GET    /library/favorite-pages?sort=&collection=&series=&q=      → FavoritePage[]
GET    /library/favorite-pages/chapter/{b}/{s}/{chapterId}       → number[]  (favorited indices)
PUT    /library/favorite-pages/{b}/{s}/{chapterId}/{pageIndex}   ← snapshot body
DELETE /library/favorite-pages/{b}/{s}/{chapterId}/{pageIndex}
PUT    /library/favorite-pages/{id}/collections                  ← { collectionIds }
GET    /library/favorite-pages/{id}/thumb                        → captured bytes
GET|POST      /library/favorite-pages/collections
PATCH|DELETE  /library/favorite-pages/collections/{id}
POST          /library/favorite-pages/collections/reorder
```

**The chapter route is the load-bearing one.** The reader asks once per chapter for the set of
favorited page indices, so flipping pages costs zero requests and the button is correct instantly
while scrubbing. A per-page status check — the shape `isFavorite` uses — would fire a request per
page turn and lag the button behind the swipe.

`sort` = `added` (newest first, default) | `oldest` | `series` | `chapter`. `collection` accepts a
collection id or `uncollected`, mirroring `LibraryListFilter`'s `'unlisted'`. Filtering and sorting
stay **server-side**, matching `/library?q=&sort=&list=`.

`DataSource` (`src/data/source.ts`) gains:

```ts
getFavoritePages(scope: FavoritePagesScope, signal?): Promise<FavoritePage[] | null>;
getChapterFavorites(bridgeId, seriesId, chapterId, signal?): Promise<number[]>;
addFavoritePage(coord: FavoritePageCoord, snapshot: FavoritePageSnapshot): Promise<void>;
removeFavoritePage(coord: FavoritePageCoord): Promise<void>;
setFavoritePageCollections(id: string, collectionIds: string[]): Promise<void>;
getFavoriteCollections(signal?): Promise<FavoriteCollection[]>;
createFavoriteCollection(name: string): Promise<FavoriteCollection>;
renameFavoriteCollection(id: string, name: string): Promise<void>;
deleteFavoriteCollection(id: string): Promise<void>;
reorderFavoriteCollections(ids: string[]): Promise<void>;
```

`null` from the list call means "no library store mounted" — the convention `library.tsx:107-114`
already renders a "Library isn't available here" state for.

**`src/data/mock.ts` must implement every one of these.** Mock mode powers the `__DEV__` Settings
toggle, the GitHub Pages demo build, and all e2e flows; it is not optional.

`src/data/queries.ts`: register `favoritePages(mock, scope)`, `chapterFavorites(mock, b, s, c)` and
`favoriteCollections(mock)` in the `queryKeys` factory, plus a **prefix key**
`favoritePagesAll(mock) = ['favoritePages', mock]` so one toggle invalidates every scoped grid
whatever its current sort/group/collection — the trick `libraryList(mock)` already uses. Both
documents are small and **should persist**; bump `PERSIST_BUSTER` when the shape lands.

## 3. The reader affordance

**Where.** A heart icon in the reader toolbar's trailing slot, immediately left of the settings
gear — the most discoverable spot in chrome the user has already revealed. Filled when favorited,
outline when not, via the existing `IconProps.filled` convention
(`src/components/icons/ui-icons.tsx`); the icon itself belongs in
`src/components/icons/reader-icons.tsx`. Reader chrome is deliberately unthemed white-on-dark —
match it (`#fff`, `rgba(255,255,255,0.6)`), don't reach for `useTheme()`.

**Toolbar change** (`src/components/reader/reader-toolbar.tsx`). The trailing slot is a fixed 32×32
`styles.back` box holding one child, and the leading spacer is the same box so the titles stay
centred. Make the trailing slot a row (`flexDirection: 'row'`, `gap: Spacing.two`,
`justifyContent: 'flex-end'`) behind an exported `TRAILING_SLOT_W`, and give the leading spacer the
same width so centring survives two buttons. `right` stays the prop; the caller passes a fragment.

**Getting the page index to the button — the real plumbing.** `currentPage` is `useState` *inside*
`ReaderPane` (`src/app/series/index.tsx:3235`, `currentRef` :3236), while the toolbar is rendered
by the parent `SeriesReaderInstance` (:535, toolbar mounted ~:2413), which holds `pages`, `bridgeId`, `id` and
`target.chapterId` but no page state. Add an
`onVisiblePageChange?: (v: { pageIndex: number; chapterId: string }) => void` prop to `ReaderPane`,
fired from the same settle point that already drives `record()` (~:3491, debounced 1500ms at ~:3534). The parent keeps it in
state and feeds the button.

**The stitched multi-chapter case must be handled or favorites silently mis-file.** In native paged
mode `handleFlatPageChange` (~:3299) / `handleFlatVisiblePage` (~:3323) translate a flat index back
to `(segment, page)`, and `visibleSeg` (~:3295) holds `{ id, page, total }` for the page crossing
the screen. The bottom chrome already resolves this correctly in the `shown` memo (~:3334): prefer
`visibleSeg` when `stitched && segments.some(s => s.id === visibleSeg.id)`, else `currentPage`. The
favorite button needs the **chapter id alongside the index**, so add a sibling memo returning
`{ pageIndex, chapterId }` off the same branch — `visibleSeg.id` when stitched, else
`chapterId ?? DIRECT_CHAPTER_ID`. Reading `target.chapterId` unconditionally is the trap: it stays
invisible until a favorite made near a chapter boundary reopens on the wrong page.

**The hook.** `src/hooks/use-page-favorite.ts`, modelled on `use-favorite.ts`: read the chapter's
favorited-index array through `chapterFavorites`, derive `favorited = indices.includes(pageIndex)`,
mutate with an optimistic array patch, roll back on error, and `onSettled` invalidate
`favoritePagesAll(mock)`. `hapticSelection()` (`src/lib/haptics.ts`) on toggle, and `holdChrome()`
(:971) on press so the chrome doesn't auto-hide out from under the tap.

**Long-press the button** opens the collection picker (Phase 4), mirroring `openListPicker`.

**Mirror in the settings sheet.** `SeriesActionsRow` (`src/components/reader/settings-panel.tsx:194` (unchanged by 0.1.4))
is a 2×2 grid under a "This series" label. Add a separate **"This page"** segment above it rather
than crowding that grid — the two concepts shouldn't share a box.

testIDs: `reader.toolbar.favorite-page`, `reader.settings.favorite-page`.

## 4. The Library-tab browser

`src/app/(tabs)/library.tsx` folds `listFilter` + `sort` + `query` into one `libraryQuery` and one
`SeriesGrid`. Rather than bolt a second mode onto those `useState`s, introduce one discriminated
view:

```ts
type LibraryView =
  | { kind: 'series'; list: LibraryListFilter }
  | { kind: 'pages'; collection: string | null | 'uncollected' };
```

- **Entry point.** Extend `LibraryListSelector` (`src/components/library-list-selector.tsx`) — the
  tab's title-as-dropdown — with a second `OptionList` section headed "Favorite pages": an "All
  favorite pages" row, one row per collection, and a "Manage collections…" action beside the
  existing "Manage lists…". Its `value`/`onChange` widen from `LibraryListFilter` to `LibraryView`.
  That is the entire discovery story, and it costs no new chrome.
- **Body.** `view.kind === 'pages'` renders a new
  `src/components/favorites/favorite-pages-grid.tsx` in place of `SeriesGrid`. Everything else on
  the screen — top bar, in-place search, the scroll-driven tab-bar slide via
  `sharedValues`/`onScroll`, `useScrollToTopOnReselect` — is untouched.
- **Sort/group control.** `LibrarySortButton`'s options swap with the view: pages mode offers
  **Newest / Oldest / Series / Chapter order**, plus a **Group by: None · Series · Date** toggle.
  Persist per view following `use-library-sort.ts`'s per-list pattern, under a new
  `comical:favoritePagesSort` key.
- **`scopeKey`** must include view, grouping and collection so the list remounts and recycled tiles
  reset on a switch — today's `${query}|${sort}|${listFilter}` generalises.

**Sectioned rows.** Nothing in the repo does grouped lists today; don't add a list library for it.
Precompute a flat row array and feed the existing `RecyclerList`
(`src/components/recycler-list.tsx`), the LegendList wrapper both grid skins already share:

```ts
type FavRow =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'row'; key: string; items: FavoritePage[] };   // numColumns tiles

buildFavoriteRows(items, numColumns, grouping): FavRow[]
```

Because `PageThumb` slots are a fixed 2:3 box, both row types have a computable fixed height, which
keeps LegendList from re-measuring mid-scroll — the same `cellHeight`/`estimatedItemSize`
discipline `series-grid.tsx` uses, and what `todo.md` separately asks for on page thumbs. Sticky
headers only if `RecyclerList` already exposes them; plain inline headers are an honest v1.

**Tiles reuse `PageThumb`** (exported, `src/components/series/chapters-section.tsx:1377`). It
already lazily self-fetches a missing thumbnail from coordinates, and handles sprite crops,
recycle-safety and the `lightCards` perf lever. It needs one new prop — an explicit thumb source —
so a favorite tile prefers the captured blob over a bridge scrape. Geometry comes from
`use-grid-layout.ts` (`numColumns`, `sidePad`, `cardWidth`, `GRID_COLUMN_GAP`); `PageGridSkeleton`
covers loading. Date headers use `relTime()` (`src/lib/rel-time.ts`), as `history.tsx` does.

## 5. Collections

`FavoriteCollection` is deliberately shaped exactly like `LibraryList`, so the management UI is a
straight port of `src/app/manage-lists.tsx` → `manage-favorite-collections.tsx` (create / rename /
reorder / delete), and the assign flow ports `src/components/list-picker.tsx` →
`favorite-collection-picker.tsx`. Hooks port from `use-library-lists.ts` (CRUD with optimistic
reorder) and `use-entry-lists.ts` (optimistic membership set).

Picker entry points: long-press the reader's favorite button, long-press a tile in the grid, and an
action in the full-screen viewer. Deleting a collection strips its id from every member's
`collectionIds`; it never deletes the favorites themselves.

## 6. Opening a favorite

Two levels, and the second is what "flip through favorites" actually means:

- **Tap a tile → a full-screen favorites viewer** (`src/app/favorite-page-viewer.tsx`, a
  `containedTransparentModal` like `series`): a pager over *the currently filtered, currently
  sorted favorites list*, so a swipe carries you from one series' page straight into the next
  favorite regardless of series. Reuse `zoomable-page.tsx` and the
  `ReaderPageItem = { uri, key, pageNumber }` shape `paged-reader.tsx` already takes; URIs resolve
  blob-first, then re-resolved page URLs. Chrome carries unfavorite, add-to-collection, and
  **"Open in reader"**.
- **"Open in reader"** pushes the existing series modal at that exact page — no new reader
  machinery, just params `SeriesReaderParams` already accepts:
  `router.push({ pathname: '/series', params: { id: seriesId, bridgeId, reader: '1', chapterId,
  start: String(pageIndex), title, cover } })`.

## 7. Phasing

**Phase 0 — the handoff spec.** `docs/page-favorites-server-spec.md` (written alongside this doc):
the canonical types, `LibraryStore` additions, routes, `FileLibraryStore` notes and the
thumb-capture subsystem, for the companion change in `porksphere/comical`. The submodule is pinned
at `dcad7d50`, remote-reachable, but **not checked out in this workspace**, and that repo is
outside the current session's GitHub scope. Everything below assumes it lands; until it does the
app half typechecks and the routes 404.

**Phase 1 — plumbing + the reader toggle.** `types.ts`, `library-store.ts`,
`favorite-thumbs-store.ts`, `startup.ts`, `api.ts`, `source.ts`, `mock.ts`, `queries.ts`,
`query-client.ts`, `use-page-favorite.ts`, `reader-icons.tsx`, `reader-toolbar.tsx`,
`series/index.tsx` (page-index plumbing incl. the stitched case), `settings-panel.tsx`.
Ships: favoriting works and persists; nothing browses it yet.

**Phase 2 — the browser.** `library-list-selector.tsx`, `library.tsx`,
`components/favorites/favorite-pages-grid.tsx`, `PageThumb`'s new thumb-source prop. Flat,
newest-first, tap opens the reader at that page. Closes the loop end to end.

**Phase 3 — the axes.** Sort options and `buildFavoriteRows` grouping by series and by date.

**Phase 4 — collections.** Store and routes are already in from Phases 0–1; adds
`manage-favorite-collections.tsx`, `favorite-collection-picker.tsx`, the hooks, and the collection
rows in the selector.

**Phase 5 — the viewer.** `favorite-page-viewer.tsx` swipe-through plus its unfavorite and
add-to-collection actions.

## 8. Verification

From `apps/mobile/`:

```
bun run typecheck        # tsc --noEmit
bun run lint
bun run lint:testids     # eslint-rules/require-test-id.js is enforced
bun test
bun run check:flow-coverage
```

New Maestro flows in **both** `e2e/mobile/page-favorites.yaml` and `e2e/web/page-favorites.yaml`
(two copies is the documented convention — check `e2e/README.md` for the web-only selector/gesture
quirks before assuming the mobile flow ports as-is). The flow: open a series → read → tap to reveal
chrome → favorite → back out → Library → switch the selector to Favorite pages → assert the tile →
tap it → assert the page opens. Re-tap to reveal chrome between steps; it auto-hides after 3s
(`CHROME_HIDE_MS`), as `e2e/mobile/reader-navigation.yaml` already documents.

Re-check `e2e/mobile/reader-navigation.yaml` and `library.yaml` for selectors the toolbar and
selector changes break — `check:flow-coverage` cannot detect a stale *existing* flow.

Manual: `bun run dev` alongside a `@comical/host-server` on :3100 (see `docs/DEVELOPMENT.md`), and
exercise mock mode (Settings → Use mock data), since the demo build and e2e both run against it.
Verify specifically that a favorite made mid-chapter-crossing in stitched paged mode reopens on the
correct page — that's the one bug this design can hide.

Finally, tick `todo.md`'s "Add 'page' favoriting mechanism" line.
