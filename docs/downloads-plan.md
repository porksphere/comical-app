# Downloads & Offline Functionality — Implementation Plan

## Context

Comical is a cross-platform (iOS/Android/web) comic reader (Expo SDK 56, RN 0.85, expo-router,
bun monorepo). Today every page is fetched live: the reader pulls a chapter's page list through
the swappable `Transport` (`getChapterPages`) and each page image is resolved lazily
(`resolveAssetSource`) and loaded via `expo-image` with a `memory-disk` cache. That disk cache is
opportunistic and OS-reclaimable — there is **no durable offline mode**, no way to pick what to keep,
no storage visibility, and no way to read with the network off.

We want first-class downloads: a UI to download series/chapters, the ability to **serve downloaded
pages instead of remote ones when offline**, **deletion** of downloads, a **unified Downloads
settings page** (total storage + a series → chapters → pages breakdown), and the ability to keep
downloading as a **background activity on iOS and Android**.

### Research finding — how to split the logic (porksphere/comical vs comical-app)

The core runtime (`@comical/*`) lives in the **separate** `porksphere/comical` repo (git submodule
at `external/comical`). Its established seam (see `@comical/library`): the **core owns portable
domain logic** — zod models (`packages/library/src/models.ts`), a persistence interface
(`LibraryStore`, `store.ts`), and a pure service (`Library`, `library.ts`) — while the **app owns
the platform implementation**: `apps/mobile/src/data/embedded/library-store.ts`
(`AsyncStorageLibraryStore implements LibraryStore`), injected at startup
(`EmbeddedRuntimeConfig.libraryStore` in `host-rn/install.ts` → `new Library(store)` → the reused
router mounts `/library*`).

**Downloads, however, are fundamentally platform-IO + OS-background work and need _no_ core change
to function:** page lists already come from the existing transport (`api.getChapterPages`), image
bytes are fetched app-side, durable storage is `expo-file-system`, and offline serving is a pure
intercept in the app's `resolveAssetSource`. **Recommendation (default taken):** implement the whole
feature **inside `comical-app`** (the repo we can push to) under `src/data/downloads/`, but
**shape the portable half to mirror `@comical/library`** — a `models.ts` (zod), a `DownloadStore`
interface, and a pure `Downloads` service — so it can later be promoted verbatim into a core
`@comical/downloads` package + `/downloads*` router routes without a rewrite. The genuinely
platform-bound pieces (filesystem blob store, queue worker, background task, UI, resolve intercept)
stay in the app permanently. No changes to `porksphere/comical` in this pass.

## Assumptions (defaults — the interactive question tool was unavailable; override if wrong)

1. **Split:** app-layer, core-shaped (above). No `porksphere/comical` changes now.
2. **Scope:** full feature in one plan, but phased so background execution (Phase 5) can be deferred.
3. **Screen placement:** a Settings **sub-page** (`src/app/downloads.tsx`, linked from a `CategoryRow`
   in the Settings tab) — matches the existing "manage bridges/registries/trackers" pattern and the
   "download settings page" wording. (Alternative: a 6th top-level tab.)
4. **Download unit:** the chapter (a series download = enqueue all its chapters). Direct/chapterless
   series use the existing `DIRECT_CHAPTER_ID = '__direct__'` sentinel.
5. **Defaults:** download over Wi-Fi only = ON; store under `Paths.document` (durable, not reclaimed).

## Data model (`src/data/downloads/models.ts` — zod, mirrors `@comical/library/models.ts`)

Keyed like the library: `entryKey(bridgeId, seriesId)` + `chapterId` + `pageIndex`.

- `DownloadedPage` — `{ index, sourceUrl, file (relative path under the store root), bytes,
  headers?, state: 'queued'|'downloading'|'complete'|'failed' }`. `sourceUrl` is the **raw**
  (unresolved) bridge imageUrl — see design note below.
- `DownloadedChapter` — `{ bridgeId, seriesId, chapterId, chapterName?, number?, languageCode?,
  pageCount, pages: DownloadedPage[], bytes, state, addedAt, completedAt? }`.
- `DownloadedSeries` — cached display snapshot (`title, thumbnailUrl?, author?` — reuse the existing
  `LibrarySnapshot` shape so it renders offline / survives bridge removal) + `chapters` roll-up +
  aggregate `bytes`.
- `StorageUsage` — derived totals `{ totalBytes, seriesCount, chapterCount, pageCount, bySeries[] }`
  for the settings screen.
- `DownloadJob` — a queue item `{ bridgeId, seriesId, chapterId, enqueuedAt }`.

## Architecture

```
src/data/downloads/
  models.ts          zod models above (core-shaped, promotable)
  store.ts           DownloadStore interface (manifest/index persistence seam)
  downloads.ts       Downloads service — pure: state transitions, storage math,
                     deletion cascade (returns blob keys to delete), offline lookup
                     "local file for (bridge,series,chapter,pageIndex)", tree for UI
  async-store.ts     AsyncStorageDownloadStore implements DownloadStore (comical:dl:*)
  blob-store.ts      FileSystemBlobStore — expo-file-system bytes under
                     Paths.document/comical-downloads/... (mirrors embedded/bundle-cache.ts)
  engine.ts          DownloadEngine — the queue worker (fetch → store → record)
  state.ts           Legend State persisted$ store for live progress in the UI
  index-cache.ts     in-memory sync index (bridge:series:chapter:page → file://) for
                     the resolveAssetSource intercept (must be synchronous-ish)
  background.ts      expo-task-manager task + expo-background-task registration (Phase 5)
```

### Design note (why we store raw sourceUrl + local file, and the page LIST)
Page imageURLs are often **server-relative / time-scoped lazy resolve-routes** — resolved CDN URLs
expire and embedded resolution needs the bridge runtime. So a download must persist the **fully
downloaded bytes on disk** plus a **manifest** (chapter → ordered pages → local file). When offline,
the reader's page-list query must fall back to the manifest, and `resolveAssetSource` must return the
local `file://` — never the raw URL. We key the offline lookup on `(bridgeId, seriesId, chapterId,
pageIndex)` (not the raw URL string, which can differ run-to-run).

## Implementation phases

### Phase 1 — Domain + storage foundation
- Add explicit dep **`expo-file-system`** to `apps/mobile/package.json` (currently only transitive;
  `embedded/bundle-cache.ts` already uses the `File`/`Directory`/`Paths` API — copy that idiom).
- Write `models.ts`, `store.ts`, `downloads.ts` (pure, unit-testable), `async-store.ts`
  (`comical:dl:entries`, `comical:dl:chapter:<key>`, etc., mirroring `library-store.ts` layout),
  `blob-store.ts` (root `Paths.document/comical-downloads`, path
  `<bridge>/<series>/<chapter>/<pageIndex>.<ext>`; sanitize ids like bundle-cache's `fileName`).
- Add a `downloads.test.ts` for the pure service (storage math + deletion cascade), matching the
  repo's existing `*.test.ts` convention (e.g. `data/grid-pages.test.ts`).

### Phase 2 — Download engine / queue
- `engine.ts`: single-flight worker draining `DownloadJob`s. Per chapter: call
  **`api.getChapterPages(bridgeId, seriesId, chapterId)`** (the `ApiPage[]` form — carries per-page
  `headers`; the `DataSource.getChapterPages` string[] projection drops them), then per page
  `resolveAssetSourceCached(imageUrl)` → fetch bytes (with `page.headers`) → `blobStore.write` →
  `downloads.recordPage(...)`. Respect Wi-Fi-only (gate via `expo-network` reachability), concurrency
  cap (~3), and cancellation. Update `state.ts` (Legend State) so UI shows live per-chapter progress.
- Retry/backoff + resumable: a `failed`/partial chapter re-enqueues only its missing pages.

### Phase 3 — Offline serving (read downloaded pages, network-off capable)
- **Image bytes:** in `data/api.ts` `resolveAssetSource`, before the remote/embedded branches,
  consult `index-cache.ts` for a local `file://` for the current page and return it if present. The
  reader already funnels every page through `resolveAssetSourceCached`, so this is the single choke
  point — `reader-page.tsx` / `warmPrefetch` need no change.
- **Page LIST offline fallback:** in `data/source.ts` `getChapterPages`/`getDirectPages` (or the
  `chapterPagesQuery`/`directPagesQuery` wrappers in `data/queries.ts`), if the chapter is fully
  downloaded, return the manifest's ordered page list (pointing at locals) instead of hitting the
  bridge; and on a bridge/network error for a downloaded chapter, fall back to the manifest. This is
  what lets a downloaded chapter open with the network fully off.

### Phase 4 — UI: triggers + unified Downloads screen
- **Triggers on the series screen:** add a per-chapter download control + a "Download all" action in
  `components/series/chapters-section.tsx` / `app/series.tsx`, showing queued/progress/complete/failed
  state from `state.ts`. Reuse existing row/action primitives.
- **Unified Downloads screen** `src/app/downloads.tsx` (Settings sub-page template =
  `app/settings-general.tsx`: `TopBar` + `ScrollView` + `SettingsSection` + `useSettingsScrollPadding`):
  - Header: **total storage used** + counts (`StorageUsage`).
  - Expandable **series → chapters → pages** breakdown with per-node size.
  - **Deletion:** swipe-to-delete per series/chapter (reuse `components/settings/swipeable-row.tsx`);
    "Delete all". Deletion goes through `Downloads.delete*` (cascades manifest) → `blobStore.remove`
    the returned keys → refresh `index-cache` + `state`.
  - Global settings: "Download over Wi-Fi only" toggle (`SettingsToggleRow`), background toggle.
- **Wiring:** register `<Stack.Screen name="downloads" .../>` in `app/_layout.tsx` (alongside
  `registries`/`custom-pages`); add a `CategoryRow title="Downloads" onPress={() =>
  router.push('/downloads')}` in `app/(tabs)/settings.tsx`.

### Phase 5 — Background execution (iOS + Android)
- Add **`expo-background-task`** + **`expo-task-manager`** deps; register a background task
  (`background.ts`) that drains the queue when granted OS time. Add the config-plugin entries to
  `apps/mobile/app.json` `plugins` (iOS `UIBackgroundModes` incl. `processing`/`fetch` + a
  BGTaskScheduler task id; Android permissions/WorkManager). Follow the existing local config-plugin
  pattern in `apps/mobile/plugins/*.js` if a custom plugin is needed.
- **Known constraint to surface:** iOS background execution is opportunistic/time-limited — true
  long-running downloads need a native `URLSession` background session, which is beyond
  `expo-background-task`'s periodic model. Realistic behavior: downloads run fully in the foreground
  and **resume/continue in short OS-granted background windows**; the queue is persisted so an
  interrupted download continues next launch/window. Android can additionally use a foreground
  service for longer runs if needed (follow-up).

## Key files
- Intercept for offline bytes: `apps/mobile/src/data/api.ts` → `resolveAssetSource` (~L148).
- Page fetch (with headers): `apps/mobile/src/data/api.ts` `getChapterPages` (`ApiPage[]`).
- Offline page-list fallback: `apps/mobile/src/data/source.ts` (`getChapterPages`/`getDirectPages`,
  ~L475), `apps/mobile/src/data/queries.ts` (`chapterPagesQuery`/`directPagesQuery`).
- Filesystem precedent: `apps/mobile/src/data/embedded/bundle-cache.ts`.
- Store/idiom precedents: `apps/mobile/src/data/embedded/library-store.ts`,
  `apps/mobile/src/lib/observable.ts` (`persisted$`), `apps/mobile/src/data/data-epoch.ts`.
- UI: `apps/mobile/src/app/series.tsx`, `components/series/chapters-section.tsx`,
  `app/settings-general.tsx` (screen template), `components/settings/swipeable-row.tsx`,
  `components/settings/settings-fields.tsx`, `app/(tabs)/settings.tsx`, `app/_layout.tsx`.
- Core patterns mirrored (read-only reference, NOT edited):
  `external/comical/packages/library/src/{models,store,library}.ts`,
  `external/comical/packages/host-rn/src/install.ts`.

## Verification
- **Unit:** `bun run --filter mobile typecheck`; run `downloads.test.ts` (service storage math +
  deletion cascade) via the repo's test runner.
- **End-to-end (device/sim via the repo's run/dev tooling):**
  1. Download a chapter → watch progress in the series UI and the Downloads screen; confirm files
     land under `Paths.document/comical-downloads` and total-storage/counts update.
  2. **Airplane mode** → open the downloaded chapter and confirm it renders fully (page list + every
     image) from local files, and a non-downloaded chapter fails as expected.
  3. Delete a chapter, then the series, then "Delete all" → storage drops to 0 and blob files are gone.
  4. Toggle "Wi-Fi only" on cellular → queue holds; on Wi-Fi → drains.
  5. (Phase 5) Start a multi-chapter download, background the app → confirm it resumes in a granted
     window and survives an app kill (queue persisted).
```
