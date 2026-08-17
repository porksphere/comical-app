# Universal collections — client plan

The runtime half has landed in the `comical` submodule
(`claude/page-favorites-runtime-00agdx`, pinned here at the branch head `56da8f1`). This document is
the `comical-app` half.

**The submodule is the source of truth.** Travelling with the pin:
`external/comical/docs/collections-handoff.md` (the migration brief — transient, deleted when that
branch merges), `collections-plan.md` (design rationale), `page-favorites-followups.md` (deferred
decisions — settled, don't re-derive).

Supersedes `docs/page-favorites-plan.md`, deleted alongside this.

## The model, in one paragraph

A **collection** is a named group. A **collection item** is a pointer at a series, a chapter, or a
page, and it **exists only as a member of collections** — emptying its memberships removes it, and
deleting a collection removes every item it was the last membership of, pages included. There is no
local "favorites" concept and nothing is durably uncollected. The word *favorites* now means only
the bridge-account capability (`/bridges/{id}/favorites` — starring a series on the source site),
which is untouched by any of this. Local vocabulary is **collect / collected / collection item**.

The reader's save button is therefore **app policy, not a data concept** — and it follows the
**Google Maps "Save" model**: a tap files the page into whichever collection pages were last filed
into, a long press opens the picker to choose, and **nothing is ever auto-created**. There is no
implicit "Favorites" collection; every collection in the list is one the user made. Before anything
has been filed (or when the remembered collection has been deleted), a tap opens the picker too,
because there is nowhere sensible to put it.

## What this work is

1. **A plan rewrite — zero code for the item client.** The handoff is written as though the client
   was implemented against `/library/favorite-pages`; **it never was.** No client code for page
   items exists. The "mechanical rename migration" is therefore a documentation edit.
2. **A real migration — lists become collections. ✅ done (Phase 0).** *This* touched shipped code,
   because the runtime deleted lists outright: `LibraryList` no longer exists in `@comical/library`
   while `data/api.ts` imported it type-only, so the pin bump broke `bun run typecheck` and 404'd
   every `/library/lists*` call.

## Naming

Two collisions to keep straight:

- **`favorites`** is the remote per-series bridge-account concept (`/bridges/{id}/favorites`,
  `useFavorite`, `queryKeys.isFavorite`, `/favorites-import`). Untouched, and the only thing that
  may be called favorites in code.
- **`tags`** is content/genre tags (`getTags`, `excludedTags`) — which is why the runtime chose
  "collections" over "tags".

New client code says **`collectionItem` / `collections`**. UI label for the grouping system is
**"Collections"** everywhere the old UI said "Lists".

## 1. Types — import, don't redeclare

Type-only re-exports from `@comical/library`, as the app already does for `LibraryEntryView` /
`HistoryItem`. Do not write a parallel mirror.

```ts
type CollectionItemType = 'series' | 'chapter' | 'page';
type CollectionItem = CollectionSeriesItem | CollectionChapterItem | CollectionPageItem;  // on `type`
```

`CollectionPageItem` carries every field this plan relies on — `collectionIds`, `collectedAt`
(**renamed from `favoritedAt`**), `seriesTitle`, `chapterName`, `pageCount`, `sourceUrl`,
`contentHash`, `stale`. `ChapterPageRef` is unchanged; `FavoritePageSnapshot` → `PageItemSnapshot`;
`FavoriteCollection` → `Collection`.

Renames: `FavoritePagesQuery` → `CollectionItemsQuery` (gains `type?`, and has **no `uncollected`
sentinel**), `FavoritePageScope` → `CollectionItemScope` (gains `type?`), `favoritePageId` /
`parseFavoritePageId` → `collectionItemId` / `parseCollectionItemId`.

**Gone:** `UNCOLLECTED` (nothing is durably uncollected), `LibraryList`, `LibraryEntry.listIds`.

**Ids are prefixed** — `page:b:s:c:i`, `chapter:b:s:c`, `series:b:s` — and remain internal. They're
derived from coordinates, re-keyed by a reconcile, and never appear in a URL. Address items by
coordinates everywhere.

## 2. The store seam ✅ done

`AsyncStorageLibraryStore` (`src/data/embedded/library-store.ts`) implements six methods and no
longer has `listLists` / `putList` / `deleteList`:

```ts
listCollectionItems(scope?: { bridgeId?; seriesId?; chapterId?; type? }): Promise<CollectionItem[]>;
getCollectionItem(id: string): Promise<CollectionItem | undefined>;
putCollectionItems(items: CollectionItem[]): Promise<void>;
deleteCollectionItems(ids: string[]): Promise<void>;
listCollections(): Promise<Collection[]>;
putCollections(collections: Collection[]): Promise<void>;
```

Three requirements that are load-bearing, and fail silently rather than loudly:

1. **Shard by series** — `comical:lib:collection-items:{bridgeId}:{seriesId}` →
   `{ [id]: CollectionItem }`. One layout covers all three types, since a series item lives in its
   own series' shard. Measured 64ms → 3.4ms per chapter open at 25k items as a single document.
2. **Honour `scope`** — filter before deserialising, now including `type`.
3. **A batch call is ONE durable write per shard** — a reconcile repairs a chapter through one
   `putCollectionItems`.

Two things a rename pass misses, both handled:

- **A `chapterId`-scoped listing excludes `type === 'series'` items** — they have no `chapterId`, so
  a naive predicate either crashes or returns them.
- **Wipe, don't migrate.** Old `comical:lib:favorite-pages:*` records are invalid (ids changed
  prefix). Old list documents and stray `listIds` are abandoned in place, never read.

Emptied shards are removed rather than left as `{}`, so unscoped listings don't read dead keys.
Collections stay one document: `comical:lib:collections`. Everything goes through
`serializeAsyncMethods`; `diskUsage()` sums `comical:lib:*` for free.

**No lists carry-over — decided.** A one-time app-side migration was considered and declined:
collections start empty, and Phase 0 dropped the old keys unread.

## 3. Collections + series filing ✅ done

```
GET    /library/collections                          → Collection[]
POST   /library/collections                          ← { name } → Collection (201)
PATCH  /library/collections/{id}                     ← { name }
DELETE /library/collections/{id}
POST   /library/collections/reorder                  ← { orderedIds }
GET    /library?collection=&collections=&uncollected=
```

CRUD shapes are identical to the lists routes they replace, so the UI ported directly. `/library`'s
filter params renamed `list`→`collection`, `lists`→`collections`, `unlisted`→`uncollected`;
`LibraryListFilter` → `CollectionFilter`, whose `'unlisted'` sentinel became `'uncollected'`. Note
that `?uncollected=` on **`/library`** is still meaningful — it means "library entries in no
collection" — even though the *item* query has no uncollected sentinel.

**Filing a series** replaces `PUT /library/entries/{b}/{s}/lists`, which is gone:

1. `PUT /library/collected/series/{b}/{s}` ← `{ seriesTitle, thumbnailUrl?, author? }` — idempotent;
2. `PUT /library/collected/series/{b}/{s}/collections` ← the full membership array.

**Reading memberships** replaces `entry.listIds`:
`GET /library/collected?type=series&series={b}:{s}` → `item.collectionIds`. The library *grid*
doesn't need this — `?collection=` on `/library` joins server-side.

**Un-filing to zero removes the item.** `PUT collections: []` does it and reports
`{ removed: true }`; `DELETE` on the coordinates is equivalent, and is what `setSeriesCollections`
uses since it doesn't require the item to exist first. Deleting a collection removes every item it
was the last membership of, so the UI never strips members itself.

## 4. Item routes — the page surface (Phase 1)

```
GET    /library/collected?type=&sort=&dir=&collection=&series=&q=   → CollectionItem[]
GET    /library/collected/page/{b}/{s}/{c}/indices                  → number[]
POST   /library/collected/page/{b}/{s}/{c}/reconcile                ← { pages: ChapterPageRef[] }
                                                                    → { indices, repaired, stale }
PUT    /library/collected/page/{b}/{s}/{c}/{i}                      ← PageItemSnapshot → CollectionPageItem
DELETE /library/collected/page/{b}/{s}/{c}/{i}
PUT    /library/collected/page/{b}/{s}/{c}/{i}/collections          ← { collectionIds }
```

⚠️ **`type=page` is not optional on the grid.** Bare `GET /library/collected` returns the **mixed
union**, so a page grid that omits it silently renders series and chapter items too. The single
easiest thing to get wrong.

Everything behavioural carries over untouched: **`PUT` merges** (supplied field wins as fresher,
omitted preserved; `collectedAt`/`collectionIds` carry over; `stale` cleared on re-collect),
reconcile's shapes, indices-excludes-stale, `sort`/`dir`, `__direct__`, 404-when-no-library.

`DataSource` gains a method per route, coordinate-addressed throughout. **`src/data/mock.ts` must
implement every one** — mock mode powers the `__DEV__` toggle, the demo build and all e2e flows.

`src/data/queries.ts`: `collectionItems(mock, query)`, `chapterPageIndices(mock, b, s, c)`, plus
prefix key `collectionItemsAll(mock)` so one toggle invalidates every scoped grid — the trick
`libraryList(mock)` already uses. Persist both; bump `PERSIST_BUSTER`.

## 5. The reader affordance (Phase 1)

**Where.** A **bookmark** in the reader toolbar's trailing slot, left of the settings gear — one tap
from chrome the user has already revealed. Not a heart and not a star: the action is "file this into
a collection", not "like it", and the star already means the bridge's per-series favorite. Filled
when the page is in a collection, outline when not, via the existing `IconProps.filled` convention;
icon in `src/components/icons/reader-icons.tsx`. Chrome is deliberately unthemed white-on-dark —
match it, don't call `useTheme()`.

**What the button does.**

- **Tap, with a remembered destination** — `PUT` the page item, then file it into the collection
  pages were last filed into (`data/last-collection.ts`, per type, persisted, validated against the
  live list so a deleted collection doesn't resurrect).
- **Tap, with none** — open the picker. Never invent a collection.
- **Tap, already saved** — remove it.
- **Long press** — always open the picker.

The two writes must not be separated by anything slow: a freshly-`PUT` item with no memberships is
legal only **transiently**, which is exactly what makes the two-`PUT` hash flow safe, so the hash
goes in a *third*, later call. Unsaving is `collections: []` (or `DELETE`).

**Last-used is per TYPE** (`series` / `chapter` / `page`) rather than global — the collection you
file pages into is rarely the one you file series into, and one shared default would send half the
taps to the wrong place.

**Toolbar** (`reader-toolbar.tsx`). The trailing slot is a fixed 32×32 box holding one child, and the
leading spacer matches it so titles stay centred. Make it a row (`flexDirection: 'row'`,
`gap: Spacing.two`, `justifyContent: 'flex-end'`) behind an exported `TRAILING_SLOT_W`, and widen the
leading spacer to match.

**Chapter open → one call, one in-memory set.** Prefer `POST …/reconcile` with the page list the
reader already fetched; `GET …/indices` is the cheap fallback. Drive the button off that set, and
**never add a per-page status check**.

**Page index to the button.** `currentPage` is `useState` inside `ReaderPane`
(`src/app/series/index.tsx:3235`, `currentRef` :3236); the toolbar renders in the parent
`SeriesReaderInstance` (:535, mounted ~:2413). Add
`onVisiblePageChange?: (v: { pageIndex: number; chapterId: string }) => void`, fired from the settle
point that drives `record()` (~:3491, debounced at ~:3534).

**The stitched multi-chapter case must be handled or items silently mis-file.**
`handleFlatPageChange` (~:3299) / `handleFlatVisiblePage` (~:3323) map a flat index to
`(segment, page)`; `visibleSeg` (~:3295) holds the crossing page. The `shown` memo (~:3334) already
resolves this for the bottom chrome — add a sibling returning `{ pageIndex, chapterId }` off the
same branch. Reading `target.chapterId` unconditionally is the trap: invisible until a page collected
near a chapter boundary reopens on the wrong page.

**Hook.** `src/hooks/use-page-collected.ts`, modelled on `use-favorite.ts`'s optimistic shape:
derive `collected = indices.includes(pageIndex)`, optimistic patch, rollback, `onSettled` invalidate
`collectionItemsAll(mock)`. Its `toggle()` resolves to `'saved' | 'removed' | 'needs-pick' | 'noop'`
— `needs-pick` is how "there's no destination yet" reaches the caller without the hook reaching into
UI. `hapticSelection()` on toggle; `showChrome()` on press so the bar doesn't fade mid-tap.

**Mirror in the settings sheet** as a separate "This page" segment above `SeriesActionsRow`
(`settings-panel.tsx`) — two labelled buttons rather than the toolbar's tap/long-press pair, since a
sheet can afford the width and a long press is undiscoverable in a list of labelled actions.

testIDs: `reader.toolbar.collect-page`, `reader.settings.collect-page`,
`reader.settings.page-collections`.

### `contentHash` — bytes we already hold

`Image.getCachePathAsync(cacheKey)` (expo-image SDK 56) returns the disk-cache path of an image, or
`null`. The reader renders with `cachePolicy="memory-disk"` (`reader-page.tsx:426`) and no explicit
`cacheKey`, so the key is the URI handed to `<Image>` — the `source` from `useImageProgress`, which
diverges from `resolvedUri` on web (see `reader-page.tsx:318`). Read that file with
`expo-file-system`, hash with `crypto.subtle.digest('SHA-256', …)` — provided on Hermes by
`installWebCryptoShim()`, already installed at `startup.ts:119`. **No network request, no download
required.** Confirm the shim is installed in native-*remote* mode too; if not, omit the hash rather
than adding a polyfill.

Order of preference: any page the reader has displayed (`getCachePathAsync`) → downloaded pages
(blob store) → web (`image-progress.web.ts` already holds the bytes). A cache miss omits the hash;
sparse is expected, and reconcile adopts one later.

**Two-PUT pattern.** The shim's digest is JS, so SHA-256 over a ~1MB page is felt on Hermes. Collect
on tap, then `PUT { seriesTitle, contentHash }` when the hash resolves — merge semantics mean
`chapterName`, `pageCount` and `sourceUrl` survive untouched. The runtime's recommended flow, with
an end-to-end router test.

## 6. What we don't get

**No stored bytes, no thumbnail endpoint.** Page tiles re-resolve their URL — **batch per chapter,
never per tile**. The grid needs the network, and a page whose bridge is uninstalled or whose source
is dead has no image permanently; render a **text tile** from the `seriesTitle`/`chapterName`
snapshot rather than a blank. The recorded fix if it bites is a bounded LRU of downscaled tiles, not
reinstating capture.

**Stale items are never auto-deleted** and drop out of reported indices, so the reader must not
highlight or jump to one. They need a visible **"may no longer be available"** affordance — applying
to **chapter items as well as pages**.

**Free from the server:** `syncChapters` (already run for library series) re-anchors chapter *and*
page items when a source re-uploads a chapter under a new id with the same `(number, languageCode)`,
marking unmatched ones stale. So ids and indices can be re-keyed by a sync: **refetch across sync
events rather than caching** (already required, since reconcile re-keys too). Items on non-library
series get no drift detection — accepted, recorded in follow-ups §7.

## 7. Collections UI ✅ done (Phase 0)

`manage-lists.tsx` → `manage-collections.tsx`, `list-picker.tsx` → `collection-picker.tsx`,
`library-list-selector.tsx` → `library-collection-selector.tsx`, `use-library-lists.ts` →
`use-collections.ts`, `use-entry-lists.ts` → `use-series-collections.ts` (wrapping the
item+memberships pair). Route `/manage-lists` → `/manage-collections`. Existing entry points — the
card context menu, the actions menu, `series-body.tsx`, the reader settings sheet — kept their shape
and changed their labels to "Add to collection".

One UX judgement carried forward rather than decided silently: **filing a series still adds it to
the library first.** That used to be a technical requirement (the membership route needed an entry);
it isn't any more. It's kept because "file it" has always implied "keep it" here — but collections
can now hold series that aren't in the library at all, so it's worth a deliberate look. Un-filing
never removes from the library.

**Mixed-type browsing is new (Phase 4).** `GET /library/collected?collection={id}` returns the
union: switch on `type` and render each variant natively — series tiles from `thumbnailUrl`, chapter
rows from `seriesTitle`/`chapterName`, page tiles re-resolving the page URL. `sort=chapter`
interleaves sensibly. Presentation is the client's job; don't normalise the union into one tile.

## 8. The Library-tab browser (Phase 2)

```ts
type LibraryView =
  | { kind: 'series'; collection: CollectionFilter }
  | { kind: 'collected'; collection: string | null; type?: CollectionItemType };
```

`LibraryCollectionSelector` widens into a view selector: the same title-as-dropdown, listing
"Library" and each collection, plus a section for collected items and "Manage collections…". The
body swaps `SeriesGrid` for `components/collections/collected-items-grid.tsx` when
`kind === 'collected'`. Everything else on the screen is untouched.

Sort is **`sort` + `dir` separately** (Added / Series / Chapter order + direction), plus
**Group by: None · Series · Date**, persisted under `comical:collectedSort` following
`use-library-sort.ts`'s per-scope pattern. `scopeKey` must include view, type, sort, dir, grouping
and collection so recycled tiles reset on a switch.

**Sectioned rows.** Nothing in the repo does grouped lists; don't add a library. Precompute rows and
feed the existing `RecyclerList`:

```ts
type ItemRow =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'row'; key: string; items: CollectionItem[] };
```

Fixed 2:3 page slots give both row types a computable height, keeping LegendList from re-measuring
mid-scroll. Page tiles reuse `PageThumb` (`components/series/chapters-section.tsx:1377`) with a new
explicit-source prop, since items resolve URLs from a per-chapter batch rather than `PageThumb`'s own
lazy fetch (that path is series-level — `getPageThumb` takes no `chapterId` — and would be wrong).
Geometry from `use-grid-layout.ts`; `relTime()` for date headers.

The unscoped grid reads every shard (~5.5ms at 25k). Inherent; the recorded fix is cursor paging.

## 9. Opening an item (Phase 5)

- **Tap a page tile → a full-screen viewer** (`src/app/collected-page-viewer.tsx`, a
  `containedTransparentModal` like `series`): a pager over the currently filtered, currently sorted
  *page* items, so a swipe carries you between series. Reuse `zoomable-page.tsx` and
  `ReaderPageItem = { uri, key, pageNumber }`. Chrome: remove, add-to-collection, "Open in reader".
  A stale item shows its snapshot and the unavailable affordance instead of an image.
- **Tap a series tile** → the series screen. **Tap a chapter row** → the reader at that chapter.
- **"Open in reader"** pushes the existing series modal — no new reader machinery:
  `router.push({ pathname: '/series', params: { id: seriesId, bridgeId, reader: '1', chapterId,
  start: String(pageIndex), title, cover } })`.

## 10. Phasing

**Phase 0 — unbreak the build. ✅ DONE.** Lists retired end to end (§2, §3, §7): collections routes
and filter params, the six store methods, both hooks, all three components, mock rewired so
memberships live in their own map, e2e flows and testIDs renamed. typecheck / lint / lint:testids /
136 tests / check:flow-coverage green.

**Phase 1 — page items + the reader heart. ✅ DONE.** Item routes in `api.ts`, `DataSource` +
`mock.ts`, query keys with the `collectionItemsAll` prefix, `chapterPageIndices` excluded from
persistence (a sync can re-key it), `PERSIST_BUSTER` v4→v5. `use-page-collected.ts` drives the
heart off one indices query per chapter and files into the lazily-created heart collection;
`use-chapter-reconcile.ts` verifies that chapter against the page list the reader already fetched
and seeds the indices. `collect-page-control.tsx` in the toolbar's widened trailing slot,
mirrored as a "This page" segment in the settings sheet off the same cache key. `page-hash.ts`
hashes from `Image.getCachePathAsync` for the second PUT. `series/index.tsx` reports the visible
page via `onVisiblePage`, chapter-correct across a stitched crossing (`shownWithChapter`).
Tests in `src/data/collected-pages.test.ts` lock merge-on-PUT and empty-memberships-removes;
`e2e/mobile/collect-page.yaml` covers the round trip.

The picker (`collection-picker.tsx`) now speaks **both** series and page coordinates through one
`ItemTarget` union, and `use-item-collections.ts` replaced `use-series-collections.ts` to serve
both — which is what lets the long-press work at all. Filing through it also records the type's
last-used collection, so the picker and the one-tap save stay in step.

**Phase 2 — the browser. ✅ DONE.** `LibraryView` (`kind` × `collection`) drives the tab;
`LibraryCollectionSelector` grew a second `OptionList` for saved pages — two axes, not two lists of
collections. `collected-items-grid.tsx` builds fixed-height rows for `RecyclerList` (header rows
slot in for Phase 3 grouping without restructuring), `use-collected-page-uris.ts` resolves URLs
**one request per chapter** off the `chapterPages`/`directPages` cache, and tapping a tile pushes
the existing series modal at that page. `type: 'page'` is pinned on the query.

Two deviations from what this plan originally said, both deliberate:

- **`PageThumb` is not reused.** It exists to render a *bridge-supplied* thumbnail and lazily
  self-fetches via `getPageThumb`, which is series-level (no `chapterId`) and wrong here; it also
  carries sprite cropping and aspect learning a plain page URL doesn't need. `collected-page-tile.tsx`
  is a small dedicated tile instead, and it owns the two states `PageThumb` has no concept of — a
  dead source (text tile from the snapshot) and a `stale` item ("may no longer be available").
- **`useCollectedPageUris` is deliberately not memoized.** It derives from `useQueries` results,
  which are a fresh array every render, so any dep list either lies or needs a suppression. It is a
  lookup table read during render — never a memo dependency.

The sort control is hidden in the saved-pages view: sort/dir for collected items is Phase 3, and
showing the library's sort there would be a lever that does nothing.

**Phase 3 — the axes. ✅ DONE.** `collected-view.ts` holds sort/dir/grouping as one persisted
Legend State preference (per view, not per collection — sort is a habit, unlike the library's
per-list sort). `collected-sort-button.tsx` presents them as three sections, because sort and dir
are separate server params and grouping is client-side. `collected-rows.ts` turns the server-ordered
list into typed header/tile rows; both heights are constant so a sectioned list still never
re-measures, and `getItemType` keeps headers and tile rows in separate recycling pools.

**Grouping composes with sort rather than replacing it**: items bucket in order of first
appearance and each bucket keeps its incoming order, so "newest first, grouped by series" means
series ordered by most-recently-added, each series' pages newest-first. `collected-rows.test.ts`
locks that, plus per-header counts, calendar-day bucketing, and item-derived row keys (an
index-based key would leave a recycled row showing the previous items).

Picking a sort resets direction to that sort's natural default, so switching to "Series" doesn't
leave you reading Z→A because you'd once chosen newest-first.

**Phase 4 — chapter items and mixed browse.** "Add chapter to collection", mixed-union rendering.

**Phase 5 — the viewer.**

## 11. Verification

From `apps/mobile/`:

```
bun run typecheck
bun run lint
bun run lint:testids
bun test
bun run check:flow-coverage
```

New Maestro flows in **both** `e2e/mobile/` and `e2e/web/` (check `e2e/README.md` for the web-only
selector/gesture quirks first): series → read → reveal chrome → heart → Library → switch to the
collected view → assert the tile → tap → assert the page opens. Re-tap to reveal chrome between
steps; it auto-hides after 3s.

Manual: `bun run dev` alongside a `@comical/host-server` on :3100, plus mock mode. Six things worth
deliberately provoking, each hiding a bug this design can produce:

1. A page collected **mid-chapter-crossing in stitched paged mode** reopens on the correct page.
2. The grid query **without `type=page`** — confirm the guard; the failure is silent.
3. A **reconcile or `syncChapters` run that re-keys ids** leaves grid and reader agreeing, with
   nothing holding a pre-sync id.
4. **Emptying an item's memberships** removes it, and the reader's heart goes hollow to match.
5. **Deleting the heart collection** deletes the pages in it — the consistent behaviour, but the one
   most likely to surprise; make sure the confirm copy says so.
6. A **stale** item — page *and* chapter — renders its affordance, stays out of the reader's
   indices, and survives restarts.

Finally, tick `todo.md`'s "Add 'page' favoriting mechanism" line.
