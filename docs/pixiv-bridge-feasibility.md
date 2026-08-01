# Feasibility: Pixiv as an installable bridge

**Verdict: feasible, and mostly already designed for.** A Pixiv-shaped source (illustration
gallery, Referer-gated CDN, mixed content ratings, account-gated extras) hits almost nothing the
contract doesn't already model. The `direct-example` bridge is literally described as an
"illustration gallery concept" and is the right template.

There is exactly **one** area that needs a decision rather than just bridge-authoring: **initial
authentication**. Everything else is either already supported or a small, contained app-side
improvement.

This document covers what's already there, what needs care, and what would need platform changes —
with file references so the next person doesn't have to re-derive it.

---

## What Pixiv actually needs from a host

| Need | Why |
|---|---|
| `Referer: https://www.pixiv.net/` on every CDN image | `i.pximg.net` hotlink-protects; bare requests 403 |
| `Referer` on API calls too | `www.pixiv.net/ajax/*` verifies it |
| A flat page sequence per work | An artwork is 1–200 pages, no chapter structure |
| Per-item age rating | One source serves all-ages and R-18/R-18G side by side (`xRestrict` 0/1/2) |
| A session credential for R-18, bookmarks, follows | Anonymous access is limited to all-ages public content |
| Polite request pacing | Undocumented API, easy to get rate-limited |

---

## Already supported — no platform changes

### 1. Content shape: the `direct` capability

Pixiv artworks are chapterless works read as a flat page list. That's exactly the `direct`
capability: implement `getSeriesDetails` + `getSeriesPages` and leave `getChapters`/
`getChapterPages` as `BridgeBase` stubs (`bridges/direct-example/src/index.ts`).

This is supported end-to-end in the app, not just in the contract — the series screen renders a
virtualized page-thumbnail list instead of a chapter list (`src/app/series.tsx:743`), the reader
omits chapter skip buttons (`src/components/reader/chapter-navigator.tsx:32`), and downloads model
it as a no-chapter-id branch (`src/data/downloads/constants.ts`).

### 2. The Referer-gated CDN — the usual dealbreaker, already solved

`BridgeInfo.assetProxy` (`packages/contract/src/models.ts:771`) is precisely this problem:

```ts
assetProxy: { hosts: ["pximg.net"], referer: "https://www.pixiv.net/" }
```

The bridge then emits server-relative `/img-proxy?url=…` URLs instead of absolute CDN URLs. The
router derives its proxy allowlist **entirely** from loaded bridges' declarations and hardcodes no
hostnames (`packages/host-server/src/router.ts:193-270`), so this needs zero core changes. Host
matching is exact-or-parent-domain, so `pximg.net` covers `i.pximg.net` and `s.pximg.net`.

`Page.headers` also exists (`models.ts:325`) and is honored on the download path
(`src/data/downloads/fetch-page.ts:45`) — see the caveat below about the reader.

### 3. Mixed content ratings

The `content-rating` capability + `contentRating: "everyone" | "mature" | "adult"` per entry maps
cleanly onto `xRestrict` 0/1/2. Enforcement is entirely host-side: the host compares against the
user's per-bridge ceiling (`MAX_CONTENT_RATING_KEY`) and redacts over-limit entries itself
(`models.ts:645-660`). The bridge just has to fill the field honestly.

This is strictly better than the bridge-level `nsfw` boolean here — Pixiv is the canonical
mixed-rating source that a single flag can't express.

### 4. Rate limiting

`BridgeInfo.rateLimit` (`maxConcurrent` / `minIntervalMs`) is declared by the bridge and applied by
the runtime on every host — server, web, iOS, Android — with no per-host configuration
(`models.ts:751`). The limiter sits between the evaluator and the raw host network, so it can't be
bypassed.

### 5. Session cookies

The gated network keeps a per-bridge cookie jar and replays it per host, but explicitly **does not**
override a `Cookie` header the bridge set itself (`packages/core/src/net/gated-network.ts:33-37`).
So a bridge can seed `PHPSESSID` from a setting and it will be respected.

### 6. Secrets storage

`storage.secure` is a separate namespace backed by Keychain (iOS) / Keystore-backed encrypted prefs
(Android), and is *always present* — hosts without real secure storage alias it to the plain store,
so the bridge never branches on availability (`packages/contract/src/capabilities.ts:65-75`). Good
home for a rotating access token. `secret: true` on a string setting masks it in UIs and keeps it
out of the settings GET response (`router.ts:291`).

### 7. Search, tags, favorites

- Search → `getSearchResults` with `encodeCursor` over Pixiv's page-number pagination.
- Tags → `tagGroups`, and since Pixiv tags aren't a filterable id set, use `tagQueries` (a
  ready-to-run search string per tag) rather than `tagIds` (`models.ts:tagGroupSchema`).
- Bookmarks → the `favorites` capability, which is explicitly designed to be auth-gated and to
  throw a clear error when the credential is absent, leaving browsing anonymous
  (`packages/contract/src/bridge.ts:193-209`).

### 8. Distribution

Nothing needs to ship in the app. Bridges are downloaded, SHA-256-verified (plus Ed25519 when
signed), and cached from **user-added** registries at runtime. The project operates no central
registry and published builds ship with none. Registries can also be split by rating
(`publish --nsfw true|false`), so an all-ages and an R-18 registry can be separate opt-ins.

### 9. Sandbox

Pixiv's AJAX endpoints return JSON, so `this.fetchJson()` covers it; cheerio is bundled in the SDK
if any HTML scraping is needed. `URL`, `URLSearchParams`, `TextEncoder`, `atob`/`btoa` are all in
the sandbox globals (`packages/core/src/globals.ts`).

---

## Needs care

### Native image loading goes through base64 data URIs

This is the one real performance concern, and it's app-side, not contract-side.

On the embedded (on-device) transport, `resolveAssetSource` drives the in-process router for
server-relative URLs. If the route **redirects**, it resolves to the absolute `Location`; otherwise
it reads the bytes and hands back a `data:` URI (`src/data/api.ts:148-166`). `/img-proxy` proxies
bytes rather than redirecting — it has to, since the whole point is attaching a Referer — so on
iOS/Android every Pixiv page image becomes a base64 string in JS memory.

Pixiv originals are routinely 2–10 MB, and the reader prefetches ahead of the render window
(`src/app/reader.tsx:80`), so a long artwork could hold several multi-MB base64 strings at once.
On web/remote this is a non-issue — it's a real HTTP proxy with `Cache-Control: max-age=86400`.

Three mitigations, cheapest first:

1. **Bridge-side:** default to Pixiv's `regular` (1200px) variant rather than `original`, with an
   `enum` quality setting for users who want originals. Use the `square medium`/`small` variants for
   `Page.thumbnail`. This alone makes the problem mostly go away.
2. **Bridge-side:** implement `getPageThumbnail` so thumbnails resolve lazily per page instead of all
   upfront.
3. **App-side (recommended follow-up):** the reader currently renders `source={{ uri }}` and ignores
   `Page.headers` entirely (`src/components/reader/reader-page.tsx:249`), even though the download
   path already uses them. expo-image's source accepts `headers`, so plumbing `Page.headers` through
   to the reader would let a Pixiv bridge emit **absolute** `i.pximg.net` URLs with a Referer header
   on native and skip the proxy (and the base64 round-trip) completely. That's a small, contained
   change and it benefits every Referer-gated source, not just Pixiv.

### A bridge can't mix chaptered and chapterless series

`direct` is a **bridge-level** capability, and the client treats it that way everywhere —
`directOf(bridgeId)` (`src/hooks/use-bridges.ts:41`), `selected-bridge.ts:140`,
`use-cross-bridge-rails.ts:79`, `library-card.ts:20` all read it off the bridge's capability list and
pass the result down as a route param.

So you can't have `illust:123` be direct while `user:456` is chaptered inside one bridge. That
forces a mapping decision (below), or two separate bridges.

### Mapping decision

Three defensible mappings, and they're mutually exclusive per bridge:

| Mapping | Fits | Costs |
|---|---|---|
| **Artwork = direct series** | The reader. Matches `direct-example` exactly. Simplest. | Library fills with thousands of one-shot entries; `checkForUpdates` is meaningless (an artwork never gains pages) |
| **Artist = series, artwork = chapter** | The *library*. Following an artist becomes a library entry, new artwork becomes a new chapter, `checkForUpdates` and the Activity screen start working, `favorites` = followed users | An "artist" isn't a comic; chapter ordering is just reverse-chronological |
| **Pixiv series (`/ajax/series/{id}`) = series, episode = chapter** | Genuinely correct for Pixiv's own manga-series feature | Only covers a small slice of the site |

**Recommendation: two bridges, not one.** `pixiv` (artwork-as-direct-series) for browsing and
reading, and `pixiv-follows` (artist-as-series, chaptered) for the library/update-tracking use case.
They share almost all their code, the id namespaces stay clean, and each advertises an honest
capability set. Shipping the direct one first is the smaller, more obviously useful piece.

---

## The actual open question: authentication

Anonymous access gets all-ages public browsing, search, and rankings. Everything else — R-18,
bookmarks, follows — needs an account. Two routes:

### Option A — Web AJAX API + `PHPSESSID` cookie

User pastes their session cookie into a `secret: true` string setting; the bridge sends it as a
`Cookie` header, which the gated network preserves.

- ✅ Works today with **zero platform changes**.
- ✅ Unlocks R-18, bookmarks, follows.
- ❌ User has to pull it out of devtools.
- ❌ It's a full-account session credential, and it rotates/expires — so it's a recurring chore.

### Option B — App API (`app-api.pixiv.net`) + OAuth refresh token

Cleaner JSON, no cookie, long-lived refresh tokens. But the *initial* grant is the problem, and it
runs into three concrete gaps:

1. **The contract's PKCE is plain-only.** `oauth-callback`'s `{pkce}` placeholder is substituted with
   the code *verifier* directly as the challenge (`models.ts:596,611`; `router.ts:1413-1423`). Pixiv
   requires `code_challenge_method=S256`.
2. **Bridges have no browser-redirect OAuth flow at all.** `/trackers/:id/oauth-start` and
   `/oauth/callback` are tracker-only routes (`router.ts:1395,1445`). Bridges only get `oauth-pin`
   (paste a code) via `PUT /bridges/:id/settings`. Auto-refresh-on-401 is tracker-only too, and
   deliberately so — `RefreshableNetwork`'s header comment says trackers "unlike bridges, hold a
   refresh_token".
3. **The sandbox has no `crypto`** (`packages/core/src/globals.ts`) — no WebCrypto SHA-256, no
   CSPRNG. A bridge can't compute an S256 challenge itself without bundling pure-JS SHA-256 and
   settling for a `Math.random`-derived verifier.

And even with all three fixed, Pixiv's redirect target is `pixiv://account/login?code=…` — a custom
scheme the app can't claim, so a native flow means intercepting the redirect in a WebView.

### Recommendation

**Ship Option A first, structured so Option B is a drop-in later.**

Concretely: take a pasted credential as a `secret: true` string — either the `PHPSESSID` cookie, or
a refresh token the user obtains once via an external helper. Then have the bridge do its **own**
token refresh inside `initialize()` using `this.request()` and cache the access token in
`storage.secure`. This works today: the OAuth *refresh* grant needs only `client_id`/`client_secret`
and no PKCE at all — the S256 problem is exclusively an initial-login problem. So a bridge can hold
a long-lived credential and self-rotate without any platform change.

If it proves worth doing properly, the platform follow-up is three additive changes, in order of
value:

1. Plumb `Page.headers` into the reader's `<Image>` on native (helps every Referer-gated source, and
   fixes the data-URI memory issue).
2. Add `pkceMethod: "plain" | "S256"` to the OAuth setting descriptors (additive, defaults to
   current behavior).
3. Generalize the tracker `oauth-start`/`callback` routes and `RefreshableNetwork` to bridges.

None of those are prerequisites for a working bridge.

---

## Rough effort

| Piece | Effort |
|---|---|
| `pixiv` direct bridge — browse, search, artwork detail, pages, tags, ratings | ~400–600 lines, comparable to `example-bridge` (415) |
| Auth via pasted credential + self-refresh | small, inside the bridge |
| `favorites` (bookmarks) | small, once auth works |
| `pixiv-follows` chaptered bridge | mostly shared code |
| Reader `Page.headers` plumbing (optional, app-side) | small and contained |
| Anything else platform-side | **not required** |

---

## One non-technical note

Pixiv's terms of service prohibit automated/scraped access, and the app API's client credentials are
reverse-engineered rather than issued. The architecture already puts that decision with the user
rather than the project — no bridges ship in the app, registries are user-added, and trust is
established per-registry at add time. Worth stating plainly in any registry that hosts this, and
worth keeping the declared `rateLimit` conservative.
