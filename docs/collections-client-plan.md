# Universal collections — client plan

The runtime half has landed in the `comical` submodule
(`claude/page-favorites-runtime-00agdx`, pinned here at the branch head `af99872`). This document is
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
3. **A second real migration — the LIBRARY dissolves into collections. ✅ done (§11).** Bigger than
   the first: `LibraryEntry` is gone, every `/library/entries/*` route moved, `/library`'s rows
   renamed under the grid, and add-to-library became filing. It also carries the project's one
   genuine **data** migration (§11.1) — skip that and the user opens the app to an empty shelf.

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

Type-only re-exports from `@comical/library`, as the app already does for `HistoryItem`. Do not
write a parallel mirror.

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

**Gone:** `UNCOLLECTED` (nothing is durably uncollected), `LibraryList`, and `LibraryEntry` itself
— a tracked series is a `CollectionSeriesItem` (§11).

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
collection" — even though the *item* query has no uncollected sentinel. Under §11 that is a
transient state rather than a place series live.

**Filing a series** replaces `PUT /library/entries/{b}/{s}/lists`, which is gone. It is now ONE
call — `PUT /library/collected/series/{b}/{s}` ← `{ seriesTitle?, thumbnailUrl?, author?,
externalIds?, collectionIds? }`, idempotent, `200 { item, autoLinked?, trackerSuggestions? }`. The
memberships ride the same request deliberately: a series nobody filed is only *transiently*
collected (§11), so a follow-up call would leave a window where it could be swept. There is a
membership-only `PUT …/series/{b}/{s}/collections` for re-filing something already collected, but
the client doesn't need it — the collect PUT covers both.

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

**Phase 4 — chapter items and mixed browse. ✅ DONE.** Chapter routes in `api.ts`/`source.ts`/
`mock.ts`; `ItemTarget` gained a `chapter` variant so the picker files all three types. The reader
sheet grew a "This chapter" segment — one button straight to the picker, since saving a chapter is
a deliberate act from a menu rather than a reflex, so there's no last-used shortcut to justify. It
sends `number`/`languageCode` (read from the chapter roster, not `ReadTarget`, which carries only
an id and a display name) because together they are the chapter's re-anchor identity, and it is
hidden for a direct series, where `__direct__` is a sentinel rather than a real chapter.

**Opening a collection now shows its whole contents**, not just its pages: "All saved pages" is a
type filter (`type=page`), while a collection asks with no type filter — hiding two of the three
kinds would make a collection look emptier than it is (`collectedQueryFor`).

Rendering keeps the runtime's interleave (a series leads its chapters, a chapter leads its pages)
rather than re-bucketing by type: `buildCollectedRows` walks in order, accumulating tile-able items
(pages and series covers, both 2:3) into grid rows and flushing that run whenever a chapter appears,
since a chapter has no image of its own and renders full width. Tapping routes by type — a page to
its page, a chapter to its first page, a series to its detail screen.

**Phase 5 — opening a saved page. ✅ DONE — and revised: there is no viewer.** A saved page (or
chapter) opens **the real `/series` reader**, through the exact entry History rows use — reader
mode, landed on the saved page, cold series. A dedicated flip-through screen was built first and
then deleted: it was a parallel reader, and a parallel reader drifts. Going through the real screen
means the reveal-to-details (with its own lazy loading and skeletons — nothing about the series is
fetched before the tap), the collapse dismissal, the settings sheet and the toolbar save button are
all shared by construction; a change to the reader is a change here.

**Phase 6 — the cross-series album swipe (READER SEQUENCE). ✅ DONE.** Paging from one saved page
straight into another series' page, inside the real reader — the "first-class reading sequence
abstraction" the previous paragraph predicted, built exactly there:

- `use-reader-sequence.ts` resolves the album from `seq*` route params: the same
  `collectionItemsQuery` key the grid used (warm cache → synchronous open), filtered to pages, in
  the grid's exact order, plus per-chapter-resolved URIs (`useCollectedPageUris`, '' until
  resolved — the page's own skeleton covers it). The `uris` array keeps its identity while its
  contents do (adjust-state-on-render), because the reader takes it as the pager's verbatim page
  list.
- **The instance treats the sequence as its page list, and every piece of chapter machinery
  self-disables** because the sequence target carries no `chapterId`: chapter-pages query,
  preferred-group, adjacency, stitching, reconcile, progress recording (`recordProgress={false}` —
  an album hop is browsing, not a read position) and the skip buttons all gate off `sequence`.
  The chrome describes the VISIBLE ENTRY (`visibleSequenceEntry`, indexed by the pane's settled
  flat index): toolbar title/subtitle, and one shared `pageAction` derivation feeding the save
  button and the settings sheet, so un-saving works from inside the album with the entry's own
  coordinates.
- **A series cross is a PAGE TURN — one instance, one pager, for the whole album.** The pager
  never remounts (the exact discipline that makes a stitched chapter crossing seamless); what a
  cross changes is only what a stitched crossing's relabel changes. The DETAIL identity
  (`detailBridgeId`/`detailSeriesId`/`detailKey`) derives from the visible entry, and everything
  series-scoped re-points by key: the detail/chapter-roster/library queries, the details host
  (keyed by `detailKey`, so a cross remounts just that off-screen card with fresh skeleton
  state), the details top bar, and the settings sheet's series-level actions. The album roster is
  LATCHED for the open's life (use-reader-sequence) so an un-save invalidation can never shift
  pages under the reader's thumb — the save button still reads live indices, and the grid
  rebuilds on return.
- **Details taps escape the album as a drilled LAYER**: tapping a chapter (or a direct series'
  page) in a revealed details card is a NEW read, not an album jump — it opens reader-first as a
  layer over the album (the same slide a related-series card gets), album intact underneath.
- Library pushes `{seq:'1', seqCollection, seqSort, seqDir, seqQ?, seqStart: item.id}` for a page
  tile; chapter tiles keep the plain reader push, series tiles the details push. A cold deep link
  fetches and shows a spinner; a sequence that resolves empty pops back.
- **Nothing about a series is fetched until the reveal asks** (`seriesWanted`, armed PER SERIES):
  in sequence mode the series queries — detail, chapter roster, library membership, and the
  details host's own subscription — are deferred until the reveal starts moving (an animated
  reaction on `progress`, so the fetch is in flight while the swipe is still travelling). The arm
  is keyed to the series it was armed for: reveal on A, collapse, cross to B — B stays unfetched
  until ITS reveal, while A's answer sits in the query cache for an instant re-reveal.
  Non-sequence instances are armed for their own series from mount — their ordering contract is
  untouched.
- **The entrance flies light.** A sequence open is the one zoom entrance whose destination is
  ready on the FIRST commit (warm cache → `readerReady` immediately), and the zoom scales the
  whole destination screen behind its mask — mounting the entire pager plus firing one
  chapter-list fetch per album chapter in that same commit was the chop. Two deferrals, both
  copies of existing patterns: the pane rides `standby` until the zoom spring completes
  (`entranceSettled` — render window of 1, no warm-ahead; the visible page still mounts and
  paints, being what the entrance reveals), and URI resolution is cache-only for the album's
  first beat (`ENTRANCE_QUIET_MS` in use-reader-sequence; the tapped page's chapter is cached by
  construction — its tile just rendered from that list).
- **The tiles get the full GALLERY ZOOM** (`lib/series-zoom`, the same flow a series card runs):
  press-in captures the tile's box as the source rect, the destination grows out of it — the
  reader for a page, the details for a series — and the dismissal collapses back into it, the
  tile blanking while a copy of its picture is in the air. The source key is PER ITEM (derived
  from the item id), not per list: this grid legitimately shows the same series in several tiles
  (two saved pages of one series), and a list-level key would blank every sibling. In sequence
  mode the flying copy draws the MOUNT entry's page URI (latched in `sequenceTarget`) — the very
  URL the tile rendered, so the copy has pixels immediately and the collapse lands the tile's own
  picture back on it. Text-card tiles (chapters, dead sources) don't capture — no picture to fly,
  so they take the ordinary entrance.

## Post-phase revision: one selector axis, one tile shape, reader-grade gestures

User feedback after the phases landed reshaped the browsing surface:

- **The selector is one flat list again.** "Library" plus each collection — the two-section version
  (collections vs "saved pages") read as two competing lists of the same names and was cut. Opening
  a collection shows its WHOLE contents (series, chapters, pages, mixed); there is no page-only view
  of a collection and no "all saved pages" view. Collections also no longer *filter* the series
  grid — the library query is always unscoped, and a collection row IS its contents view.
- **Every item type is the same 2:3 tile** (`collected-item-tile.tsx`), distinguished by a type-icon
  badge (`collection-icons.tsx`: BookCopy/BookOpen/FileImage). The full-width chapter row is gone,
  which also un-complicated `buildCollectedRows` — the mixed union chunks into one grid in incoming
  order. A chapter tile is always the text card (it has no image of its own).
- **Grouped section headers are STICKY**, pinned at the top bar's bottom edge — built as an overlay
  rather than through the list, because list-level sticky rows pin to the viewport top, which is
  behind the translucent bar. Fixed row heights make the current section pure arithmetic on the
  scroll offset: JS state swaps which label shows (boundary changes only), and the push-out ride is
  an animated style on the UI-thread scroll offset the list already publishes, clipped at the bar's
  edge. One `SectionHeader` component renders both the inline row and the pinned copy, so the
  hand-off stays pixel-identical — because it is literally the same component: `renderHeader`
  renders the row the list renders inline, and the surface HIDES that row while the pinned copy
  stands in (`onActiveChange` → it keeps its space, drops its content), so one heading is never
  drawn twice. The sticky contributes only a **surface** while pinned — the page's own background
  plus a bottom hairline, appearing WITH the heading (nothing fades: the trick is that an
  identical, co-located heading is being swapped, and a ramp announces the second object). The
  RULE belongs to the heading it underlines, and there are TWO — one per heading in a hand-off,
  traded on a single frame. The pinned heading's rides inside the band and switches OFF the instant
  that heading starts moving; the superseding heading's switches ON at the same instant, tracks that
  heading up (it is a list row, so it lives outside the clip) and lands exactly where the pinned one
  reappears at the swap — two consecutive bands are always one `bandHeight` apart, which is the
  whole of the arithmetic. So a heading is never underlined while leaving, never bare while
  arriving, and no hairline is ever seen sliding up the chrome. They are hairline views; as a border
  on the band it was painted UNDER the band's own opaque fill and so only showed through the gap a
  push-out opened — visible exactly when it should have been hidden. Rules and ride all come off one
  `pushOffset` worklet, so none can disagree with where the band is, and all guard against the DRAWN
  section rather than `active` (those differ on the very first pin, which made the whole band land a
  JS frame late). The top bar
  drops its OWN rule while any heading is pinned, so the two never stack into a banded edge — routed
  through a `pinnedValue` **shared value** the sticky writes on the UI thread and each screen reads
  in an animated `borderBottomColor`, so the bar's rule goes out on the very frame this one comes
  in. Through React state it trailed by a frame or two, which is two rules for two frames, every
  time — with
  symmetric padding of its OWN around the heading — an inline heading's rhythm can be deliberately lopsided (Browse's is), which is
  invisible until a surface is drawn around it and then reads as a header sagging in its box. That is the convention, arrived at the long way: a solid band, then a bare band, then a
  black PILL were each tried, and the pill in particular had to have its type size, then its
  baseline, then its gutter hand-matched to the heading — because a heading morphing into a
  differently-styled chip is a match no framework keeps for you. iOS pins the header itself and
  fades a material in behind it (Photos does exactly this); the floating-pill treatment belongs to
  surfaces whose separator is a pill inline as well (WhatsApp's date bubble). Rendering one
  component in two places keeps them identical by construction.
- **The pinned heading's ride never waits for JS.** The label is React state, so the obvious sticky
  puts a `runOnJS` round trip on the visual path of every crossing — and during a fling that queues
  behind LegendList's row recycling, which is exactly why it felt a beat slower than the sliding
  bars reading the very same `scrollOffset`. An earlier cut guarded the ride on JS agreeing, which
  was correct and stalled. Now `StickySectionHeader` renders THREE headings — the based-on section
  and its two neighbours — stacked a band apart with the middle one at the pin line, and the UI
  thread translates whichever the scroll wants into place (`pinAt`). The neighbours sit outside the
  clip, so they cost nothing until one arrives. The base re-bases afterwards, and since the
  translate loses exactly the band it gains, the rendered position is identical either side of that
  commit — a late update is invisible rather than a jump. A fling that outruns all three hides the
  band for those frames instead of showing a heading it knows is stale. Past 0.12 of a band of scroll
  PER EVENT the push is **deferred**: the band holds at rest and the heading is replaced outright on
  the frame the next one reaches the line, since intermediate frames read as a flash rather than as
  motion well before the speed at which they stop rendering at all. **The fix was WHEN the threshold
  is read, not what it is.** Three cuts got this wrong before it landed. A bare threshold read every
  frame chatters; adding hysteresis makes the crossing rarer without making it any smaller, since a
  latch flipping mid-push jumps `p` straight to an end either way — which is why lowering the
  threshold only relocated the chatter. Ramping continuously on speed instead (a gain about the
  push's midpoint, or a shrinking span) has no threshold to chatter on, but makes `p` a function of
  speed *everywhere in the push*, so the speed sample's own noise becomes position noise and the
  band jitters in place: one bad speed traded for every speed, and it read as worse on device.
  What works is restricting WHEN the latch may change: only while the band is at rest, so the
  decision is taken once as a crossing begins and held for its duration. It cannot flip mid-push,
  and at rest both behaviours give `p = 0`, so the one moment it can change is the one moment
  changing it is free. Deferring rather than snapping to the nearer end is required by that same
  restriction — a scroll decelerating to rest mid-crossing strands the latch, so what it holds has
  to still look right, and held at 0 the band is simply at rest with the incoming heading behind it.
  Simulated over eight scroll traces (crawl, border speed, fling, fling-then-stop, an alternating
  2/10px trace straddling the threshold, reversal) at two JS-commit lags, the pinned heading never
  moves faster than the content under it and never swaps with push still owed.
- **A list row must be told when something outside its item changed.** `RecyclerList` now forwards
  `extraData`, and both grids pass the pinned key. LegendList memoizes a row on its item, so without
  it a mounted heading kept the hidden flag it captured: scrolling DOWN usually looked fine (the row
  had just been recycled into view, so it re-rendered anyway), scrolling back UP never un-hid it,
  and that one heading was simply missing until something else forced a re-render. Intermittent, and
  per-row, which is exactly how it presented.
- **Browse's section headings pin too** — the sticky generalized into `StickySectionHeader`
  (sticky-section-header.tsx), which `GroupedGrid` and `ContentFeed` both render: caller-supplied
  section offsets, a reaction that reports boundary crossings to JS (ignoring its initial report —
  a remounted list's scroll shared value is stale until the first real scroll event), the
  agree-guarded push-out, and — new for Browse — `barOffset`: the pinned heading RIDES the sliding
  top bar so it stays glued to the bar's bottom edge as it hides and returns. It keeps the See-all
  chevron live (sections thread their target through; the overlay passes touches through except on
  pressables) — the pinned copy being the real `SectionHead` row, chevron and all; it stays
  MOUNTED — its quick fade is driven by a UI-thread
  reaction on the same arithmetic, so it starts on the exact frame the line is crossed rather than
  a frame late off the JS boundary report. ContentFeed's two
  variable-height row types (grid blocks) report their measured heights into the offset walk;
  sections past a not-yet-measured block are omitted (it is at least a drawDistance away). No
  sticky while a list header (error block) is up — it would shift every offset.
- **The LIBRARY grid groups too** — by Source (bridge), Date added, or Last read ("Not read yet" is
  a real bucket) — through the same machinery, generalized: `buildGroupedRows` (grouped-rows.ts) is
  the shared bucketing/chunking, `GroupedGrid` (grouped-grid.tsx) the shared row list + sticky, and
  each surface supplies only its group definition (`buildCollectedRows` / `libraryGroupOf`) and its
  tile. `SeriesGrid` gained a grouped mode (`groupOf` + `stickyHeaderTop`); the choice persists
  (`useLibraryGrouping`) and lives in the sort menu as a second "Group by" section. `LibraryItem`
  carries `addedAt`/`lastReadAt` through for the date axes; the mock seeds deterministic spreads so
  the demo and e2e show real buckets.
- **Every gesture is the reader's own, because the surface IS the reader.** Drag down dismisses
  through the reader's collapse; swipe up reveals the series details in place, lazily, with the
  series screen's own skeletons — nothing about a series is fetched before the reveal asks for it.
  There is no viewer code to keep in step: sequence mode reuses the one screen, so a change to the
  reader is a change here by construction.

## 11. The library dissolved into collections ✅ done

The third and last of the runtime's replacements, and the only one with real UX consequences.
**There is no `LibraryEntry`.** A tracked series IS a `CollectionSeriesItem`, sitting in the same
per-series shard as its chapter and page items, and *being in the library* means *being in at least
one collection*. `/library/entries/*` is gone as a path prefix; the whole family moved under
`/library/collected/series/{b}/{s}/*`.

### 11.1 Migrate the user's library — the one thing that destroys data if skipped

The device's `comical:lib:entries` document is dead under the new model, and wiping it opens the app
to an **empty shelf**. It does not have to: everything a series owns other than the entry row —
chapter progress, tracker links, the cached detail and chapter list, group membership — is keyed by
`entryKey` in its OWN document, so the dissolution orphaned those rather than deleting them.
Rebuilding the series items reattaches the lot.

`src/data/migrations/legacy-entries.ts` reads that document once at startup and hands the rows to
`Library.importLegacyEntries`, which owns the domain logic so every host migrates identically
(the server does the same to its `entries.json`). Row-by-row validation, idempotent on coordinates
already collected, and it files everything into the **`Library`** collection — under pure
collections an unfiled series would be swept by the next thing that touches it.

It lives in `src/data/migrations/` because that is now where every migration lives: `index.ts`
there is the registry — one list of everything on a device that reshapes data a user already has,
which is the one category of code here that can destroy something irreplaceable.
`migrations.test.ts` walks the directory and fails the build on a file that isn't registered, so the
list can't drift from the code. `PERSIST_BUSTER` is deliberately NOT in it — it discards a cache, it
doesn't move data.

**It is also the only entry.** Three pre-0.1.1 `migrateLegacyKey` adoptions (server URL, embedded
mode, NSFW mode) carried bare-string keys into their JSON-owned replacements; they shipped before
0.1.1 and every reachable install is long past them, so they went, along with the `migrateLegacyKey`
helper in `lib/observable.ts` that only they used. Registering them was what made them removable —
they had been invisible module-load side effects inside three unrelated stores. Hence `since` on
each entry: "can this go yet?" should be answerable without archaeology.

Four things about the wiring in `startup.ts` that are deliberate:

- **One store instance** for the process. The migration writes through the same
  `AsyncStorageLibraryStore` the router does, so they share its `serializeAsyncMethods` lock;
  two instances would each hold their own and interleave.
- **After `installWebCryptoShim()`** — the import mints a collection id with `crypto.randomUUID`,
  which Hermes doesn't ship.
- **Not awaited.** Blocking launch on AsyncStorage reads would cost every user a slower cold start
  for a once-ever migration, so the library screen can race it; a run that actually imported
  something bumps the data epoch and invalidates, exactly as a registry change does.
- **The original is parked, not deleted** (`comical:lib:entries.migrated`), until it has been
  confirmed on a real device. It stays inside `comical:lib:*`, so the Storage screen counts it —
  honest, and the nudge to eventually drop it.

Deliberately NOT migrated: lists and any favorites keys. Those shipped to nobody.

### 11.2 The renames that reach the screens

`GET /library` serves series items now, so the wire shape changed under the library grid:
`title` → `seriesTitle`, `addedAt` → `collectedAt`, `listIds` → `collectionIds`. All of it is
absorbed by **`toLibraryItem`** in `source.ts` — the app's `LibraryItem` is its own type, so one
adapter kept the rename off every library screen. `LibraryEntryView` → `CollectionSeriesItemView`
(aliased `ApiCollectedSeries`). `LibraryItem.addedAt` became `collectedAt` and is now **required**:
a collected series always has one.

`PERSIST_BUSTER` v5→v6. A v5 `library` entry rehydrates with no `collectedAt` and dumps the entire
grid into the "Date added" grouping's `Earlier` bucket; cover URLs moved with the routes; cached
series items gained `updatedAt`/`knownChapters`. None of it is repairable in place.

### 11.3 Add-to-library IS filing — one Save button

`addLibraryEntry`/`putSeriesItem` collapsed into one `collectSeries` PUT (memberships ride the same
request), and `removeLibraryEntry`/`deleteSeriesItem` into one `uncollectSeries`.

**And so did the UI.** Four surfaces each carried TWO controls — "Add to Library" *and* "Add to
collection" — for what is now one action, and the one people reached for couldn't say what the other
had done. They are now a single **`useSeriesSave`** control on all four (series screen, web card
menu, native long-press menu, reader panel):

- **Unsaved** → a tap puts it in the **default** collection (`data/default-collection.ts`, created
  on first use — the same one a migrated shelf lands in). The button keeps the old "＋ Library" /
  "✓ In Library" wording.
- **Saved** → a tap opens the picker, where the collections are changed or cleared. A saved series
  is deliberately not one tap from gone: it carries progress, downloads and tracker links.

It deliberately does **not** follow the reader's Google Maps save (a page files into whichever
collection pages were last filed into). That was tried first and reverted on use: the Maps model
only reads as predictable when the button NAMES its destination — "Saved in Reading" — and a button
reading "Save" on a series screen is ambiguous enough to be confusing. Once the label goes back to
"Library", a silent last-used destination makes it a lie: press ＋ Library, get "Reading". Pages
keep the Maps model, since their button never claimed otherwise.

Membership IS the saved state, so the control reads the series' collections and nothing else —
the old pair read that *plus* a separate is-it-in-the-library check that could disagree with it.
`useLibrary` is deleted; `inLibraryQuery` survives for its other two readers (the chapters section
and the series screen's own gating). `DataSource.addToLibrary`/`removeFromLibrary` are gone with it:
the picker owns removal, and every write goes through `setSeriesCollections`.

The native long-press menu keeps its in-place submenu as that row's picker (better than a root sheet
rendering over the menu), so its glyph is the affordance: ✓ saved, ＋ when a tap will commit
outright, › when it will expand.

**The default collection is `Default`, pinned by id.** It was `Library`, matched by name, and both
halves were wrong. The name put a second "Library" row in the Library tab's selector directly under
the row for the whole library — and for a freshly migrated shelf the two listed exactly the same
series, so it read as one list rendered twice. The name-matching meant renaming it in Manage
collections silently spawned a second default on the next add.

So `resolveDefaultCollection` remembers an **id** (`comical:defaultCollection`) and resolves in
order: the remembered id → a collection named `Default` → a collection named `Library`, **renamed in
place** → create one. That third step is what adopts a shelf migrated by the first cut of this
branch instead of stranding it beside a new `Default`; it can only fire once per device. The
migration files under `DEFAULT_COLLECTION`'s own name, so step 2 catches a fresh one — deliberately
NOT by pinning the id at startup, which is inside the window where Legend State drops a persisted
write, silently. **A new install gets `Default` too**: nothing migrates, and the first save falls
through to step 4. The runtime's own `importLegacyEntries` default moved to `Default` to match, so a
remote host migrating its `entries.json` (which passes no name) doesn't hand the app a "Library"
collection to adopt-and-rename. The rule itself is pure (the storage is injected, and lives in
`default-collection-store.ts`), which is what lets it be tested without mocking the platform. The
selector's unfiltered row is **"All"**.

It also serves **bulk, non-interactive** collects — importing a bridge's favorites, which has no
user to ask.

**e2e:** one tap, as before — the picker only opens for a series that is already saved.

### 11.4 Removing a series cascades — but NOT to read state

Three actions can now remove a series where there used to be one: the explicit delete, un-filing its
last collection, and **deleting a collection that was some series' only one**. All three take the
offline detail, cached chapters, cover blob, activity feed and group membership — caches the next
sync refills.

**Read progress and tracker links survive**, and that is the point. Since tidying shelves can now
remove a series, letting the cascade reach read state would mean quietly destroying the one thing
the user cannot get back. Uncollect and re-collect and the reader is exactly where it was.

So the collection-delete confirmation must NOT warn about losing progress — the old copy said
"Series in it stay in your library", which the dissolution made false in the other direction. It now
says what leaves (anything not in another collection, series included) and that progress is kept.

Destroying read state is only ever explicit: `DELETE /library/collected/series/{b}/{s}/progress`,
behind `useResetReadProgress` (confirm → toast → invalidate progress/library/history). It lives on
the per-series menu — both the web/actions menu and the native long-press one — rather than on a
library-only surface, because it has to reach a series that ISN'T collected: nothing sweeps progress
orphaned by an uncollect, so that is how it gets reclaimed.

### 11.5 NSFW, and one rule for it

Every cross-bridge list of the user's own data hides items from NSFW bridges while NSFW is off, and
each surface open-coded that — which is how a collection's contents came to show NSFW series with
NSFW off: the surface was new and simply didn't have the line. The album built from a collection
(`useReaderSequence`) had the same gap, so a hidden page could still be swiped into from a
neighbour. Both now go through **`useVisibleByBridge`**, one hook, so a new surface inherits the
rule instead of re-deriving it.

It filters in the component rather than in `queryFn` on purpose: NSFW visibility is a device
preference, not part of the fetch, so folding it in would key the cache without it — and the
session-scoped modes (`until-background`, `until-restart`) flip with no write to invalidate on.
An unknown bridge counts as safe, or the library would blank for the first frames after launch.

## 12. Verification

In the **submodule**, `bun run build` BEFORE `bun test`. `bridges/*/dist/` is gitignored build
output, so a fresh clone has no bridge bundles and every test that loads one fails — 51 of them,
which reads as a broken branch. It isn't: built, it is 1052 pass / 0 fail. (Reported here as
pre-existing breakage twice before that was run down.)

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
7. **The migration, on a device with a real pre-collections library** (§11.1) — series, unread
   counts and resume points all present afterwards, filed into `Library`, and a second launch
   imports nothing. This is the one item on this list that loses user data if it's wrong.
8. **Uncollect a series, then re-collect it** — the reader resumes where it was, chapter read flags
   intact. Then **reset read progress on a series that isn't collected** and confirm it clears.

Finally, tick `todo.md`'s "Add 'page' favoriting mechanism" line.
