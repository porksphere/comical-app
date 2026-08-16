# Page favorites — client plan

The runtime half has **landed** in the `comical` submodule
(`claude/page-favorites-runtime-00agdx`, pinned here at `ac554fd`). This document is the
`comical-app` half, written against the shipped API.

**The submodule is the source of truth.** Where this document and the code disagree, the code wins.
Deferred decisions live in `external/comical/docs/page-favorites-followups.md` — those are settled,
not open questions; don't re-derive them.

## The problem

`todo.md`'s first open item is "Add 'page' favoriting mechanism". The app can save a **series**
(library entries + custom lists) and can star a series upstream (bridge-account favorites), but
there is **no per-page user state** — reading progress is a single overwritten `lastPage` per
chapter. A reader who hits a panel worth keeping has nowhere to put it.

This adds favoriting an **individual page**, independent of the library, plus a browser in the
Library tab that can be flipped through holistically, grouped by series, or by date, with
user-created **collections**.

## Naming — the collision to avoid first

`favorites`, `useFavorite`, `queryKeys.isFavorite`, `browseGrid({ kind: 'favorites' })`,
`/favorites-import` and `e2e/*/favorites-import.yaml` are **already taken** by the remote
per-series bridge-account favorite. That concept is remote, per-series, capability- and login-gated,
and has no notion of a page.

New code says **`favoritePage` / `favoritePages`** throughout (`usePageFavorite`,
`queryKeys.favoritePages`); the UI label is **"Favorite pages"**. `src/hooks/use-favorite.ts` is
still the right *template* for the optimistic toggle — copy its shape, not its name.

## Guiding UX

1. **The affordance is in the reader chrome you already reveal by tapping**, not behind the settings
   gear. Favoriting is a reflex action taken mid-read; it should cost one tap from the overlay
   that's already up. The settings sheet gets a mirror (shared cache key, always in lockstep) for
   discoverability, but it isn't the primary.
2. **The browser is a view inside the Library tab**, reached from the title dropdown that already
   switches between "Library" and each custom list. No sixth tab, no new chrome.
3. **A favorite is a position, not a picture.** No page bytes are stored anywhere — see
   "What we don't get" below, which is a design constraint to build around rather than a gap to
   work around.

## 1. Types — import, don't redeclare

`@comical/library` exports the canonical types. Re-export them from `src/data/types.ts` type-only,
as the app already does for `LibraryEntryView` / `LibraryList` / `HistoryItem`. Do **not** write a
parallel mirror — that's how the two halves drift.

```ts
type FavoritePageCoord = { bridgeId; seriesId; chapterId; pageIndex };  // chapterId = '__direct__' when chapterless
type FavoritePageSnapshot = { seriesTitle; chapterName?; pageCount?; sourceUrl?; contentHash? };
type FavoritePage = FavoritePageCoord & {
  id; favoritedAt; collectionIds; seriesTitle; chapterName?; pageCount?;
  sourceUrl?; contentHash?; stale?;
};
type FavoriteCollection = { id; name; order };
type ChapterPageRef = { url?; contentHash? };
type FavoritePagesQuery = { sort?: 'added'|'series'|'chapter'; dir?: 'asc'|'desc';
                            collection?: string; series?: string; q?: string };
```

Also exported and worth using rather than reimplementing: `favoritePageId(coord)`,
`parseFavoritePageId(id)`, `UNCOLLECTED`.

**The id is internal.** It's derived from the coordinates, so a reconcile that relocates a page
*re-keys the record* and any id held across it 404s. No route accepts one, and no app code should
hold one — address favorites by coordinates everywhere, including collection assignment.

## 2. The store seam — six methods, sharded per series

`AsyncStorageLibraryStore` (`src/data/embedded/library-store.ts`) must implement:

```ts
listFavoritePages(scope?: { bridgeId?; seriesId?; chapterId? }): Promise<FavoritePage[]>;
getFavoritePage(id: string): Promise<FavoritePage | undefined>;
putFavoritePages(pages: FavoritePage[]): Promise<void>;
deleteFavoritePages(ids: string[]): Promise<void>;
listFavoriteCollections(): Promise<FavoriteCollection[]>;
putFavoriteCollections(collections: FavoriteCollection[]): Promise<void>;
```

Three requirements that are load-bearing, not stylistic. None of them fails a test when broken — it
just makes the reader slow in a way nobody notices until a user has thousands of favorites:

1. **Shard by series.** One key per series —
   `comical:lib:favorite-pages:{bridgeId}:{seriesId}` → `{ [id]: FavoritePage }` — mirroring
   `FileLibraryStore`'s `favorite-pages/{bridgeId:seriesId}.json`. As a single document, every write
   re-serialises the user's entire favorites set: the runtime side measured **64ms → 3.4ms per
   chapter open at 25k favorites**. `getFavoritePage(id)` finds its shard via `parseFavoritePageId`.
2. **Honour `scope`.** It's what keeps a chapter open off the whole-library path. Filter *before*
   deserialising where possible.
3. **A batch call is ONE durable write**, however many records it carries — a reconcile repairs a
   whole chapter through a single `putFavoritePages`.

Collections stay a single document: `comical:lib:favorite-collections` → `FavoriteCollection[]`.

Everything goes through the existing `serializeAsyncMethods` wrapper — concurrent read-modify-write
on a shared document silently drops records. `diskUsage()` already sums `comical:lib:*`, so the
Storage screen accounts for these for free.

## 3. Routes and DataSource methods

As shipped (typed wrappers in `src/data/api.ts`):

```
GET    /library/favorite-pages?sort=&dir=&collection=&series=&q=      → FavoritePage[]
GET    /library/favorite-pages/chapter/{b}/{s}/{c}                    → number[]
POST   /library/favorite-pages/chapter/{b}/{s}/{c}/reconcile          ← { pages: ChapterPageRef[] }
                                                                      → { indices, repaired, stale }
PUT    /library/favorite-pages/{b}/{s}/{c}/{pageIndex}                ← FavoritePageSnapshot → FavoritePage
DELETE /library/favorite-pages/{b}/{s}/{c}/{pageIndex}                → { ok: true }
PUT    /library/favorite-pages/{b}/{s}/{c}/{pageIndex}/collections    ← { collectionIds } → FavoritePage
GET    /library/favorite-pages/collections                            → FavoriteCollection[]
POST   /library/favorite-pages/collections                            ← { name } → FavoriteCollection (201)
PATCH  /library/favorite-pages/collections/{id}                       ← { name } → { ok: true }
DELETE /library/favorite-pages/collections/{id}                       → { ok: true }
POST   /library/favorite-pages/collections/reorder                    ← { orderedIds } → { ok: true }
```

`{c}` carries `__direct__` for chapterless series. Every route 404s when no library store is
mounted, so `library.tsx`'s existing "Library isn't available here" state applies unchanged.
`PUT` is idempotent: re-favoriting refreshes the display snapshot and keeps the original
`favoritedAt` and collection memberships. **It does not preserve `contentHash`** despite what the
handoff brief says — see the discrepancy note in §4.

`DataSource` (`src/data/source.ts`) gains a method per route, coordinate-addressed throughout.
**`src/data/mock.ts` must implement every one** — mock mode powers the `__DEV__` toggle, the GitHub
Pages demo build and all e2e flows.

`src/data/queries.ts`: register `favoritePages(mock, query)`, `chapterFavorites(mock, b, s, c)` and
`favoriteCollections(mock)`, plus a prefix key `favoritePagesAll(mock) = ['favoritePages', mock]` so
one toggle invalidates every scoped grid whatever its current sort/dir/collection — the trick
`libraryList(mock)` already uses. Both documents are small and should persist; bump
`PERSIST_BUSTER` when the shape lands.

## 4. The reader affordance

**Where.** A heart in the reader toolbar's trailing slot, immediately left of the settings gear —
the most discoverable spot in chrome the user has already revealed. Filled when favorited, outline
when not, via the existing `IconProps.filled` convention; the icon belongs in
`src/components/icons/reader-icons.tsx`. Reader chrome is deliberately unthemed white-on-dark —
match it (`#fff`, `rgba(255,255,255,0.6)`), don't reach for `useTheme()`.

**Toolbar change** (`src/components/reader/reader-toolbar.tsx`, untouched by 0.1.4). The trailing
slot is a fixed 32×32 `styles.back` box holding one child, and the leading spacer is the same box so
titles stay centred. Make the trailing slot a row (`flexDirection: 'row'`, `gap: Spacing.two`,
`justifyContent: 'flex-end'`) behind an exported `TRAILING_SLOT_W`, and give the leading spacer the
same width. `right` stays the prop; the caller passes a fragment.

**Chapter open → one call, one in-memory set.** Prefer `POST …/reconcile` with the page list the
reader has already fetched: it returns the indices to trust, repairs favorites the source shifted,
and flags ones it can't place. `GET …/chapter/{b}/{s}/{c}` is the cheap fallback when the list isn't
in hand. Drive the button off that set. **Never add a per-page status check** — it would fire a
request per page turn, which is the whole reason the indices route exists.

**Getting the page index to the button.** `currentPage` is `useState` *inside* `ReaderPane`
(`src/app/series/index.tsx:3235`, `currentRef` :3236), while the toolbar renders in the parent
`SeriesReaderInstance` (:535, mounted ~:2413). Add
`onVisiblePageChange?: (v: { pageIndex: number; chapterId: string }) => void` to `ReaderPane`, fired
from the settle point that already drives `record()` (~:3491, debounced 1500ms at ~:3534).

**The stitched multi-chapter case must be handled or favorites silently mis-file.**
`handleFlatPageChange` (~:3299) / `handleFlatVisiblePage` (~:3323) translate a flat index back to
`(segment, page)`, and `visibleSeg` (~:3295) holds `{ id, page, total }` for the page crossing the
screen. The bottom chrome already resolves this in the `shown` memo (~:3334): prefer `visibleSeg`
when `stitched && segments.some(s => s.id === visibleSeg.id)`, else `currentPage`. The favorite
button needs the **chapter id alongside the index**, so add a sibling memo returning
`{ pageIndex, chapterId }` off the same branch. Reading `target.chapterId` unconditionally is the
trap: invisible until a favorite made near a chapter boundary reopens on the wrong page.

**The hook.** `src/hooks/use-page-favorite.ts`, modelled on `use-favorite.ts`: derive
`favorited = indices.includes(pageIndex)`, mutate with an optimistic patch of that array, roll back
on error, `onSettled` invalidate `favoritePagesAll(mock)`. `hapticSelection()` on toggle, and
`holdChrome()` (:971) on press so the chrome doesn't auto-hide out from under the tap.

**Mirror in the settings sheet** as a separate **"This page"** segment above `SeriesActionsRow`
(`src/components/reader/settings-panel.tsx:194`) rather than crowding that 2×2 "This series" grid.

testIDs: `reader.toolbar.favorite-page`, `reader.settings.favorite-page`.

### `contentHash` — where the bytes actually come from

Sending `contentHash` (lowercase hex SHA-256) on favorite is the highest-value thing the client
does: it's the one re-anchor key that survives URL rot and re-uploads. The rule from the runtime
side is absolute — **never fetch a page just to hash it**; sparse hashes are expected and safe.

JS never holds the bytes on native — `reader-page.tsx` hands a resolved URI to `expo-image`, which
fetches and decodes natively. But it doesn't need to: **`expo-image` has already written the page to
its own disk cache**, and SDK 56 exposes it.

```ts
Image.getCachePathAsync(cacheKey: string): Promise<string | null>
```

> "Asynchronously checks if an image exists in the disk cache and resolves to the path of the cached
> image if it does."

The reader renders with `cachePolicy="memory-disk"` (`reader-page.tsx:426`) and sets no explicit
`cacheKey`, so **the key is the URI string handed to `<Image>`** — the `source` from
`useImageProgress`, not the raw bridge path and not `resolvedUri` (on web those diverge; see the
note at `reader-page.tsx:318`). So the native path is: `getCachePathAsync(source)` → read the file
with `expo-file-system` → hash. **No network request, and no download required.** Sources, in order
of preference:

- **Any page the reader has displayed** — `getCachePathAsync`, as above. This is the common case and
  it covers exactly the pages a user favorites, since they're looking at one when they tap.
- **Downloaded pages** — already on disk in the downloads blob store; cheapest when present.
- **Web** — `image-progress.web.ts` fetches the bytes itself to compute progress, so the hash is
  free there. Thread it out of that path rather than re-fetching.
- **A cache miss** — `getCachePathAsync` resolves `null` (the disk cache is evictable). Omit the
  hash. Do **not** `fetch()` the URL to obtain it; sparse is expected and safe, and reconcile adopts
  a hash later anyway.

**Hash off the tap's critical path.** The shim's `digest` is a JS implementation, so SHA-256 over a
~1MB page is not free on Hermes. Toggle optimistically, `PUT` immediately, and send the hash in a
second idempotent `PUT` once it resolves — never make the user wait on it.

⚠️ **Runtime discrepancy to confirm before relying on that two-step.** The handoff brief says `PUT`
"keeps … its `contentHash`", but `Library.favoritePage` (`packages/library/src/library.ts:778-793`)
carries `favoritedAt` and `collectionIds` over from the existing record and then rebuilds
`contentHash` and `sourceUrl` **from the snapshot only** — so a re-favorite whose snapshot omits the
hash **erases a stored one**. (Its doc comment also still refers to keeping "any captured
thumbnail", which no longer exists — evidence the comment predates the byte-capture removal.) The
deferred second `PUT` works fine, since it *adds* the hash. The hazard is the reverse: any later
`PUT` without one silently drops the strongest re-anchor key. Until this is settled upstream,
**always send the hash if we hold one**, and don't re-`PUT` a favorite just to refresh its snapshot.

**Hashing needs no new dependency.** `crypto.subtle.digest('SHA-256', bytes)` is native on web and
provided on Hermes by `installWebCryptoShim()` from `@comical/host-rn`, already installed in
`src/data/embedded/startup.ts:119` for bridge-bundle verification. **Verify it's installed in
native-*remote* mode too** — if that path skips startup wiring, hashing is unavailable there and the
correct response is to omit the hash, not to add a polyfill.

Coverage is therefore a function of reading and downloading behaviour, by design: favorites adopt
hashes they're handed on every reconcile, so anchoring strengthens as the user reads.

## 5. What we don't get — design around it, don't fix it

**There is no thumbnail endpoint and no stored bytes.** An earlier draft of this plan specified a
capture subsystem; it was removed during runtime review because storing a page verbatim (~200KB–1.5MB
each) was untenable. Consequences, all accepted upstream:

- **The grid needs the network.** Tiles resolve page URLs to draw — **batch per chapter, never per
  tile.**
- **A favorite whose bridge is uninstalled or whose source is dead has no image, permanently.** The
  `seriesTitle` / `chapterName` snapshot still renders, so show a **text tile**, not a blank.

If this bites, the recorded answer is a bounded LRU of downscaled tiles — not reinstating capture.
Note there's still no `expo-image-manipulator` dependency, so downscaling isn't free.

**Stale favorites.** A favorite reconcile can't place is marked `stale: true` and **never deleted**.
It drops out of the reported indices, so the reader must not highlight it or offer to jump to it.
In the grid it needs a **"may no longer be available"** affordance — visible and explained, not
hidden and not deleted. It un-stales itself if a later reconcile finds the page.

## 6. The Library-tab browser

Introduce one discriminated view rather than bolting a mode onto `library.tsx`'s three `useState`s:

```ts
type LibraryView =
  | { kind: 'series'; list: LibraryListFilter }
  | { kind: 'pages'; collection: string | null | 'uncollected' };
```

- **Entry point.** Extend `LibraryListSelector` (`src/components/library-list-selector.tsx`) — the
  tab's title-as-dropdown — with a second `OptionList` section headed "Favorite pages": an "All
  favorite pages" row, one row per collection, and "Manage collections…" beside the existing
  "Manage lists…". Its `value`/`onChange` widen to `LibraryView`. That's the whole discovery story,
  at no new chrome.
- **Body.** `kind === 'pages'` renders `src/components/favorites/favorite-pages-grid.tsx` instead of
  `SeriesGrid`. Top bar, in-place search, the scroll-driven tab-bar slide (`sharedValues`/`onScroll`)
  and `useScrollToTopOnReselect` are untouched.
- **Sort is `sort` + `dir`, separately** — matching `/library`, and there is no `oldest` key. Newest
  first is `sort=added&dir=desc`. Offer Added / Series / Chapter order with a direction toggle, plus
  **Group by: None · Series · Date**. Persist per view following `use-library-sort.ts`'s pattern
  under a new `comical:favoritePagesSort` key.
- **`scopeKey`** must include view, sort, dir, grouping and collection so the list remounts and
  recycled tiles reset on a switch.

**Sectioned rows.** Nothing in the repo does grouped lists; don't add a list library. Precompute a
flat row array and feed the existing `RecyclerList` (`src/components/recycler-list.tsx`):

```ts
type FavRow =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'row'; key: string; items: FavoritePage[] };   // numColumns tiles

buildFavoriteRows(items, numColumns, grouping): FavRow[]
```

Fixed 2:3 slots give both row types a computable fixed height, keeping LegendList from re-measuring
mid-scroll — the `cellHeight`/`estimatedItemSize` discipline `series-grid.tsx` uses.

**Tiles reuse `PageThumb`** (`src/components/series/chapters-section.tsx:1377`) for its sprite
handling, recycle-safety and `lightCards` lever. It needs an explicit-source prop, since favorite
tiles resolve their URL from a per-chapter batch rather than `PageThumb`'s own lazy per-page fetch —
that path is series-level (`getPageThumb` takes no `chapterId`) and would be wrong here. Geometry
from `use-grid-layout.ts`; `PageGridSkeleton` for loading; `relTime()` for date headers.

The full grid reads every shard (~5.5ms at 25k favorites) — inherent, since the grid renders
everything, and fine at realistic sizes. The recorded fix if it matters is cursor paging on the list
route; don't invent something else.

## 7. Collections

Shaped deliberately like `LibraryList`, so the management UI ports from `src/app/manage-lists.tsx` →
`manage-favorite-collections.tsx` and the picker from `src/components/list-picker.tsx` →
`favorite-collection-picker.tsx`. Hooks port from `use-library-lists.ts` and `use-entry-lists.ts`.

Assignment is `PUT …/{b}/{s}/{c}/{pageIndex}/collections` — **coordinates, not the favorite id**.
Send the **whole list** to `reorder` as `orderedIds`; a partial reorder can leave tied `order`
values (known, and matching `reorderLists`). Deleting a collection strips it from members and
**never deletes the favorites** — they become uncollected.

Picker entry points: long-press the reader's favorite button, long-press a grid tile, and an action
in the viewer.

## 8. Opening a favorite

- **Tap a tile → a full-screen favorites viewer** (`src/app/favorite-page-viewer.tsx`, a
  `containedTransparentModal` like `series`): a pager over *the currently filtered, currently sorted
  list*, so a swipe carries you from one series' page into the next favorite regardless of series.
  Reuse `zoomable-page.tsx` and the `ReaderPageItem = { uri, key, pageNumber }` shape
  `paged-reader.tsx` takes. Chrome carries unfavorite, add-to-collection and **"Open in reader"**.
  A stale favorite shows its snapshot and the unavailable affordance instead of an image.
- **"Open in reader"** pushes the existing series modal at that page — no new reader machinery:
  `router.push({ pathname: '/series', params: { id: seriesId, bridgeId, reader: '1', chapterId,
  start: String(pageIndex), title, cover } })`.

## 9. Phasing

**Phase 1 — plumbing + the reader toggle.** `types.ts` (type-only re-exports), `library-store.ts`
(six methods, sharded), `api.ts`, `source.ts`, `mock.ts`, `queries.ts`, `query-client.ts`,
`use-page-favorite.ts`, `reader-icons.tsx`, `reader-toolbar.tsx`, `series/index.tsx` (page-index
plumbing incl. the stitched case + reconcile on chapter open), `settings-panel.tsx`. Ships:
favoriting works and persists.

**Phase 2 — the browser.** `library-list-selector.tsx`, `library.tsx`,
`components/favorites/favorite-pages-grid.tsx`, `PageThumb`'s explicit-source prop, the
per-chapter URL batch, the stale and text-tile states. Flat, newest-first, tap opens the reader.

**Phase 3 — the axes.** sort/dir options and `buildFavoriteRows` grouping by series and date.

**Phase 4 — collections.** `manage-favorite-collections.tsx`, `favorite-collection-picker.tsx`,
hooks, and the collection rows in the selector.

**Phase 5 — the viewer.** `favorite-page-viewer.tsx` swipe-through plus its actions.

**`contentHash`** rides along in Phase 1 via `Image.getCachePathAsync` (plus the downloads blob
store and web's progress path). It is additive and computed off the tap's critical path, and
favorites adopt hashes on later reconciles, so it never blocks a phase.

## 10. Verification

From `apps/mobile/`:

```
bun run typecheck        # tsc --noEmit
bun run lint
bun run lint:testids     # eslint-rules/require-test-id.js is enforced
bun test
bun run check:flow-coverage
```

New Maestro flows in **both** `e2e/mobile/page-favorites.yaml` and `e2e/web/page-favorites.yaml`
(check `e2e/README.md` for the web-only selector/gesture quirks first). The flow: open a series →
read → tap to reveal chrome → favorite → back out → Library → switch the selector to Favorite pages
→ assert the tile → tap it → assert the page opens. Re-tap to reveal chrome between steps; it
auto-hides after 3s (`CHROME_HIDE_MS`).

Re-check `e2e/mobile/reader-navigation.yaml` and `library.yaml` for selectors the toolbar and
selector changes break — `check:flow-coverage` cannot detect a stale *existing* flow.

Manual: `bun run dev` alongside a `@comical/host-server` on :3100, and exercise mock mode. Three
things worth deliberately provoking, because each hides a bug this design can produce:

1. A favorite made **mid-chapter-crossing in stitched paged mode** must reopen on the correct page.
2. A **reconcile that relocates** a favorite must leave the grid and reader agreeing — and nothing
   may hold a pre-reconcile favorite id.
3. A **stale** favorite must render with its affordance, stay out of the reader's indices, and
   survive (not be deleted) across app restarts.

Finally, tick `todo.md`'s "Add 'page' favoriting mechanism" line.
