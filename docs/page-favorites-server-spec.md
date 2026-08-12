# Page favorites — `comical` submodule change spec

**Audience:** a session working in **`porksphere/comical`** (this repo's `external/comical`
submodule, pinned at `dcad7d50`). The app-side half lives in `comical-app` and is specified in
`docs/page-favorites-plan.md`; this document is only the parts that must land in the runtime repo.

**Important:** the submodule is **not checked out** in the `comical-app` workspace where this spec
was written, so every path and signature below is stated from `comical-app`'s consumption of those
packages (its type-only re-exports, its `LibraryStore` implementation, and the routes its
`api.ts` calls). **Verify each against the real source before implementing** — treat mismatches as
this document being wrong, not the code.

## What is being added

A **favorited page**: a single page of a comic, saved independently of the library, identified by
coordinates rather than by any page id (bridges expose none). Plus **collections** — user-named
groupings a favorited page can be filed into, deliberately shaped like `LibraryList` so both sides
reuse the same patterns.

Consumers: the reader's favorite button, a Library-tab browser that filters/sorts by series and by
date, and a full-screen viewer.

## Naming

`favorites` in this codebase already means **bridge-account favorites** — the user's starred series
on the upstream source, served under `/bridges/{id}/favorites`, capability-gated on
`capabilities.includes('favorites')`. It is remote, per-series and unrelated to this feature.

Use **`favoritePage` / `favoritePages`** for everything here, and mount the routes under
`/library/favorite-pages` (the local-user-data namespace), never under `/bridges/...`.

## 1. Types — `@comical/library`

```ts
/** Sentinel already in use for chapterless series. */
export const DIRECT_CHAPTER_ID = '__direct__';

export type FavoritePage = {
  /** `${bridgeId}:${seriesId}:${chapterId}:${pageIndex}`, URL-encoded.
   *  DERIVED, not random: favoriting must be idempotent, and "is this page favorited"
   *  must be a keyed lookup rather than a scan. */
  id: string;
  bridgeId: string;
  seriesId: string;
  chapterId: string;        // DIRECT_CHAPTER_ID for chapterless series
  pageIndex: number;        // 0-based; indexes the chapter's page list
  favoritedAt: number;      // epoch ms — the date sort axis
  collectionIds: string[];  // [] = uncollected
  // Denormalised snapshot so a tile renders with the bridge uninstalled or the source down.
  // Same rationale as the existing library/history snapshots.
  seriesTitle: string;
  chapterName?: string;
  pageCount?: number;
  sourceUrl?: string;       // URL at capture time; debug/fallback only, expected to rot
  hasThumb?: boolean;       // a thumbnail blob was captured for this favorite
};

export type FavoriteCollection = { id: string; name: string; order: number };

export type FavoritePageCoord = {
  bridgeId: string; seriesId: string; chapterId: string; pageIndex: number;
};

export type FavoritePageSnapshot = {
  seriesTitle: string; chapterName?: string; pageCount?: number; sourceUrl?: string;
};

export type FavoritePagesQuery = {
  sort?: 'added' | 'oldest' | 'series' | 'chapter';   // default 'added' (newest first)
  collection?: string | 'uncollected';
  series?: string;   // `${bridgeId}:${seriesId}`
  q?: string;        // matches seriesTitle / chapterName
};
```

Mirror these into `comical-app`'s `src/data/types.ts` on that side; the app imports the canonical
ones type-only, as it already does for `LibraryEntryView` / `LibraryList` / `HistoryItem`.

## 2. `LibraryStore` interface additions

The store stays a typed document sink — **all logic belongs in the `Library` service**, matching
how library entries and lists are already split.

```ts
listFavoritePages(): Promise<FavoritePage[]>;
putFavoritePage(page: FavoritePage): Promise<void>;
deleteFavoritePage(id: string): Promise<void>;

listFavoriteCollections(): Promise<FavoriteCollection[]>;
putFavoriteCollections(collections: FavoriteCollection[]): Promise<void>;
```

Both implementations must be updated:

- **`FileLibraryStore`** (this repo) — two new documents alongside the existing ones.
- **`AsyncStorageLibraryStore`** (`comical-app`, `src/data/embedded/library-store.ts`) — keys
  `comical:lib:favorite-pages` (`{ [id]: FavoritePage }`) and `comical:lib:favorite-collections`
  (`FavoriteCollection[]`). Every method there is wrapped by `serializeAsyncMethods`, because
  concurrent read-modify-write on a shared document silently drops records — the new methods must
  go through the same wrapper. `diskUsage()` already sums `comical:lib:*`, so the app's Storage
  screen accounts for them with no extra work.

Filtering and sorting are the **service's** job, applied over `listFavoritePages()`, so both hosts
behave identically and the client stays dumb (this matches `/library?q=&sort=&list=`).

Deleting a collection must strip its id from every member's `collectionIds`. It must **not** delete
the favorites.

## 3. Router — `@comical/host-server`

```
GET    /library/favorite-pages?sort=&collection=&series=&q=      → FavoritePage[]
GET    /library/favorite-pages/chapter/{b}/{s}/{chapterId}       → number[]
PUT    /library/favorite-pages/{b}/{s}/{chapterId}/{pageIndex}   ← FavoritePageSnapshot
DELETE /library/favorite-pages/{b}/{s}/{chapterId}/{pageIndex}
PUT    /library/favorite-pages/{id}/collections                  ← { collectionIds: string[] }
GET    /library/favorite-pages/{id}/thumb                        → image bytes
GET    /library/favorite-pages/collections                       → FavoriteCollection[]
POST   /library/favorite-pages/collections                       ← { name } → FavoriteCollection
PATCH  /library/favorite-pages/collections/{id}                  ← { name }
DELETE /library/favorite-pages/collections/{id}
POST   /library/favorite-pages/collections/reorder               ← { ids: string[] }
```

Notes that matter:

- **`GET .../chapter/{b}/{s}/{chapterId}` returns the favorited page *indices* for one chapter.**
  This exists so the reader can flip pages with zero per-page requests and keep the button correct
  while scrubbing. Do not replace it with a per-page status check — that is the shape `isFavorite`
  uses for series, and it would fire a request per page turn.
- `PUT` is **idempotent** — the id is derived from the coordinates, so re-favoriting the same page
  overwrites rather than duplicating. `PUT` is also where thumbnail capture is triggered (§4).
- Route ordering: `/library/favorite-pages/chapter/...` and
  `/library/favorite-pages/collections` must be matched **before** any
  `/library/favorite-pages/{id}/...` pattern, or `chapter` and `collections` will be parsed as ids.
- Follow the existing library routes' "no library store mounted" behaviour: the app treats a
  `null`/404 from the list route as "this server has no library" and renders a dedicated state, so
  keep that response shape consistent rather than erroring.
- The `{chapterId}` path segment carries `__direct__` for chapterless series; it is URL-encoded
  like every other id segment.

## 4. Thumbnail capture — a `covers`-shaped subsystem

**Why this is required, not optional.** The existing per-page thumbnail endpoint is
`GET /bridges/{id}/series/{seriesId}/page-thumb/{pageIndex}` — **series-level, with no chapter
component**. For a chaptered series there is no way to ask a bridge for "a thumbnail of page N of
chapter C". A favorites grid built on it would be blank for most content. The app also keeps that
query out of its persisted cache, so nothing survives a restart.

Model the solution on the **guaranteed-offline library covers** subsystem that already exists. The
app wires it in `src/data/embedded/startup.ts` as:

```ts
covers: { blobs: expoCoversBlobStore, fetchPage: devicePageFetcher },
```

with the device blob store in `src/data/embedded/covers-store.ts` (an `expo-file-system`-backed
`BlobStore` **with `read`**, rooted at `comical-covers`), and the library service serving the bytes
back at `/library/entries/:b/:s/cover` through the in-process transport.

Add the same shape for favorites:

- Service config gains `favoritePages?: { blobs: BlobStore; fetchPage: PageFetcher }`.
- On `PUT` of a favorite, resolve the page's image and write its bytes under a path keyed by the
  favorite's id; set `hasThumb: true` on success. Capture is **best-effort** — a failure must not
  fail the favorite; the client falls back to re-resolving the page URL.
- Serve at `GET /library/favorite-pages/{id}/thumb`, exactly as covers are served.
- On delete (of a favorite, or as part of a bulk clear), remove the blob.
- App side supplies `expoFavoriteThumbsBlobStore` from a new
  `src/data/embedded/favorite-thumbs-store.ts` rooted at `comical-favorites` — a near-copy of
  `covers-store.ts` — and the remote host uses its own file-backed store.

**Size caveat, stated plainly:** cover capture stores the fetched bytes as-is, and there is no
image-manipulation dependency on the app side (`expo-image-manipulator` is not installed), so v1
favorites store a full page image per favorite. That is acceptable for a first cut but should be
called out in the PR, with downscaling on capture as the follow-up if favorites grow.

## 5. Definition of done

- `FavoritePage` / `FavoriteCollection` exported from `@comical/library`, with the service logic
  (filter, sort, collection membership, cascade-on-delete) covered by unit tests.
- Both stores implement the new methods; `FileLibraryStore` round-trips through a real temp dir.
- Router routes mounted, ordered correctly, with tests for the chapter-indices route, `PUT`
  idempotency, and the collections CRUD + reorder.
- Thumbnail capture wired behind the optional `favoritePages` config, degrading cleanly when it is
  absent (`hasThumb` stays false, nothing throws).
- The `comical-app` side then bumps the submodule pin and implements Phases 1+ of
  `docs/page-favorites-plan.md`.

## 6. Coordination

`comical-app`'s branch for this work is `claude/page-favoriting-feature-yev9l6`. Its app-side
phases assume these routes exist; until the pin moves, that half typechecks but every favorites
route 404s. Land this spec's changes first, or land the app half behind the "no library store
mounted" empty state that the library routes already model.
