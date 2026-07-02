/**
 * Thin client for the real Comical backend API (`@comical/host-server` — the
 * same server the legacy web app talks to). Mirrors the reference's `k()`
 * fetch wrapper: `${BASE}${path}`, throw on non-2xx with the server's `error`
 * message, return parsed JSON.
 *
 * Base URL comes from EXPO_PUBLIC_COMICAL_SERVER (inlined by Expo at build
 * time) so it can be overridden per environment, defaulting to the live API.
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
import type { Bridge, BridgeList } from './types';

export const API_BASE =
  process.env.EXPO_PUBLIC_COMICAL_SERVER ?? 'https://comical.pork.casa/api';

export type { Bridge, BridgeList };

/** True for an aborted-request error, so callers can ignore unmount cancels. */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { signal });
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
  const res = await fetch(`${API_BASE}${path}`, { signal });
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
 */
export function pageOptions(lists: BridgeList[], capabilities: string[]): string[] {
  const opts = ['home'];
  for (const l of lists) if (l.page && l.id !== 'home') opts.push(l.name.toLowerCase());
  if (capabilities.includes('favorites')) opts.push('favorites');
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
  const res = await fetch(`${API_BASE}${path}`, { method, signal });
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

/** GET /bridges/{id}/series/{seriesId}/related → related-series rails for bridges (e.g. nhentai) that
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

import type { SettingDescriptor, SettingOption, SettingValue } from '@comical/contract';
import type { RegistryBridgeEntry, RegistryTrackerEntry, SavedRegistry } from '@comical/registry';

export type { SettingDescriptor, SettingOption, SettingValue, RegistryBridgeEntry, RegistryTrackerEntry, SavedRegistry };

/** GET /bridges/{id} response — settings form data for one bridge. */
export interface BridgeSettingsInfo {
  info: Bridge;
  settings: SettingDescriptor[];
  values: Record<string, SettingValue>;
  /** Keys of secret fields that already have a stored value (never the value itself). */
  secretsSet: string[];
  missingRequired: string[];
  configured: boolean;
}

/** GET /trackers → one entry per mounted tracker. */
export interface TrackerInfo {
  id: string;
  name: string;
  capabilities: string[];
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
  const res = await fetch(`${API_BASE}${path}`, {
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
  const res = await fetch(`${API_BASE}${path}`, {
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
export function getTrackers(signal?: AbortSignal): Promise<TrackerInfo[] | null> {
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
