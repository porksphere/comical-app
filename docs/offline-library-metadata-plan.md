# Offline library metadata — design

## Goal

A library entry should be fully readable with no source access: the **series details page opens
offline** (embedded native with the network off; remote clients against a host-server whose upstream
source is unreachable — "LAN-only"), showing saved metadata and the chapter list, with **downloaded /
not-downloaded state indicated per chapter**, and downloaded chapters actually openable. Today the
series page errors out (`series.tsx` renders a full-page `RetryBlock` the moment
`seriesDetailQuery` fails) before the reader's existing offline machinery (`index-cache`) ever gets a
chance.

## Guiding observation: the data is already in hand

Nothing here requires new source traffic. Three places already *hold* the metadata and drop it:

- `ComicalRuntime.addToLibrary` (`packages/runtime/src/runtime.ts`) already calls
  `bridge.getSeriesDetails()` to get externalIds — the full `SeriesInfo` is fetched and discarded.
- `Library.syncChapters(key, chapters)` (`packages/library/src/library.ts:217`) already receives the
  **full `Chapter[]`** on every sync/visit but persists only the slim `KnownChapter
  {id, number, languageCode}` projection used for unread counts.
- The router's `GET /bridges/:id/series/:seriesId` and `.../chapters` handlers stream fresh bridge
  results to clients on every visit and keep nothing.

The design is: **keep what flows past, serve it back when the bridge can't.**

## Core: a metadata cache inside `@comical/library`

Not a new package — the cache's lifecycle is exactly the entry's (created on add, refreshed on
sync/browse, deleted on remove), every host already wires a `LibraryStore`, and this matches the
existing model split (entry beside chapters beside progress).

**Models (`packages/library/src/models.ts`)** — zod, contract shapes:

```ts
/** The full series detail captured for offline rendering. */
export const cachedSeriesDetailSchema = z.object({
  info: seriesInfoSchema,          // from @comical/contract
  cachedAt: z.number().int(),
});

/** The full renderable chapter list (beside the entry — bulky, own doc). */
export const cachedChaptersSchema = z.object({
  chapters: z.array(chapterSchema), // from @comical/contract
  cachedAt: z.number().int(),
});
```

**`LibraryStore` seam additions** (implemented by `InMemoryLibraryStore`, host-server
`FileLibraryStore`, app `AsyncStorageLibraryStore`):

```ts
getSeriesDetail(key): Promise<CachedSeriesDetail | undefined>;
putSeriesDetail(key, detail): Promise<void>;
deleteSeriesDetail(key): Promise<void>;
getCachedChapters(key): Promise<CachedChapters | undefined>;
putCachedChapters(key, doc): Promise<void>;
deleteCachedChapters(key): Promise<void>;
```

File layout (server): `{dir}/details/{encoded-key}.json`, `{dir}/chapters-cache/{encoded-key}.json`.
AsyncStorage keys (app): `comical:lib:detail:<key>`, `comical:lib:chapters:<key>` — one doc per
entry, same scale as the downloads pages docs. Validate with zod on read; an invalid/drifted doc is
discarded (falls back to live).

**`Library` service methods:**

- `cacheSeriesDetail(key, info: SeriesInfo)` — no-op unless the series is in the library.
- `getCachedDetail(key)` / `getCachedChapters(key)`.
- `syncChapters(key, chapters)` **also** writes the full list through to `putCachedChapters` — one
  existing call now produces both artifacts (unread reconciliation + offline chapter list). No new
  bridge traffic anywhere.
- `removeSeries` cascade deletes both docs.

## Capture points (writes)

1. **`addToLibrary`** (runtime): always capture — use the `SeriesInfo` it already fetches (fetch it
   even when the caller supplied a title snapshot; it's one call at add time) → `cacheSeriesDetail`.
   Also seed the chapter list: best-effort `bridge.getChapters()` → `syncChapters`, so an entry is
   offline-complete from the moment it's added rather than after the first background sync. (One
   added bridge call per library-add; swallowed on failure.)
2. **Write-through on browse** (router): after a *successful* bridge call in
   `GET /bridges/:id/series/:seriesId` and `.../chapters`, if `opts.library` has the entry,
   fire-and-forget `cacheSeriesDetail` / `syncChapters`. The cache stays exactly as fresh as the
   user's own browsing, at zero cost. Because the same router runs embedded and on the server, both
   hosts capture identically.
3. **`backgroundSync`** (runtime): already pulls fresh chapters per entry — with (syncChapters
   write-through) it now refreshes the offline chapter list for free. Series *details* are not
   re-fetched in background (they rarely change; browse write-through covers them).

## Serving (reads): router-level offline fallback

The two content routes get a fallback when `opts.library` is present:

```
GET /bridges/:id/series/:seriesId    → try bridge; on ANY failure (bridge call threw, bridge
GET /bridges/:id/series/:sid/chapters   missing/uninstalled, missing required settings) →
                                        if the library has a cached doc for (id, seriesId),
                                        return it with additive fields { cached: true, cachedAt };
                                        else the original error.
```

- **Why router-level, not app-level:** one implementation serves every client — embedded native
  offline AND web/native pointed at a LAN-only server — with no duplicated fallback logic (the
  downloads `index-cache` client-side pattern would have to be rebuilt per platform and wouldn't help
  remote clients at all). It also means the app's data layer needs **zero changes** for the happy
  path: `seriesDetailQuery` just starts succeeding offline.
- The bridge-missing case matters: `withContentBridge` 404s before the handler runs today, so these
  two routes restructure to attempt the cache when the bridge itself can't be resolved — a library
  entry must render even after its bridge was uninstalled (the `LibraryEntry` snapshot already
  promises this for the grid; this extends it to the detail page).
- `cached`/`cachedAt` are additive response fields — contract-safe; live responses are unchanged.

## App UI

### Series page, offline

- With the router fallback, the detail query succeeds offline for library entries — the
  `RetryBlock` path simply stops triggering for them. Non-library series offline keep today's error.
- When the payload carries `cached: true`, show a slim, non-blocking banner under the top bar:
  *"Offline — showing saved details"* (with a relative `cachedAt`, e.g. "updated 2 days ago").
- Cover: the app's image cache (expo-image disk cache / server img-proxy) already retains covers in
  practice; the entry's `thumbnailUrl` snapshot renders the header. **Guaranteed** offline cover
  bytes (a `BlobStore`-backed cover cache, one small image per entry, both hosts) is a scoped
  follow-up, not v1.

### Downloaded-state indicators (per chapter)

- **Data source: nothing new.** The series page already fetches
  `queryKeys.seriesDownloads(bridgeId, seriesId)` for the Download button, and it's live-patched
  page-by-page by the download events pipe (`events.ts`). Per-chapter state is a `Map` lookup by
  `chapterId` from that same query.
- **`ChapterRow`** (`components/series/chapters-section.tsx`) gains a trailing state glyph:
  - `complete` → small filled check/down-arrow circle in the theme accent,
  - `downloading` → the existing mini progress radial (`DownloadStateVisual`), advancing live,
  - `paused` / `failed` → matching glyphs (tap → Downloads screen focused on this series),
  - not downloaded → nothing (clean rows stay clean).
  Chapter rows group scanlation versions; the row shows the *best* state across its versions
  (any complete → complete; else any downloading → downloading; …), per-version detail lives in the
  existing version popover.
- **Offline affordance:** when rendering from cache (`cached: true`), non-downloaded chapters dim
  and disable their press (they can't be read); downloaded chapters render normally and open through
  the reader's existing `index-cache` hot path, which already works offline.
- Direct (chapterless) series: the series-level Download button already covers state; the reader
  falls back through the existing direct-id path.

## What this deliberately does not do

- No new endpoints, no background metadata crawler, no re-fetching cadence — freshness rides
  entirely on adds, browsing, and the existing chapter background sync.
- No cover-byte store in v1 (follow-up above).
- No per-chapter *download action* from the series page (indicators only, per the requirement);
  a long-press → "Download chapter" affordance is a natural later addition on the same data.

## Implementation order

1. **comical / library**: models + `LibraryStore` seam + service methods + `InMemoryLibraryStore` +
   `FileLibraryStore` + `syncChapters` write-through + `removeSeries` cascade. Tests: cache lifecycle,
   zod-invalid doc discarded, cascade.
2. **comical / runtime**: `addToLibrary` capture (details + chapter seed). Tests over fixture bridge.
3. **comical / host-server router**: browse write-through + offline fallback on the two routes
   (including bridge-missing). Tests: fixture backend stopped → cached responses with `cached: true`;
   absence tests (no library → behavior unchanged).
4. **comical-app**: `AsyncStorageLibraryStore` methods; submodule bump.
5. **comical-app UI**: offline banner, per-chapter indicators, offline dimming in
   `chapters-section.tsx`. Verify: web against a server whose fixture backend is stopped (LAN-only
   simulation); native embedded in airplane mode — library grid → series page → downloaded chapter →
   reader.

## Risks / gotchas

- **Chapter-list doc size**: thousand-chapter series produce a large JSON doc per entry in
  AsyncStorage — same order as the downloads pages docs; acceptable, but reads should stay lazy
  (only on series-page open / sync), never bulk-loaded at startup.
- **Route restructuring**: the two content routes currently rely on `withContentBridge`'s early
  400/404; the fallback must preserve those semantics exactly for non-library series (absence tests).
- **Staleness UX**: a cached chapter list can miss new chapters — the banner's `cachedAt` plus the
  existing background sync bound this; no extra mechanism in v1.
- **`cached` flag through the app**: `seriesDetailQuery` caches the flagged payload in TanStack
  Query; when connectivity returns, the normal refetch/invalidation replaces it — the banner must
  derive from the payload, never from separate connectivity probes.
