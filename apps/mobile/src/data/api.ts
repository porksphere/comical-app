/**
 * Thin client for the real Comical backend API (`@comical/host-server` — the
 * same server the legacy web app talks to). Mirrors the reference's `k()`
 * fetch wrapper: `${BASE}${path}`, throw on non-2xx with the server's `error`
 * message, return parsed JSON.
 *
 * Base URL resolution order: a Settings-configured override (persisted, user-editable — see
 * `useApiBase`/`setApiBaseOverride` below) beats `EXPO_PUBLIC_COMICAL_SERVER` (inlined by Expo at
 * build time), which beats `DEFAULT_API_BASE` (`http://localhost:3100`, matching the sibling
 * `comical-web` dev server's default port). The Settings row that edits this is hidden while the
 * on-device embedded runtime is enabled, since this value is meaningless there.
 *
 * No credentialed cookies: unlike `comical-web` (reverse-proxied same-origin
 * with its backend in prod, so no CORS involved at all), this app is a
 * standalone client that's cross-origin from the API on every platform and
 * environment — dev, the GH Pages preview, and native. `host-server` defaults
 * to a wildcard CORS origin (`origin: "*"`), which browsers refuse to honor
 * for a `credentials: 'include'` request, so plain unauthenticated requests
 * are what actually works here. If per-user auth is needed later, use the
 * server's bearer-token support (`COMICAL_TOKEN` / `Authorization` header),
 * not cookies.
 *
 * This module returns shapes close to the server's contract. The `Api*` types
 * below are type-only re-exports of `@comical/contract` (imported straight
 * from the sibling `comical` repo via a `tsconfig.json` `paths` mapping — see
 * that file). Being type-only, they're erased entirely at build time: no
 * runtime dependency on the `comical` repo, no Metro config, no extra
 * package — the same tsconfig-paths trick `comical-web` already uses for
 * `@comical/host-server`. A local `comical` checkout next to this repo is
 * only needed for type-checking/editor support; its absence doesn't affect
 * runtime or CI. `source.ts` adapts these into the UI-facing types in
 * `types.ts` — this file has no knowledge of mock data or the UI shapes.
 */
import { use$ } from '@legendapp/state/react';

import { getResolvedModeSync } from './embedded/preference';
import type { Bridge, BridgeList } from './types';
import { logDiagnostic } from '@/lib/diagnostics';
import { migrateLegacyKey, persisted$ } from '@/lib/observable';

// JSON-owned key for the Legend State store; the old store wrote a bare URL string
// under `comical:remoteServerUrl`, which we migrate off of once (below).
const SERVER_KEY = 'comical:remoteServer';
const LEGACY_SERVER_KEY = 'comical:remoteServerUrl';

/** Default remote server when nothing else is configured. */
const DEFAULT_API_BASE = 'http://localhost:3100';

/**
 * Runtime-injected backend URL (web only). The static Docker image can't re-bake
 * `EXPO_PUBLIC_COMICAL_SERVER` (Metro inlines it at export time), so the container's entrypoint
 * writes `window.__COMICAL_SERVER__` into every page's <head> from its `COMICAL_SERVER` env var —
 * mirroring `comical-web`'s `window.COMICAL_SERVER` trick. Undefined on native and during static
 * prerender (no `window`), where the baked env / default apply instead.
 */
const RUNTIME_API_BASE: string | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { __COMICAL_SERVER__?: string }).__COMICAL_SERVER__
    : undefined;

/** The runtime-injected / build-time / default base, before any Settings override. */
const BUILT_IN_API_BASE = RUNTIME_API_BASE || process.env.EXPO_PUBLIC_COMICAL_SERVER || DEFAULT_API_BASE;

// The Settings server override, persisted as JSON. Wrapped in an object because a
// persisted *primitive* observable reads back as `{}` before anything is stored,
// whereas an object initial round-trips cleanly; `{ url: null }` means "no override".
type ServerOverride = { url: string | null };
const serverOverride$ = persisted$<ServerOverride>(SERVER_KEY, { url: null });

// Defensive read: the empty / pre-hydration state can surface as `{}` (no `url`),
// so treat a missing field as "no override".
function overrideUrl(): string | null {
  return (serverOverride$.peek() as Partial<ServerOverride>).url ?? null;
}

// One-time migration from the old bare-string key (a raw URL, not JSON). No-ops once a
// value has been set through the new store, so a stale legacy key never wins.
migrateLegacyKey(LEGACY_SERVER_KEY, serverOverride$, (rawUrl) => {
  if (overrideUrl() == null) serverOverride$.set({ url: rawUrl });
});

/** The current effective remote base URL — a Settings override if one is set, else the built-in
 *  (env var or `DEFAULT_API_BASE`). Read this instead of caching the value: it can change at
 *  runtime via the Settings screen. */
export function getApiBase(): string {
  return overrideUrl() ?? BUILT_IN_API_BASE;
}

/** Set (or, with `null`, clear) the user's remote-server override from the Settings screen.
 *  Persisted; trailing slashes are stripped so `${getApiBase()}${path}` never double-slashes.
 *  Callers are responsible for clearing any cached data that assumed the old server (see
 *  `settings.tsx`'s `queryClient.clear()` + `bumpDataEpoch()`). This store owns only the URL
 *  value — the query-cache side of a server switch stays with the caller, keeping the local
 *  preference and the TanStack Query cache cleanly separated. */
export function setApiBaseOverride(url: string | null): void {
  const trimmed = url?.trim().replace(/\/+$/, '') || null;
  serverOverride$.set({ url: trimmed });
}

/** `[effectiveUrl, setOverride]` for the Settings screen's remote-server row. */
export function useApiBase(): [string, (url: string | null) => void] {
  const url = (use$(serverOverride$) as Partial<ServerOverride>).url ?? null;
  return [url ?? BUILT_IN_API_BASE, setApiBaseOverride];
}

export type { Bridge, BridgeList };

/** Manual base64 (no `btoa`/`Buffer` — neither is guaranteed present across Hermes/JSC/QuickJS). */
function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : chars[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : chars[b2 & 0x3f];
  }
  return out;
}

async function responseToDataUri(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

/**
 * Resolves a bridge-supplied asset URL (a sprite sheet, a page image, …) into something an
 * `<Image>` can actually load. The contract documents these as "absolute or server-relative".
 *
 * - Already absolute → passed through unchanged.
 * - Server-relative, remote transport → prefixed with `getApiBase()`, a real network-reachable
 *   server for both the JSON and the follow-up image request.
 * - Server-relative, embedded transport → resolved through the *same in-process transport* that
 *   served the page/series data, not the shared remote server. This isn't just avoiding an extra
 *   hop: some of these routes redirect to (or proxy) a CDN URL that's scoped to whichever
 *   client/session negotiated it. Routing it through the remote server instead means *that*
 *   server's network identity ends up fetching a URL negotiated by *this device* — the CDN can
 *   reject that or hand back an error page, which downloads fine but fails to decode as an image
 *   (indistinguishable from a real network failure without inspecting the actual bytes). A
 *   redirect response resolves to its `Location` header, still a real absolute URL this device can
 *   fetch directly; anything else is read as bytes and handed back as a `data:` URI, since there's
 *   no second URL to hand `<Image>` for a route that proxies bytes rather than redirecting.
 */
export async function resolveAssetSource(url: string): Promise<string> {
  if (!url.startsWith('/')) return url;
  if (getResolvedModeSync() !== 'embedded') return `${getApiBase()}${url}`;
  try {
    const res = await transport(url);
    const location = res.headers.get('Location');
    if (location && res.status >= 300 && res.status < 400) return location;
    if (!res.ok) {
      // Error routes answer with a JSON `{ error }` body; surface it so the diagnostic shows the
      // bridge's real failure reason instead of a bare status (statusText is empty in-process).
      const detail = await res.text().catch(() => '');
      throw new Error(`${res.status} ${detail || res.statusText}`.trim());
    }
    return await responseToDataUri(res);
  } catch (e) {
    logDiagnostic('resolve-asset-embedded', (e as Error).message || String(e), { url });
    throw e;
  }
}

/**
 * Per-path memoized `resolveAssetSource`. The reader resolves a page's asset lazily as it scrolls
 * into the render window, and the warm-ahead prefetch resolves the same paths — dedupe so each path
 * costs a single resolve, not several (a resolve can be a rate-limited network round-trip for bridges
 * whose page URLs are lazy resolve-routes). A rejected resolve is evicted so a retry re-runs it;
 * `invalidateAssetSource` lets a caller bust a stale entry (e.g. an expired time-scoped CDN URL)
 * before retrying. Absolute URLs resolve synchronously inside `resolveAssetSource`, so caching them
 * is just a cheap identity map.
 */
const assetResolveCache = new Map<string, Promise<string>>();
export function resolveAssetSourceCached(url: string): Promise<string> {
  const hit = assetResolveCache.get(url);
  if (hit) return hit;
  const p = resolveAssetSource(url).catch((e) => {
    assetResolveCache.delete(url);
    throw e;
  });
  assetResolveCache.set(url, p);
  return p;
}

/** Drop a cached resolution so the next `resolveAssetSourceCached` re-runs it (retry after a stale/
 *  expired resolved URL fails to load). */
export function invalidateAssetSource(url: string): void {
  assetResolveCache.delete(url);
}

/**
 * The transport every helper in this module goes through. `path` is a server-relative path like
 * `/bridges/x/search?q=…`; the transport returns a `Response` exactly as `fetch` would.
 *
 * The default `remoteTransport` is a bare `fetch` against `getApiBase()` — behavior-identical to
 * how this file worked before. On iOS/Android an *embedded* transport (see `./embedded`) can be
 * installed with `setTransport()` to resolve the same paths against an on-device bridge runtime
 * (the reused `@comical/host-server` router driving proxy bridges in a native JS engine) instead
 * of hitting an external URI. Everything above this module — `source.ts`, react-query, screens —
 * is unchanged regardless of which transport is active, so remote↔embedded is a one-call swap.
 */
export type Transport = (path: string, init?: RequestInit) => Promise<Response>;

/** The default transport: plain HTTP against `getApiBase()`. */
export const remoteTransport: Transport = (path, init) => fetch(`${getApiBase()}${path}`, init);

let transport: Transport = remoteTransport;

/** Swap the active transport. Passing `null` restores the remote HTTP transport. */
export function setTransport(next: Transport | null): void {
  transport = next ?? remoteTransport;
}

/** True for an aborted-request error, so callers can ignore unmount cancels. */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Like `fetchJson`, but resolves `null` on a 404 instead of throwing — for endpoints that are
 *  only mounted when an optional server capability (trackers, registries) is enabled. Hono's
 *  default not-found response is plain text, not JSON, for routes that were never registered. */
async function fetchJsonOptional<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const res = await transport(path, { signal });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** GET /bridges → the installed bridges (id, display name, nsfw, capabilities, icon). */
export async function getBridges(signal?: AbortSignal): Promise<Bridge[]> {
  const raw = await fetchJson<{ info: Bridge & { iconUrl?: string } }[]>('/bridges', signal);
  return raw.map((b) => ({
    id: b.info.id,
    name: b.info.name,
    nsfw: b.info.nsfw ?? false,
    capabilities: b.info.capabilities ?? [],
    thumbnail: b.info.iconUrl,
  }));
}

/** One entry of the raw `GET /bridges` response — unlike `getBridges()` above (which discards
 *  everything but the browse-card fields), this keeps `configured`/`missingRequired`/`source`/
 *  `availableVersion` for the Settings screen's bridge rows (status badges, Uninstall visibility
 *  for `source === "registry"`), without an extra per-bridge fetch. */
export interface BridgeSummary {
  info: Bridge & { iconUrl?: string };
  configured: boolean;
  missingRequired: string[];
  source: 'local' | 'registry';
  availableVersion?: string;
  /** Installed but no longer offered by its registry (dropped from the index) — kept working from
   *  its pinned bundle. The Settings screen surfaces a "no longer offered" badge. */
  discontinued?: boolean;
}

/** GET /bridges → the raw per-bridge summaries (see `BridgeSummary`), for the Settings screen. */
export function getBridgeSummaries(signal?: AbortSignal): Promise<BridgeSummary[]> {
  return fetchJson('/bridges', signal);
}

/** GET /bridges/{id}/lists → the bridge's browse lists (home rails + pages). */
export function getBridgeLists(id: string, signal?: AbortSignal): Promise<BridgeList[]> {
  return fetchJson<BridgeList[]>(`/bridges/${encodeURIComponent(id)}/lists`, signal);
}

/**
 * Page-selector labels for a bridge, matching the reference's `i8`: "home"
 * first, then each page-list (lowercased name), then "favorites" if supported.
 *
 * `favoritesAvailable` gates the favorites page on the user actually being able to use it: a bridge
 * advertises the capability, but favorites need an account, so when the login isn't set (see
 * `useFavoritesAvailability`) the page is hidden rather than opening onto an auth error. Defaults true
 * so a caller that doesn't care about the gate gets the old behaviour.
 */
export function pageOptions(lists: BridgeList[], capabilities: string[], favoritesAvailable = true): string[] {
  const opts = ['home'];
  for (const l of lists) if (l.page && l.id !== 'home') opts.push(l.name.toLowerCase());
  if (capabilities.includes('favorites') && favoritesAvailable) opts.push('favorites');
  return opts;
}

// ─── @comical/contract shapes (type-only, erased at build — see header) ─────

import type {
  SeriesEntry as ApiSeriesEntry,
  TagGroup as ApiTagGroup,
  RelatedSeriesGroup as ApiRelatedGroup,
  SeriesInfo as ApiSeriesInfo,
  Chapter as ApiChapter,
  PageThumbnail as ApiPageThumbnail,
  Page as ApiPage,
  FilterIncludeExclude as ApiFilterIncludeExclude,
  FilterValue as ApiFilterValue,
  Filter as ApiFilter,
  SortOption as ApiSortOption,
  SortSelection as ApiSortSelection,
  Tag as ApiTag,
  PagedResults,
} from '@comical/contract';

export type {
  ApiSeriesEntry,
  ApiTagGroup,
  ApiRelatedGroup,
  ApiSeriesInfo,
  ApiChapter,
  ApiPageThumbnail,
  ApiPage,
  ApiFilterIncludeExclude,
  ApiFilterValue,
  ApiFilter,
  ApiSortOption,
  ApiSortSelection,
  ApiTag,
  PagedResults,
};

/**
 * Query options a bridge accepts on a list/search fetch — filters + sort, plus
 * an optional free-text `query` for the list endpoint's scoped-search case
 * (`GET /bridges/:id/lists/:listId?q=...`, used when the active list is
 * `searchable` instead of always hitting `/search`).
 */
export type QueryOptions = { query?: string; filters?: ApiFilterValue[]; sort?: ApiSortSelection };

function queryParamsFor(page: number, opts?: QueryOptions): URLSearchParams {
  const qs = new URLSearchParams({ page: String(page) });
  if (opts?.query) qs.set('q', opts.query);
  if (opts?.filters?.length) qs.set('filters', JSON.stringify(opts.filters));
  if (opts?.sort) {
    qs.set('sort', opts.sort.key);
    qs.set('dir', opts.sort.ascending ? 'asc' : 'desc');
  }
  return qs;
}

/** GET /bridges/{id}/lists/{listId} → one page of a browsable list's series. */
export function getSeriesListItems(
  bridgeId: string,
  listId: string,
  page: number,
  opts?: QueryOptions,
  signal?: AbortSignal,
): Promise<PagedResults<ApiSeriesEntry>> {
  const qs = queryParamsFor(page, opts);
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/lists/${encodeURIComponent(listId)}?${qs}`, signal);
}

/** GET /bridges/{id}/search → one page of search results for a free-text query. */
export function searchBridge(
  bridgeId: string,
  query: string,
  page: number,
  opts?: QueryOptions,
  signal?: AbortSignal,
): Promise<PagedResults<ApiSeriesEntry>> {
  const qs = queryParamsFor(page, opts);
  qs.set('q', query);
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/search?${qs}`, signal);
}

/** GET /bridges/{id}/filters → the filter controls this bridge advertises (capability "filters"). */
export function getFilters(bridgeId: string, signal?: AbortSignal): Promise<ApiFilter[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/filters`, signal);
}

/** GET /bridges/{id}/sort → the sort keys this bridge advertises (capability "sort"). */
export function getSortOptions(bridgeId: string, signal?: AbortSignal): Promise<ApiSortOption[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/sort`, signal);
}

/** GET /bridges/{id}/tags?q= → tags matching a query, for a tag-multiselect filter's live search. */
export function getTags(bridgeId: string, query: string, signal?: AbortSignal): Promise<ApiTag[]> {
  const qs = new URLSearchParams({ q: query });
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/tags?${qs}`, signal);
}

// ─── Favorites (capability "favorites") ──────────────────────────────────────

/** GET /bridges/{id}/favorites → one page of the user's favorited series. */
export function getFavorites(bridgeId: string, page: number, signal?: AbortSignal): Promise<PagedResults<ApiSeriesEntry>> {
  const qs = new URLSearchParams({ page: String(page) });
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/favorites?${qs}`, signal);
}

/** GET /bridges/{id}/favorites/{seriesId} → whether a series is currently favorited. */
export async function isFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetchJson<{ favorited: boolean }>(
    `/bridges/${encodeURIComponent(bridgeId)}/favorites/${encodeURIComponent(seriesId)}`,
    signal,
  );
  return res.favorited;
}

async function fetchOk(path: string, method: 'PUT' | 'DELETE', signal?: AbortSignal): Promise<void> {
  const res = await transport(path, { method, signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
}

/** PUT /bridges/{id}/favorites/{seriesId} → add a series to favorites. */
export function addFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/bridges/${encodeURIComponent(bridgeId)}/favorites/${encodeURIComponent(seriesId)}`, 'PUT', signal);
}

/** DELETE /bridges/{id}/favorites/{seriesId} → remove a series from favorites. */
export function removeFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/bridges/${encodeURIComponent(bridgeId)}/favorites/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** GET /bridges/{id}/series/{seriesId} → full series detail. */
export function getSeriesDetail(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiSeriesInfo> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/related → related-series rails for bridges that
 * advertise capability "related-series" and so omit `relatedSeriesGroups` from the main detail
 * response, providing it via this separate endpoint instead. Always safe to call: the server returns
 * `[]` immediately for bridges that don't implement it, with no upstream fetch. */
export function getRelatedSeries(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiRelatedGroup[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/related`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/chapters → the series' chapter list. */
export function getChapters(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiChapter[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/chapters`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/chapters/{chapterId}/pages → readable pages for one chapter. */
export function getChapterPages(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<ApiPage[]> {
  return fetchJson(
    `/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
    signal,
  );
}

/** GET /bridges/{id}/series/{seriesId}/pages → readable pages for a direct (chapterless) series. */
export function getSeriesPages(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ApiPage[]> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/pages`, signal);
}

/** GET /bridges/{id}/series/{seriesId}/page-thumb/{pageIndex} → lazy per-page thumbnail, for a
 * page a list/pages response didn't already carry `thumbnail` inline for. 404s ("not supported")
 * throw like any other error — callers should treat that as "no thumbnail available". */
export function getPageThumb(
  bridgeId: string,
  seriesId: string,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<ApiPageThumbnail> {
  return fetchJson(
    `/bridges/${encodeURIComponent(bridgeId)}/series/${encodeURIComponent(seriesId)}/page-thumb/${pageIndex}`,
    signal,
  );
}

// ─── Downloads (offline manifest) ───────────────────────────────────────────────
//
// These drive the optional `/downloads*` endpoints the reused router mounts when a Downloads service
// is present (on-device via host-rn's embedded runtime; on a remote server if it enables the module).
// The bytes are owned by whichever HOST runs the download engine: embedded mode writes them to this
// device's filesystem (`downloads/blob-store.ts`, served to `<Image>` as `file://` URIs), remote mode
// stores them server-side (served back via `/downloads/.../pages/:i/file`). Types are erased at build.

import type { DownloadedChapter, DownloadedPage, DownloadedSeries, DownloadPrefs, StorageUsage } from '@comical/downloads';

/** The body posted to enqueue a chapter: the series snapshot + chapter meta. `pages` is optional —
 *  an engine-backed host (embedded or a current server) resolves the page list via its own bridge;
 *  supplying it explicitly is the manifest-only back-compat path. */
export interface DlEnqueueChapterBody {
  title: string;
  thumbnailUrl?: string;
  author?: string;
  chapterName?: string;
  number?: number;
  languageCode?: string;
  pages?: { index: number; sourceUrl: string; headers?: Record<string, string> }[];
}

const dlBase = (bridgeId: string, seriesId: string) =>
  `/downloads/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`;

/** GET /downloads → the storage-usage tree (total bytes + series → chapters). */
export function dlStorageUsage(signal?: AbortSignal): Promise<StorageUsage> {
  return fetchJson('/downloads', signal);
}

/** GET /downloads/pending → chapters still needing bytes (the engine's work queue). */
export function dlPendingChapters(signal?: AbortSignal): Promise<DownloadedChapter[]> {
  return fetchJson('/downloads/pending', signal);
}

/** GET /downloads/prefs → download preferences (wifiOnly / background). */
export function dlGetPrefs(signal?: AbortSignal): Promise<DownloadPrefs> {
  return fetchJson('/downloads/prefs', signal);
}

/** PUT /downloads/prefs → update preferences (partial merge server-side). */
export function dlSetPrefs(prefs: Partial<DownloadPrefs>): Promise<DownloadPrefs> {
  return fetchPut('/downloads/prefs', prefs);
}

/** GET one series' manifest (snapshot + chapters), or null when nothing is downloaded for it. */
export function dlGetSeries(
  bridgeId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<{ series: DownloadedSeries; chapters: DownloadedChapter[] } | null> {
  return fetchJsonOptional(dlBase(bridgeId, seriesId), signal);
}

/** POST enqueue a chapter for download. */
export function dlEnqueueChapter(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  body: DlEnqueueChapterBody,
): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}`, body);
}

/** POST bulk-enqueue many chapters of one series in a single request. The host records the whole
 *  queue as instant manifest writes (page lists resolve lazily at download time), so a 300-chapter
 *  "download all" lands atomically — closing the app mid-request can no longer strand the tail. */
export function dlEnqueueChapters(
  bridgeId: string,
  seriesId: string,
  body: {
    title: string;
    thumbnailUrl?: string;
    author?: string;
    chapters: { chapterId: string; chapterName?: string; number?: number; languageCode?: string }[];
  },
): Promise<{ chapters: DownloadedChapter[] }> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters`, body);
}

/** POST record one downloaded page's on-disk file + byte size. */
export function dlRecordPage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  index: number,
  file: string,
  bytes: number,
): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages/${index}`, { file, bytes });
}

/** POST mark one page failed (the client gave up fetching it) — surfaces the chapter as failed. */
export function dlFailPage(bridgeId: string, seriesId: string, chapterId: string, index: number): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages/${index}/fail`, {});
}

/** GET the ordered manifest page list for a chapter (the offline page-LIST fallback). */
export function dlManifestPages(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<DownloadedPage[]> {
  return fetchJson(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pages`, signal);
}

/** POST re-queue the missing pages of a partial/failed chapter (resumable retry). */
export function dlRequeue(bridgeId: string, seriesId: string, chapterId: string): Promise<DownloadedPage[]> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/requeue`, {});
}

/** POST pause (cancel) a chapter — stops draining, keeps downloaded pages. */
export function dlPauseChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/pause`, {});
}

/** POST resume a paused chapter — back to queued. */
export function dlResumeChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<DownloadedChapter> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}/resume`, {});
}

/** POST pause (cancel) every not-yet-complete chapter of a series. */
export function dlPauseSeries(bridgeId: string, seriesId: string): Promise<{ ok: true }> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/pause`, {});
}

/** POST resume every paused chapter of a series. */
export function dlResumeSeries(bridgeId: string, seriesId: string): Promise<{ ok: true }> {
  return fetchPost(`${dlBase(bridgeId, seriesId)}/resume`, {});
}

/** DELETE one chapter → the blob `files` to remove. */
export function dlDeleteChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<{ files: string[] }> {
  return fetchDelete(`${dlBase(bridgeId, seriesId)}/chapters/${encodeURIComponent(chapterId)}`);
}

/** DELETE one series → the blob `files` to remove. */
export function dlDeleteSeries(bridgeId: string, seriesId: string): Promise<{ files: string[] }> {
  return fetchDelete(dlBase(bridgeId, seriesId));
}

/** DELETE everything → all blob `files` to remove. */
export function dlDeleteAll(): Promise<{ files: string[] }> {
  return fetchDelete('/downloads');
}

// ─── Settings + registries ────────────────────────────────────────────────────
//
// `SettingDescriptor`/`SettingOption`/`SettingValue` come from `@comical/contract` (see header).
// `RegistryBridgeEntry`/`RegistryTrackerEntry`/`SavedRegistry` come from `@comical/registry`, via
// a *second* type-only tsconfig mapping pointed at that package's `schema.ts` specifically (not
// its `index.ts`) — `index.ts` re-exports `manager.ts`/`manifest.ts`, which do real Node file I/O
// (`node:fs/promises`, `node:path`) to download/cache bridge bundles. There's no `@types/node`
// anywhere reachable from this app's TS program (confirmed empirically: pointing the mapping at
// `index.ts` breaks `tsc --noEmit` with "Cannot find name 'node:fs/promises'"), so `schema.ts`
// (pure zod-inferred data shapes, only depends on `zod`) is the only safe target. `AvailableBridge`/
// `AvailableTracker`/`InstallResult` — the three shapes `RegistryManager`'s browse/install/update
// methods return — live in `manager.ts` itself, not `schema.ts`, so they're hand-defined below
// instead of imported; they're tiny (3-4 fields) and just wrap the imported entry types.

import type { BridgeInfo as ApiBridgeInfo, SettingDescriptor, SettingOption, SettingValue } from '@comical/contract';
import type { RegistryBridgeEntry, RegistryTrackerEntry, SavedRegistry } from '@comical/registry';
// The local-library model — the user's own collection + reading progress, spanning every bridge.
// Type-only re-exports of `@comical/library` (mapped in tsconfig.json to the sibling package's
// source, erased at build time like the `@comical/contract`/`@comical/registry` types above). These
// are the exact shapes the `/library*` REST routes serialize, so no per-field adapter is needed.
import type {
  ActivityItemView as ApiActivityItem,
  HistoryItem as ApiHistoryItem,
  LibraryEntryView as ApiLibraryEntry,
  LibraryList as ApiLibraryList,
} from '@comical/library';

export type {
  ApiBridgeInfo,
  SettingDescriptor,
  SettingOption,
  SettingValue,
  RegistryBridgeEntry,
  RegistryTrackerEntry,
  SavedRegistry,
  ApiActivityItem,
  ApiHistoryItem,
  ApiLibraryEntry,
  ApiLibraryList,
};

/** GET /bridges/{id} response — settings form data for one bridge. `info` is the bridge's full
 *  self-description (capabilities, version, contract version, languages, rate limit — everything
 *  `GET /bridges` trims down to the browse-card fields in `Bridge`), not the app's local `Bridge`
 *  UI type. */
export interface BridgeSettingsInfo {
  info: ApiBridgeInfo;
  settings: SettingDescriptor[];
  values: Record<string, SettingValue>;
  /** Keys of secret fields that already have a stored value (never the value itself). */
  secretsSet: string[];
  missingRequired: string[];
  configured: boolean;
  /** Reserved, host-managed tag exclusions (capability "exclude-tags") — ids the bridge's lists/
   *  search hide series carrying. Separate from `settings`/`values` since it bypasses the
   *  descriptor-driven form (see `PUT /bridges/{id}/excluded-tags`). */
  excludedTags: string[];
  /** Id → display label for `excludedTags`, folded in by the host from its tag-name cache. */
  excludedTagLabels: Record<string, string>;
}

/** GET/PUT /bridges/{id}/genre-exclusions response (capability "exclude-genres") — account-wide
 *  state owned by the bridge's own backend, distinct from the host-stored `excludedTags`. */
export interface GenreExclusions {
  available: { id: string; label: string }[];
  excluded: string[];
}

/** GET/PUT /library/bridges/{id}/prefs response. */
export interface BridgePrefs {
  bridgeId: string;
  trackersDisabled: boolean;
  historyDisabled: boolean;
}

/** The bare per-tracker identity, nested under `info` in both list and detail responses. */
export interface TrackerInfo {
  id: string;
  name: string;
  capabilities: string[];
}

/** GET /trackers → one entry per mounted tracker (mirrors `BridgeSummary`'s shape). */
export interface TrackerSummary {
  info: TrackerInfo;
  configured: boolean;
  missingRequired: string[];
}

/** GET /trackers/{id}/settings response. */
export interface TrackerSettingsInfo {
  info: TrackerInfo;
  settings: SettingDescriptor[];
  values: Record<string, SettingValue>;
  secretsSet: string[];
}

/** Mirrors `RegistryManager.checkUpdates()`/`checkTrackerUpdates()`'s element shape. */
export interface RegistryUpdateInfo {
  id: string;
  installedVersion: string;
  availableVersion: string;
}

/** Mirrors `RegistryManager.browse()`'s element shape (`AvailableBridge`, defined in `manager.ts`,
 *  which this app can't type-import — see header). */
export interface AvailableBridge {
  entry: RegistryBridgeEntry;
  registryUrl: string;
  installedVersion: string | null;
  updateAvailable: boolean;
}

/** Mirrors `RegistryManager.browseTrackers()`'s element shape (`AvailableTracker`). */
export interface AvailableTracker {
  entry: RegistryTrackerEntry;
  registryUrl: string;
  installedVersion: string | null;
  updateAvailable: boolean;
}

/** Mirrors `RegistryManager.install()`/`update()`/`installTracker()`/`updateTracker()`'s
 *  return shape (`InstallResult`). */
export interface InstallResult {
  id: string;
  version: string;
  bundlePath: string;
}

async function fetchPut<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** DELETE returning a JSON body (the downloads delete routes hand back the blob `files` to remove). */
async function fetchDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await transport(path, { method: 'DELETE', signal });
  if (!res.ok) {
    const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(responseBody.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** GET /bridges/{id} → settings form data for one bridge. */
export function getBridgeSettings(bridgeId: string, signal?: AbortSignal): Promise<BridgeSettingsInfo> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}`, signal);
}

/** PUT /bridges/{id}/settings → persist a settings patch. Omit a secret key to keep its
 *  existing stored value (the server merges the patch onto current settings). */
export function putBridgeSettings(
  bridgeId: string,
  values: Record<string, SettingValue>,
  signal?: AbortSignal,
): Promise<{ settings: Record<string, SettingValue> }> {
  return fetchPut(`/bridges/${encodeURIComponent(bridgeId)}/settings`, values, signal);
}

/** PUT /bridges/{id}/excluded-tags → replace the bridge's persistent tag exclusions (capability
 *  "exclude-tags"). `labels` seeds the host's id→label cache with names the client already knows
 *  so a later reload folds them back in without a `getTags` round-trip. */
export function putExcludedTags(
  bridgeId: string,
  tags: string[],
  labels: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ excludedTags: string[]; excludedTagLabels: Record<string, string> }> {
  return fetchPut(`/bridges/${encodeURIComponent(bridgeId)}/excluded-tags`, { tags, labels }, signal);
}

/** GET /bridges/{id}/genre-exclusions → account-wide genre exclusions (capability "exclude-genres"). */
export function getGenreExclusions(bridgeId: string, signal?: AbortSignal): Promise<GenreExclusions> {
  return fetchJson(`/bridges/${encodeURIComponent(bridgeId)}/genre-exclusions`, signal);
}

/** PUT /bridges/{id}/genre-exclusions → replace the bridge's account-wide genre exclusions. */
export function putGenreExclusions(
  bridgeId: string,
  genres: string[],
  signal?: AbortSignal,
): Promise<GenreExclusions> {
  return fetchPut(`/bridges/${encodeURIComponent(bridgeId)}/genre-exclusions`, { genres }, signal);
}

/** GET /library/bridges/{id}/prefs → per-bridge library prefs (tracker sync / history opt-out),
 *  or `null` when this server has no library store mounted. */
export function getBridgePrefs(bridgeId: string, signal?: AbortSignal): Promise<BridgePrefs | null> {
  return fetchJsonOptional(`/library/bridges/${encodeURIComponent(bridgeId)}/prefs`, signal);
}

/** PUT /library/bridges/{id}/prefs → update per-bridge library prefs. */
export function putBridgePrefs(
  bridgeId: string,
  update: { trackersDisabled?: boolean; historyDisabled?: boolean },
  signal?: AbortSignal,
): Promise<void> {
  return fetchPut(`/library/bridges/${encodeURIComponent(bridgeId)}/prefs`, update, signal);
}

// ─── Local library / history / activity (optional — a `null`/404 means no library store) ────────
//
// Unlike bridge `favorites` (a per-bridge backend feature), this is the host's own cross-bridge
// library: entries keyed by `(bridgeId, seriesId)`, reading progress, a resume-able history, and an
// "activity" feed of newly-detected chapters. Mounted only when the server (or the on-device
// embedded runtime) has a library store — `getLibrary` returns `null` in that absence so screens can
// show a "needs a library" state instead of an error, mirroring `getBridgePrefs`/`getTrackers`.

/** How to sort the library grid — maps 1:1 to the `/library?sort=` query param. */
export type LibrarySort = 'added' | 'title' | 'lastRead' | 'unread';

/** GET /library → the user's library entries (with derived `unreadCount`), or `null` when no library
 *  store is mounted. `q` scopes to a title search; `sort` orders the grid; `listId`/`unlisted` filter
 *  by custom-list membership (mutually exclusive — `unlisted` wins if both are set). */
export function getLibrary(
  opts: { q?: string; sort?: LibrarySort; listId?: string; unlisted?: boolean } = {},
  signal?: AbortSignal,
): Promise<ApiLibraryEntry[] | null> {
  const qs = new URLSearchParams();
  if (opts.q) qs.set('q', opts.q);
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.unlisted) qs.set('unlisted', 'true');
  else if (opts.listId) qs.set('list', opts.listId);
  const query = qs.toString();
  return fetchJsonOptional(`/library${query ? `?${query}` : ''}`, signal);
}

// ─── Custom lists ────────────────────────────────────────────────────────────
// User-defined collections the library groups entries into (e.g. "Reading"). Membership lives on
// each entry's `listIds`; these routes manage the list docs + an entry's memberships. All require a
// mounted library store — with none, the collection routes 404 (getLibraryLists maps that to `[]`).

/** GET /library/lists → the user's custom lists (ascending `order`), or `[]` when no library store. */
export async function getLibraryLists(signal?: AbortSignal): Promise<ApiLibraryList[]> {
  return (await fetchJsonOptional<ApiLibraryList[]>('/library/lists', signal)) ?? [];
}

/** POST /library/lists → create a list, returning the new `LibraryList` (with its assigned id/order). */
export function createLibraryList(name: string, signal?: AbortSignal): Promise<ApiLibraryList> {
  return fetchPost('/library/lists', { name }, signal);
}

/** POST /library/lists/reorder → set the lists' order to `orderedIds`. */
export function reorderLibraryLists(orderedIds: string[], signal?: AbortSignal): Promise<unknown> {
  return fetchPost('/library/lists/reorder', { orderedIds }, signal);
}

/** PATCH /library/lists/{id} → rename a list. */
export function renameLibraryList(id: string, name: string, signal?: AbortSignal): Promise<unknown> {
  return fetchPatch(`/library/lists/${encodeURIComponent(id)}`, { name }, signal);
}

/** DELETE /library/lists/{id} → delete a list (also strips its id from every entry's `listIds`). */
export function deleteLibraryList(id: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/lists/${encodeURIComponent(id)}`, 'DELETE', signal);
}

/** PUT /library/entries/{b}/{s}/lists → set which lists a series belongs to (replaces its memberships). */
export function setEntryLists(
  bridgeId: string,
  seriesId: string,
  listIds: string[],
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPut(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/lists`,
    { listIds },
    signal,
  );
}

/** GET /library/entries/{b}/{s} → whether a series is in the library (404 = not in library). */
export async function isInLibrary(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await transport(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`,
    { signal },
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return true;
}

/** GET /library/entries/{b}/{s} → the entry's custom-list memberships, or `null` when the series
 *  isn't in the library (404). Used by the list-assign picker to seed its checkboxes. */
export async function getEntryLists(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<string[] | null> {
  const res = await transport(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`,
    { signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { entry?: { listIds?: string[] } };
  return body.entry?.listIds ?? [];
}

/** Display snapshot persisted with a new library entry so it renders offline / after bridge removal. */
export type LibrarySnapshot = { title?: string; thumbnailUrl?: string; author?: string };

/** POST /library/entries → add a series to the library (runtime fills missing snapshot from the bridge). */
export function addLibraryEntry(
  bridgeId: string,
  seriesId: string,
  snap: LibrarySnapshot = {},
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPost('/library/entries', { bridgeId, seriesId, ...snap }, signal);
}

/** DELETE /library/entries/{b}/{s} → remove a series from the library. */
export function removeLibraryEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** PUT /library/entries/{b}/{s}/progress/{chapterId} → record read progress for a library series
 *  (also updates its last-read resume cache). No-op-safe: the caller fires-and-forgets. */
export function putChapterProgress(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  update: { lastPage?: number; pageCount?: number; chapterName?: string },
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPut(
    `/library/entries/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}/progress/${encodeURIComponent(chapterId)}`,
    update,
    signal,
  );
}

/** GET /library/history → recently-read series, newest first (empty when no store). */
export function getHistory(limit?: number, signal?: AbortSignal): Promise<ApiHistoryItem[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return fetchJson(`/library/history${qs}`, signal);
}

/** DELETE /library/history/{b}/{s} → drop a series from reading history. */
export function deleteHistoryEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/library/history/${encodeURIComponent(bridgeId)}/${encodeURIComponent(seriesId)}`, 'DELETE', signal);
}

/** POST /reading-history → record a non-library read into the reading log (with resume page). */
export function recordReadingHistory(
  entry: {
    bridgeId: string;
    seriesId: string;
    title: string;
    thumbnailUrl?: string;
    chapterId?: string;
    chapterName?: string;
    lastPage?: number;
    pageCount?: number;
  },
  signal?: AbortSignal,
): Promise<unknown> {
  return fetchPost('/reading-history', { ...entry, lastReadAt: Date.now() }, signal);
}

/** GET /library/activity → the new-chapters feed (each item carries a derived `read`). */
export function getActivity(signal?: AbortSignal): Promise<ApiActivityItem[]> {
  return fetchJson('/library/activity', signal);
}

/** GET /library/activity/count → unread new-chapter count (for a tab badge). */
export function getActivityCount(signal?: AbortSignal): Promise<{ unread: number }> {
  return fetchJson('/library/activity/count', signal);
}

/** GET /library/usage → the bytes the library occupies on the active host (store docs + captured
 *  cover blobs). Null when the host has no library module. */
export function libraryUsage(signal?: AbortSignal): Promise<{ diskBytes: number } | null> {
  return fetchJsonOptional('/library/usage', signal);
}

/** POST /library/sync → scan the library for new chapters (the "Check for updates" action). */
export function runBackgroundSync(signal?: AbortSignal): Promise<unknown> {
  return fetchPost('/library/sync', {}, signal);
}

/** POST /bridges/{id}/update → update a registry-installed bridge to its latest version. */
export function updateBridge(bridgeId: string, signal?: AbortSignal): Promise<InstallResult> {
  return fetchPost(`/bridges/${encodeURIComponent(bridgeId)}/update`, {}, signal);
}

/** DELETE /bridges/{id} → uninstall a registry-installed bridge. */
export function uninstallBridge(bridgeId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/bridges/${encodeURIComponent(bridgeId)}`, 'DELETE', signal);
}

// ─── Trackers (optional server capability — a 404 means no TrackerManager is mounted) ────────

/** GET /trackers → the mounted trackers, or `null` when no `TrackerManager` is mounted on this server. */
export function getTrackers(signal?: AbortSignal): Promise<TrackerSummary[] | null> {
  return fetchJsonOptional('/trackers', signal);
}

/** GET /trackers/{id}/settings → settings form data for one tracker. */
export function getTrackerSettings(trackerId: string, signal?: AbortSignal): Promise<TrackerSettingsInfo> {
  return fetchJson(`/trackers/${encodeURIComponent(trackerId)}/settings`, signal);
}

/** PUT /trackers/{id}/settings → persist a settings patch (same omit-to-keep-secret semantics
 *  as `putBridgeSettings`). */
export function putTrackerSettings(
  trackerId: string,
  values: Record<string, SettingValue>,
  signal?: AbortSignal,
): Promise<{ settings: Record<string, SettingValue> }> {
  return fetchPut(`/trackers/${encodeURIComponent(trackerId)}/settings`, values, signal);
}

/** POST /trackers/{id}/update → update a registry-installed tracker to its latest version. */
export function updateTracker(trackerId: string, signal?: AbortSignal): Promise<InstallResult> {
  return fetchPost(`/trackers/${encodeURIComponent(trackerId)}/update`, {}, signal);
}

/** DELETE /trackers/{id} → uninstall a registry-installed tracker. */
export function uninstallTracker(trackerId: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/trackers/${encodeURIComponent(trackerId)}`, 'DELETE', signal);
}

// ─── Registries (optional server capability — mounted only when M4 registry support is on) ───

/** GET /registries → registries the user has added, or `null` when registry support isn't mounted. */
export function getRegistries(signal?: AbortSignal): Promise<SavedRegistry[] | null> {
  return fetchJsonOptional('/registries', signal);
}

/** POST /registries → add a registry by URL. */
export function addRegistry(
  url: string,
  requireSignature?: boolean,
  signal?: AbortSignal,
): Promise<SavedRegistry> {
  const body: { url: string; requireSignature?: boolean } = { url };
  if (requireSignature !== undefined) body.requireSignature = requireSignature;
  return fetchPost('/registries', body, signal);
}

/** DELETE /registries/{encodedUrl} → remove a registry (orphans its installed bridges/trackers). */
export function removeRegistry(url: string, signal?: AbortSignal): Promise<void> {
  return fetchOk(`/registries/${encodeURIComponent(url)}`, 'DELETE', signal);
}

/** GET /registries/{encodedUrl}/bridges → bridges available in one registry. */
export function browseRegistryBridges(url: string, signal?: AbortSignal): Promise<AvailableBridge[]> {
  return fetchJson(`/registries/${encodeURIComponent(url)}/bridges`, signal);
}

/** GET /registries/{encodedUrl}/trackers → trackers available in one registry. */
export function browseRegistryTrackers(url: string, signal?: AbortSignal): Promise<AvailableTracker[]> {
  return fetchJson(`/registries/${encodeURIComponent(url)}/trackers`, signal);
}

/** POST /registries/{encodedUrl}/bridges/{id}/install → install a bridge from a registry. */
export function installRegistryBridge(
  registryUrl: string,
  bridgeId: string,
  signal?: AbortSignal,
): Promise<InstallResult> {
  return fetchPost(`/registries/${encodeURIComponent(registryUrl)}/bridges/${encodeURIComponent(bridgeId)}/install`, {}, signal);
}

/** POST /registries/{encodedUrl}/trackers/{id}/install → install a tracker from a registry. */
export function installRegistryTracker(
  registryUrl: string,
  trackerId: string,
  signal?: AbortSignal,
): Promise<InstallResult> {
  return fetchPost(`/registries/${encodeURIComponent(registryUrl)}/trackers/${encodeURIComponent(trackerId)}/install`, {}, signal);
}

/** GET /registry/updates → update info for all installed registry bridges (manual policy — never auto-installed). */
export function checkRegistryUpdates(signal?: AbortSignal): Promise<RegistryUpdateInfo[]> {
  return fetchJson('/registry/updates', signal);
}

/** GET /registry/tracker-updates → update info for all installed registry trackers. */
export function checkRegistryTrackerUpdates(signal?: AbortSignal): Promise<RegistryUpdateInfo[]> {
  return fetchJson('/registry/tracker-updates', signal);
}
