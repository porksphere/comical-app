# Universal collections — client plan

The runtime half has landed in the `comical` submodule
(`claude/page-favorites-runtime-00agdx`, pinned here at the branch head `90405dd`). This document is
the `comical-app` half.

**The submodule is the source of truth.** Travelling with the pin:
`external/comical/docs/collections-handoff.md` (the migration brief — transient, deleted when that
branch merges), `collections-plan.md` (design rationale), `page-favorites-followups.md` (deferred
decisions — settled, don't re-derive).

Supersedes `docs/page-favorites-plan.md`, deleted alongside this.

## What this actually is

Two jobs that look like one:

1. **A favorites plan rewrite — zero code.** The handoff is written as though the client was
   implemented against `/library/favorite-pages`; **it never was.** No client code for page
   favorites exists. The "mechanical rename migration" is therefore a documentation edit, and the
   rest of this plan is simply the original plan restated against the new names.
2. **A real migration — lists become collections.** *This* touches shipped code, and it is not
   optional or deferrable, because the runtime deleted lists outright.

### The pin bump breaks the build today

`LibraryList` no longer exists anywhere in `@comical/library`, but
`apps/mobile/src/data/api.ts:864` still imports it type-only (re-exported as `ApiLibraryList`). So
`bun run typecheck` fails the moment the pin moves, and every `/library/lists*` call 404s at
runtime. **§3 is not "new feature work" that can queue behind favorites — it is repair work the pin
has already made due.** Sequence accordingly: land §3 first, or land §3 and §4 together.

Files carrying the lists surface (from a survey of `src/`): `data/api.ts`, `data/source.ts`,
`data/mock.ts`, `data/types.ts`, `data/queries.ts`, `data/embedded/library-store.ts`,
`hooks/use-entry-lists.ts`, `hooks/use-library-lists.ts`, `hooks/use-library-sort.ts`,
`components/list-picker.tsx` (370 lines), `components/library-list-selector.tsx`,
`components/series-card-context-menu.tsx`, `components/series-card-actions-menu.tsx`,
`components/series/series-body.tsx`, `components/reader/settings-panel.tsx`,
`app/manage-lists.tsx` (150), `app/(tabs)/library.tsx`, `app/_layout.tsx`, `app/favorites-import.tsx`
— plus `e2e/{mobile,web}/library.yaml` and `registries-lists.yaml`.

## Naming

Two collisions to keep straight, not one:

- **`favorites`** is the remote per-series bridge-account concept (`/bridges/{id}/favorites`,
  `useFavorite`, `queryKeys.isFavorite`, `/favorites-import`). Untouched by any of this.
- **`tags`** is content/genre tags (`getTags`, `excludedTags`) — which is why the runtime chose
  "collections" over "tags".

New client code says **`favoriteItem` / `collections`**. UI label for the grouping system is
**"Collections"** everywhere the old UI said "Lists".

## 1. Types — import, don't redeclare

Type-only re-exports from `@comical/library`, as the app already does for `LibraryEntryView` /
`HistoryItem`. Do not write a parallel mirror.

```ts
type FavoriteItemType = 'series' | 'chapter' | 'page';
type FavoriteItem = FavoriteSeriesItem | FavoriteChapterItem | FavoritePageItem;   // discriminated on `type`
```

`FavoritePageItem` is the old `FavoritePage` plus `type: 'page'` — every field this plan relied on
(`collectionIds`, `favoritedAt`, `seriesTitle`, `chapterName`, `pageCount`, `sourceUrl`,
`contentHash`, `stale`) is unchanged. `FavoriteCollection`, `FavoritePageSnapshot`, `ChapterPageRef`
and `UNCOLLECTED` are unchanged outright.

Renames: `FavoritePagesQuery`→`FavoriteItemsQuery` (gains `type?`), `FavoritePageScope`→
`FavoriteItemScope` (gains `type?`), `favoritePageId`/`parseFavoritePageId`→
`favoriteItemId`/`parseFavoriteItemId`.

**Ids are now prefixed** — `page:b:s:c:i`, `chapter:b:s:c`, `series:b:s` — and remain internal.
They're still derived from coordinates, still re-keyed by a reconcile, and still never appear in a
URL. Address items by coordinates everywhere.

**Gone with no replacement:** `LibraryList`, and `LibraryEntry.listIds`. Nothing on the entry
carries memberships any more — they live on the series favorite item (§4).

## 2. The store seam

`AsyncStorageLibraryStore` (`src/data/embedded/library-store.ts`) implements four favorites methods
plus the collections pair, and **deletes** `listLists` / `putList` / `deleteList` and their
documents:

```ts
listFavoriteItems(scope?: { bridgeId?; seriesId?; chapterId?; type? }): Promise<FavoriteItem[]>;
getFavoriteItem(id: string): Promise<FavoriteItem | undefined>;
putFavoriteItems(items: FavoriteItem[]): Promise<void>;
deleteFavoriteItems(ids: string[]): Promise<void>;
listFavoriteCollections(): Promise<FavoriteCollection[]>;
putFavoriteCollections(collections: FavoriteCollection[]): Promise<void>;
```

The three load-bearing requirements are unchanged, and still fail silently rather than loudly:

1. **Shard by series** — `comical:lib:favorite-items:{bridgeId}:{seriesId}` → `{ [id]: FavoriteItem }`.
   One layout covers all three types, because a series anchor lives in its own series' shard.
   Measured 64ms → 3.4ms per chapter open at 25k favorites as a single document.
2. **Honour `scope`** — filter before deserialising. Now including `type`.
3. **A batch call is ONE durable write** — a reconcile repairs a chapter through one
   `putFavoriteItems`.

Two migration specifics a rename pass misses:

- **A `chapterId`-scoped listing must exclude `type === 'series'` items** — they have no
  `chapterId`, so a naive predicate either crashes or returns them. Both reference stores handle
  this; copy them.
- **Wipe, don't migrate.** Ids changed prefix, so any `comical:lib:favorite-pages:*` records are
  invalid. Drop those keys. Old list documents and stray `listIds` on stored entries are abandoned
  in place and never read — that's the runtime's decision (no data migration anywhere), not ours to
  reopen.

Collections stay one document: `comical:lib:favorite-collections`. Everything still goes through
`serializeAsyncMethods`; `diskUsage()` still sums `comical:lib:*` for free.

**No lists carry-over — decided.** A one-time app-side migration (old lists document + each entry's
`listIds` → collections + series favorites) was considered and declined: collections start empty,
and Phase 0 drops the old keys **unread**. Don't build a migration later without asking; this was a
deliberate call, not an oversight.

## 3. Routes — the lists→collections repair

```
GET    /library/collections                          → FavoriteCollection[]
POST   /library/collections                          ← { name } → FavoriteCollection (201)
PATCH  /library/collections/{id}                     ← { name }
DELETE /library/collections/{id}
POST   /library/collections/reorder                  ← { orderedIds }
GET    /library?collection=&collections=&uncollected=
```

Shapes are identical to the lists routes they replace (`{id, name, order}`, `{orderedIds}`), so
`use-library-lists.ts`, `manage-lists.tsx` and `library-list-selector.tsx` port by changing paths,
names and labels. `/library`'s filter params rename `list`→`collection`, `lists`→`collections`,
`unlisted`→`uncollected`; `LibraryListFilter`'s `'unlisted'` sentinel becomes `'uncollected'`.

**Filing a series** replaces `PUT /library/entries/{b}/{s}/lists`, which is gone. It is now two
calls, and `use-entry-lists.ts` becomes `use-item-collections.ts` wrapping both:

1. `PUT /library/favorites/series/{b}/{s}` ← `{ seriesTitle, thumbnailUrl?, author? }` — idempotent;
   the entry already carries all three, and `list-picker.tsx` already threads a `snapshot` callback
   for exactly this.
2. `PUT /library/favorites/series/{b}/{s}/collections` ← the full membership array.

**Reading memberships** replaces `entry.listIds`:
`GET /library/favorites?type=series&series={b}:{s}` → `item.collectionIds` (empty result = unfiled).
Note the library *grid* doesn't need this — `?collection=` on `/library` does the join server-side,
so the filter path stays one query as it is today.

**Un-filing to zero is `DELETE /library/favorites/series/{b}/{s}`, not `collections: []`.** Sending
an empty array leaves a bare series anchor that lingers in favorites listings. Same rule for chapter
items. The runtime permits bare anchors as mechanism; the app's policy is that **a bare heart is a
page-only affordance** — series and chapters enter the system through "add to collection". Deleting
a collection prunes zero-membership series/chapter items server-side, so the UI never strips
members itself.

Chapter filing is the same pair with `chapter` in the path. Send `number` and `languageCode` on
chapter PUTs whenever available — they're the chapter's re-anchor identity (§6).

## 4. Routes — favorites (the page surface)

```
GET    /library/favorites?type=&sort=&dir=&collection=&series=&q=   → FavoriteItem[]
GET    /library/favorites/page/{b}/{s}/{c}/indices                  → number[]
POST   /library/favorites/page/{b}/{s}/{c}/reconcile                ← { pages: ChapterPageRef[] }
                                                                    → { indices, repaired, stale }
PUT    /library/favorites/page/{b}/{s}/{c}/{i}                      ← FavoritePageSnapshot → FavoritePageItem
DELETE /library/favorites/page/{b}/{s}/{c}/{i}
PUT    /library/favorites/page/{b}/{s}/{c}/{i}/collections          ← { collectionIds }
```

⚠️ **`type=page` is not optional on the grid.** Bare `GET /library/favorites` returns the **mixed
union**, so a page grid that omits it silently renders series and chapter items too. This is the
single easiest thing to get wrong in the whole migration.

Everything behavioural carries over untouched: **`PUT` merges** (supplied field wins as fresher,
omitted preserved; `favoritedAt`/`collectionIds` carry over; `stale` deliberately cleared on
re-favorite), reconcile's request/response shapes, indices-excludes-stale, `sort`/`dir` semantics,
`__direct__`, and 404-when-no-library-mounted.

`DataSource` gains a method per route, coordinate-addressed throughout. **`src/data/mock.ts` must
implement every one** — mock mode powers the `__DEV__` toggle, the GitHub Pages demo build and all
e2e flows.

`src/data/queries.ts`: `favoriteItems(mock, query)`, `chapterFavoriteIndices(mock, b, s, c)`,
`collections(mock)`, plus prefix key `favoriteItemsAll(mock) = ['favoriteItems', mock]` so one
toggle invalidates every scoped grid — the trick `libraryList(mock)` already uses. Both documents
are small and should persist; bump `PERSIST_BUSTER`.

## 5. The reader affordance

Unchanged in shape from the original plan; only names moved.

**Where.** A heart in the reader toolbar's trailing slot, left of the settings gear — one tap from
chrome the user has already revealed. Filled/outline via the existing `IconProps.filled` convention;
icon in `src/components/icons/reader-icons.tsx`. Chrome is deliberately unthemed white-on-dark —
match it, don't call `useTheme()`.

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

**The stitched multi-chapter case must be handled or favorites silently mis-file.**
`handleFlatPageChange` (~:3299) / `handleFlatVisiblePage` (~:3323) map a flat index to
`(segment, page)`; `visibleSeg` (~:3295) holds the crossing page. The `shown` memo (~:3334) already
resolves this for the bottom chrome — add a sibling returning `{ pageIndex, chapterId }` off the
same branch. Reading `target.chapterId` unconditionally is the trap: invisible until a favorite made
near a chapter boundary reopens on the wrong page.

**Hook.** `src/hooks/use-page-favorite.ts`, modelled on `use-favorite.ts`: derive
`favorited = indices.includes(pageIndex)`, optimistic patch, rollback, `onSettled` invalidate
`favoriteItemsAll(mock)`. `hapticSelection()` on toggle; `holdChrome()` (:971) on press.

**Mirror in the settings sheet** as a separate "This page" segment above `SeriesActionsRow`
(`settings-panel.tsx:194`). Long-press the heart opens the collection picker.

testIDs: `reader.toolbar.favorite-page`, `reader.settings.favorite-page`.

### `contentHash` — bytes we already hold

`Image.getCachePathAsync(cacheKey)` (expo-image SDK 56) returns the disk-cache path of an image, or
`null`. The reader renders with `cachePolicy="memory-disk"` (`reader-page.tsx:426`) and no explicit
`cacheKey`, so the key is the URI handed to `<Image>` — the `source` from `useImageProgress`, which
diverges from `resolvedUri` on web (see the note at `reader-page.tsx:318`). Read that file with
`expo-file-system`, hash with `crypto.subtle.digest('SHA-256', …)` — provided on Hermes by
`installWebCryptoShim()`, already installed at `startup.ts:119`. **No network request, no download
required.** Confirm the shim is installed in native-*remote* mode too; if not, omit the hash rather
than adding a polyfill.

Order of preference: any page the reader has displayed (`getCachePathAsync`) → downloaded pages
(blob store) → web (`image-progress.web.ts` already holds the bytes). A cache miss omits the hash;
sparse is expected, and reconcile adopts one later.

**Two-PUT pattern.** The shim's digest is JS, so SHA-256 over a ~1MB page is felt on Hermes.
Favorite on tap, then `PUT { seriesTitle, contentHash }` when the hash resolves — merge semantics
mean `chapterName`, `pageCount` and `sourceUrl` survive untouched. This is the runtime's recommended
flow and has an end-to-end router test.

## 6. What we don't get, and what we get free

**No stored bytes, no thumbnail endpoint.** Page tiles re-resolve their URL — **batch per chapter,
never per tile**. The grid needs the network, and a page favorite whose bridge is uninstalled or
whose source is dead has no image permanently; render a **text tile** from the
`seriesTitle`/`chapterName` snapshot rather than a blank. If it bites, the recorded answer is a
bounded LRU of downscaled tiles, not reinstating capture.

**Stale items are never deleted** and drop out of reported indices, so the reader must not highlight
or jump to one. They need a visible **"may no longer be available"** affordance — and that now
applies to **chapter items as well as pages**.

**Free from the server:** `syncChapters` (already run for library series) re-anchors chapter *and*
page favorites when a source re-uploads a chapter under a new id with the same
`(number, languageCode)`, marking unmatched ones stale. Two client consequences: ids and indices can
be re-keyed by a sync, so **refetch across sync events rather than caching** (already required,
since reconcile re-keys too); and stale can now appear on chapter items. Favorites on non-library
series get no drift detection at all — accepted, recorded in follow-ups §7.

## 7. Collections UI

The old lists UI, repointed and relabelled: `manage-lists.tsx` → `manage-collections.tsx`,
`list-picker.tsx` → `collection-picker.tsx`, `use-library-lists.ts` → `use-collections.ts`,
`use-entry-lists.ts` → `use-item-collections.ts` (now wrapping the anchor+memberships pair from §3).
Route `/manage-lists` → `/manage-collections` in `app/_layout.tsx`. Entry points that already exist
— the series card context menu, the card actions menu, `series-body.tsx`, the reader settings sheet
— keep their shape and change their labels.

**Mixed-type browsing is new.** `GET /library/favorites?collection={id}` returns the union: switch on
`type` and render each variant natively — series tiles from `thumbnailUrl`, chapter rows from
`seriesTitle`/`chapterName`, page tiles re-resolving the page URL. `sort=chapter` interleaves
sensibly (series lead their chapters, chapters lead their pages). This is the contract's stated
philosophy — presentation is the client's job — so don't try to normalise the union into one tile
shape.

## 8. The Library-tab browser

```ts
type LibraryView =
  | { kind: 'series'; collection: string | null | 'uncollected' }
  | { kind: 'favorites'; collection: string | null | 'uncollected'; type?: FavoriteItemType };
```

`LibraryListSelector` → `LibraryViewSelector`: the same title-as-dropdown, listing "Library" and
each collection, plus a second section for favorites and a "Manage collections…" action. The body
swaps `SeriesGrid` for `components/favorites/favorite-items-grid.tsx` when `kind === 'favorites'`.
Everything else on the screen — top bar, in-place search, the scroll-driven tab-bar slide,
`useScrollToTopOnReselect` — is untouched.

Sort is **`sort` + `dir` separately** (Added / Series / Chapter order + direction), plus
**Group by: None · Series · Date**, persisted under `comical:favoritesSort` following
`use-library-sort.ts`'s per-scope pattern. `scopeKey` must include view, type, sort, dir, grouping
and collection so recycled tiles reset on a switch.

**Sectioned rows.** Nothing in the repo does grouped lists; don't add a library. Precompute rows and
feed the existing `RecyclerList`:

```ts
type FavRow =
  | { type: 'header'; key: string; label: string; count: number }
  | { type: 'row'; key: string; items: FavoriteItem[] };
```

Fixed 2:3 page slots give both row types a computable height, keeping LegendList from re-measuring
mid-scroll. Page tiles reuse `PageThumb` (`components/series/chapters-section.tsx:1377`) with a new
explicit-source prop, since favorites resolve URLs from a per-chapter batch rather than `PageThumb`'s
own lazy fetch (that path is series-level — `getPageThumb` takes no `chapterId` — and would be wrong
here). Geometry from `use-grid-layout.ts`; `relTime()` for date headers.

The unscoped grid reads every shard (~5.5ms at 25k). Inherent; the recorded fix if it matters is
cursor paging on the list route.

## 9. Opening a favorite

- **Tap a page tile → the full-screen favorites viewer** (`src/app/favorite-page-viewer.tsx`, a
  `containedTransparentModal` like `series`): a pager over the currently filtered, currently sorted
  *page* items, so a swipe carries you between series. Reuse `zoomable-page.tsx` and
  `ReaderPageItem = { uri, key, pageNumber }`. Chrome: unfavorite, add-to-collection, "Open in
  reader". A stale item shows its snapshot and the unavailable affordance instead of an image.
- **Tap a series tile** → the series screen. **Tap a chapter row** → the reader at that chapter.
- **"Open in reader"** pushes the existing series modal — no new reader machinery:
  `router.push({ pathname: '/series', params: { id: seriesId, bridgeId, reader: '1', chapterId,
  start: String(pageIndex), title, cover } })`.

## 10. Phasing

**Phase 0 — unbreak the build. ✅ DONE.** Lists retired end to end: `/library/collections*` and the
`?collection=`/`?uncollected=` filter params, the six store methods (sharded per series, series-item
scope rule), `use-collections.ts` + `use-series-collections.ts` replacing the two lists hooks, and
`manage-collections.tsx` / `collection-picker.tsx` / `library-collection-selector.tsx` replacing
their lists counterparts. Mock implements the new seam with memberships in their own map, so a
series can be filed without being in the library. e2e flows and testIDs renamed
(`registries-lists` → `registries-collections`). typecheck / lint / lint:testids / 136 tests /
check:flow-coverage all green.

One UX judgement carried forward rather than decided silently: **filing a series still adds it to
the library first.** That used to be a technical requirement (the membership route needed an entry);
it isn't any more, since memberships hang off the favorite item. It's kept because "file it" has
always implied "keep it" here — but collections can now hold series that aren't in the library at
all, so this is worth a deliberate look. Un-filing never removes from the library.

**Phase 1 — favorites plumbing + the reader toggle.** `types.ts`, `library-store.ts` (four methods,
sharded, series-item scope rule), `api.ts`, `source.ts`, `mock.ts`, `queries.ts`, `query-client.ts`,
`use-page-favorite.ts`, `reader-icons.tsx`, `reader-toolbar.tsx`, `series/index.tsx`,
`settings-panel.tsx`.

**Phase 2 — the favorites browser.** `LibraryViewSelector`, `library.tsx`,
`components/favorites/favorite-items-grid.tsx`, `PageThumb`'s explicit-source prop, the per-chapter
URL batch, stale and text-tile states. `type=page` on the grid query.

**Phase 3 — the axes.** sort/dir plus grouping by series and date.

**Phase 4 — series/chapter filing and mixed browse.** Series and chapter favorite affordances,
mixed-union rendering in a collection.

**Phase 5 — the viewer.** `favorite-page-viewer.tsx` and its actions.

## 11. Verification

From `apps/mobile/`:

```
bun run typecheck        # the pin bump breaks this until Phase 0 lands
bun run lint
bun run lint:testids
bun test
bun run check:flow-coverage
```

`e2e/{mobile,web}/library.yaml` and `registries-lists.yaml` reference the lists UI and **will break
in Phase 0** — update them with the rename, and rename the flow if "lists" is in its name. New flows
for favorites in both `e2e/mobile/` and `e2e/web/` (check `e2e/README.md` for web-only
selector/gesture quirks first): series → read → reveal chrome → favorite → Library → switch to
favorites → assert the tile → tap → assert the page opens. Re-tap to reveal chrome between steps;
it auto-hides after 3s.

Manual: `bun run dev` alongside a `@comical/host-server` on :3100, plus mock mode. Five things worth
deliberately provoking, each hiding a bug this design can produce:

1. A favorite made **mid-chapter-crossing in stitched paged mode** reopens on the correct page.
2. The grid query **without `type=page`** — confirm the guard, since the failure is silent.
3. A **reconcile or a `syncChapters` run that re-keys ids** leaves grid and reader agreeing, with
   nothing holding a pre-sync id.
4. **Un-filing a series to zero collections** removes it from favorites listings (DELETE, not empty
   memberships).
5. A **stale** item — page *and* chapter — renders its affordance, stays out of the reader's
   indices, and survives restarts.

Finally, tick `todo.md`'s "Add 'page' favoriting mechanism" line.
