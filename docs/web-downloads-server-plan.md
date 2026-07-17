# Server-side downloads for web clients

## Goal

Let **web** comical-app clients "download" chapters: the client coordinates, the **host server** fetches
the page bytes, stores them, and serves them back. Reading a downloaded chapter on web then loads pages
from the server (fast, no re-scrape, survives the source bridge dying/removing the series) instead of
hitting the bridge live.

**Scope note — this is server-side caching, NOT device offline.** The web browser always needs to reach
the server to read a "downloaded" chapter; it does *not* work with the laptop's own network off. True
browser-offline (airplane mode) would require browser-side blob storage (IndexedDB/Cache/Service Worker
+ quota/eviction handling) and is explicitly out of scope here. Native clients keep managing their own
bytes on-device (real airplane-mode offline) and are **untouched** by this work.

Byte ownership follows platform capability:
- **Native client** → engine + blobs on-device (as today). True offline.
- **Web client** → server owns the engine + blobs; client enqueues, polls progress, reads from server.

## Why this is cheap and low-risk (what already exists)

- **Byte fetching already works server-side.** `host-server` has `/img-proxy` and the per-page
  `page-image` resolver: `proxyFetch(url, referer) → arrayBuffer → Response`, with referer/allowlist
  handling. The server is the scraper, so there's **no CORS problem**. The hard capability is done.
- **The manifest is complete.** `enqueueChapter` already stores the full page list
  (`pages: [{ index, sourceUrl, headers }]`), and `getManifestPages` / `recordPage` /
  `pendingChapters` / the delete routes (which return blob file paths) all exist. Today the router
  "moves manifest only" — the **client** fetches bytes, writes the blob, and POSTs `recordPage`.
- **On web today, no engine runs** (`startup.web.ts` is a no-op), so web enqueues but nothing ever
  downloads. The server worker completes that loop.

## Isolation (why it's un-cursed, ~3/10)

`server.ts` already constructs the `Downloads` service, then `createRouter`, then
`Bun.serve({ fetch: router.fetch })`. `router` is a mutable Hono app instance, so **everything bolts on
in `server.ts`**: construct a Node blob store + the worker with the *same* `Downloads` instance
(in-process, no HTTP), and attach a blob-serve route to `router` before `Bun.serve`.

- The app's **embedded runtime uses `createRouter` directly, not `server.ts`** → it never runs the
  worker. So: **no submodule bump, no native-engine change, no core-router edit, no native regression
  surface.** Purely a `host-server`/`server.ts` concern (shipped via comical-web) + a small client
  read-path in comical-app.
- Repos touched: **comical** (`host-server`), **comical-app** (`source.ts` client read + progress),
  **comical-web** (redeploy — it already runs `host-server`).

## Work breakdown

### comical / `packages/host-server`

1. **Node blob store** (new module, e.g. `src/downloads-blobs.ts`)
   `write(relPath, bytes)`, `readFile(relPath) → stream/bytes`, `delete(relPath)`, `size()`, under
   `{dataDir}/downloads/blobs/<bridge>/<series>/<chapter>/<index>.<ext>`. Mirrors the app's `blob-store`
   but Node `fs`. Store/track the content-type (from the fetch response, or infer from extension) for
   serving.

2. **Download worker** (new module + wired in `server.ts`)
   A background loop in the server process holding the same `Downloads` instance:
   - poll `pendingChapters()` every few seconds (single-flight guarded — no callback threading needed);
   - for each pending chapter, for each not-complete page: **fetch its stored `sourceUrl` resolved
     against the server's own origin** (routes through the existing `/img-proxy`/`page-image`
     resolution → bytes; referer handled for free — "self-HTTP"), write the blob, call
     `downloads.recordPage(key, chapterId, index, relPath, bytes)`;
   - concurrency cap + retry (mirror the native engine's shape); honor prefs;
   - **GC sweep**: periodically unlink any blob on disk with no manifest entry (decouples deletion from
     the delete routes and self-heals orphans).
   Re-fetching re-resolves, so time-scoped/expiring resolve routes are fine for a prompt worker (same
   limitation the native engine already lives with).

3. **Blob-serve route** (attached to `router` in `server.ts`)
   `GET /dl-blob/:bridgeId/:seriesId/:chapterId/:index` → stream the stored file with its image
   content-type. **PUBLIC route (NOT under `/downloads/*`)** — `/downloads/*` is `Bearer`-guarded and
   `<img src>` can't send a header. Follows the existing **`/img-proxy` public-route precedent**. (The
   real deploy is token-less at the server — auth is at the Cloudflare Access edge — which is also why
   guarded `page-image` `<img>`s work today; public is still the safe choice.)

4. **Tests** — `host-server` integration pattern (`Bun.serve({ port: 0 })`): enqueue → worker downloads
   → blob-serve returns bytes → delete → GC removes the file. Plus an absence test (no worker/blob store
   → behaves as today).

### comical-app / `apps/mobile/src/data/source.ts`

5. **Web read path.** For a downloaded chapter on web, return the server's `/dl-blob/…` URLs instead of
   re-scraping. Detect "downloaded" via the server manifest (`getManifestPages`) rather than the
   app-side `index-cache` (empty on web). Either one extra manifest check per chapter open on web, or
   plumb the download state down from the series page (design choice).

6. **Progress polling.** While a chapter is pending, the web client polls the downloads query
   (`refetchInterval`) so the progress bar advances as the server works (the server updates server-side
   with no push).

### comical-web
7. **Redeploy** (already runs `host-server`; the worker/blob store/route come with it once `server.ts`
   constructs them). Enable via the existing `downloads: true` server option.

## Design decision: who downloads when a server serves BOTH web and native clients

A native client runs its own engine (local blobs); the server worker would double-download the same
queue. Options:
- **Server config** — "this server manages downloads" (simplest for a web-only server), or
- **`serverManaged` flag on enqueue** — web sets it, native doesn't; the worker only drains flagged
  chapters (lets both coexist cleanly).

Recommendation: **start with the flag** so a single server can serve both. For the immediate
single-owner deploy, "enable the worker; native keeps owning its own bytes" also works.

## Gotchas (all shallow) — recap

1. **`<img>` auth** → public blob-serve route (`/img-proxy` precedent). The only one to get right.
2. **Byte-fetch referer/allowlist** → self-HTTP through the existing proxy; no re-implementation.
3. **Expiring resolve URLs** → manifest stores the resolve route, so re-fetch re-resolves. Fine.
4. **Kicking the worker** → poll (no callback threading through the core router).
5. **Deletion** → GC sweep, not a delete-route hook.
6. **Single-tenant manifest** → fine for the single-owner deploy; multi-user would need scoping (later).

## Effort

~**5–6 focused days** including host-server integration tests. Additive; no native regression surface.

## Execution order

1. **host-server**: Node blob store → worker (drain + GC) → public blob-serve route → tests. Commit.
2. **comical-app** `source.ts`: web read path → progress polling. Commit.
3. **comical-web**: redeploy; verify web enqueue → server downloads → web reads from server.

## Relationship to the bigger "unified engine via HostCapabilities" idea

This plan **duplicates ~350 lines of engine logic** in the server worker (separate from the native
engine we've heavily debugged). The "correct" north-star is instead a single capability-driven engine in
a host-adjacent shared package that both the device (native storage capability) and the server (Node
storage capability) run — no duplication, native niceties preserved. That's more upfront work + a
refactor of the working native path, and it does **not** remove the web client↔server coordination (the
worker/serve/read-path here is needed either way). If web downloads become a committed first-class goal,
promote this worker into that shared engine (extract engine → native app proves it with zero behavior
change → server host reuses it). For now, this pragmatic server-worker ships the goal cheaply; leave the
engine seam shaped so it can be promoted later.
