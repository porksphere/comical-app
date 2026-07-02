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
