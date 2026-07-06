/**
 * Query-key factory + `useQuery` option builders that wrap `useDataSource()`.
 *
 * Screens never build raw keys or call the data source inside a `queryFn`
 * directly — they call these builders so keys stay consistent (and therefore
 * cache hits actually line up) across the list, detail, and reader screens.
 *
 * Every key carries `mock` (from `useMockActive()`): the real API and the
 * dev/demo mock data must never collide in one cache entry, so flipping the
 * "Use mock data" toggle swaps to a separate keyspace instead of serving stale
 * cross-source data.
 */
import type { UseQueryOptions } from '@tanstack/react-query';

import type { LibrarySort } from './api';
import type { DataSource } from './source';
import type { ActivityEntry, HistoryEntry, LibraryItem, SeriesDetail, SeriesEntry } from './types';

/** Per-series fetch options that affect the *shape* of the result (and thus the key). */
export type SeriesDetailOpts = { direct?: boolean; bridgeName?: string; title?: string; cover?: string };

export const queryKeys = {
  seriesDetail: (mock: boolean, bridgeId: string, seriesId: string, direct: boolean) =>
    ['seriesDetail', mock, bridgeId, seriesId, direct] as const,
  chapterPages: (mock: boolean, bridgeId: string, seriesId: string, chapterId: string) =>
    ['chapterPages', mock, bridgeId, seriesId, chapterId] as const,
  directPages: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['directPages', mock, bridgeId, seriesId] as const,
  isFavorite: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['isFavorite', mock, bridgeId, seriesId] as const,
  relatedGroups: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['relatedGroups', mock, bridgeId, seriesId] as const,
  library: (mock: boolean, q: string, sort: LibrarySort) => ['library', mock, q, sort] as const,
  inLibrary: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['inLibrary', mock, bridgeId, seriesId] as const,
  history: (mock: boolean) => ['history', mock] as const,
  activity: (mock: boolean) => ['activity', mock] as const,
  activityCount: (mock: boolean) => ['activityCount', mock] as const,
};

// The builders return a widened `UseQueryOptions` (queryKey typed as the general
// `QueryKey`) so a ternary between two of them — e.g. chapter vs. direct pages in
// the reader — collapses to one assignable type instead of a union TS can't
// reconcile against `useQuery`'s overloads.

/** `useQuery` options for a series' full detail (metadata + chapters or page thumbs). */
export function seriesDetailQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  opts: SeriesDetailOpts,
): UseQueryOptions<SeriesDetail, Error> {
  const direct = opts.direct ?? false;
  // When the browse card forwarded the title + cover it already had, seed the
  // query with a placeholder so the detail screen mounts ONE persistent body
  // (real hero, rest still loading) instead of swapping a skeleton subtree for a
  // body subtree — that swap remounts the cover <Image>, blanking it for a frame
  // (a visible flash) even though it's the same cached URL. `isPlaceholderData`
  // tells the screen the non-hero sections are still loading. Without a forwarded
  // cover (deep-link) there's nothing to keep steady, so leave it unset and let
  // the screen fall back to its full skeleton.
  const placeholderData: SeriesDetail | undefined =
    opts.title && opts.cover
      ? { id: seriesId, title: opts.title, cover: opts.cover, bridge: opts.bridgeName ?? '', relatedGroupsDeferred: false }
      : undefined;
  return {
    queryKey: queryKeys.seriesDetail(mock, bridgeId, seriesId, direct),
    queryFn: ({ signal }) => ds.getSeriesDetail(bridgeId, seriesId, opts, signal),
    enabled: !!seriesId,
    placeholderData,
  };
}

/** `useQuery` options for one chapter's page-image URLs. */
export function chapterPagesQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  chapterId: string,
): UseQueryOptions<string[], Error> {
  return {
    queryKey: queryKeys.chapterPages(mock, bridgeId, seriesId, chapterId),
    queryFn: ({ signal }) => ds.getChapterPages(bridgeId, seriesId, chapterId, signal),
    enabled: !!seriesId && !!chapterId,
  };
}

/** `useQuery` options for a direct (chapterless) series' page-image URLs. */
export function directPagesQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
): UseQueryOptions<string[], Error> {
  return {
    queryKey: queryKeys.directPages(mock, bridgeId, seriesId),
    queryFn: ({ signal }) => ds.getDirectPages(bridgeId, seriesId, signal),
    enabled: !!seriesId,
  };
}

/** `useQuery` options for whether a series is currently favorited. */
export function isFavoriteQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
): UseQueryOptions<boolean, Error> {
  return {
    queryKey: queryKeys.isFavorite(mock, bridgeId, seriesId),
    queryFn: ({ signal }) => ds.isFavorite(bridgeId, seriesId, signal),
    enabled: !!bridgeId && !!seriesId,
  };
}

/** `useQuery` options for the library grid (`null` result = no library store mounted). */
export function libraryQuery(
  ds: DataSource,
  mock: boolean,
  q: string,
  sort: LibrarySort,
): UseQueryOptions<LibraryItem[] | null, Error> {
  return {
    queryKey: queryKeys.library(mock, q, sort),
    queryFn: ({ signal }) => ds.getLibrary({ ...(q ? { q } : {}), sort }, signal),
  };
}

/** `useQuery` options for whether a series is currently in the library. */
export function inLibraryQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
): UseQueryOptions<boolean, Error> {
  return {
    queryKey: queryKeys.inLibrary(mock, bridgeId, seriesId),
    queryFn: ({ signal }) => ds.isInLibrary(bridgeId, seriesId, signal),
    enabled: !!bridgeId && !!seriesId,
  };
}

/** `useQuery` options for the reading-history list. */
export function historyQuery(ds: DataSource, mock: boolean): UseQueryOptions<HistoryEntry[], Error> {
  return {
    queryKey: queryKeys.history(mock),
    queryFn: ({ signal }) => ds.getHistory(signal),
  };
}

/** `useQuery` options for the activity feed (newly-detected chapters). */
export function activityQuery(ds: DataSource, mock: boolean): UseQueryOptions<ActivityEntry[], Error> {
  return {
    queryKey: queryKeys.activity(mock),
    queryFn: ({ signal }) => ds.getActivity(signal),
  };
}

/** `useQuery` options for a series' related-rail groups, fetched separately from the main detail
 *  when it came back with `relatedGroupsDeferred: true` — pass that flag (ANDed with anything else
 *  the caller needs) as `enabled` so this only fires once it's actually needed. */
export function relatedGroupsQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  enabled: boolean,
): UseQueryOptions<{ label: string; items: SeriesEntry[] }[], Error> {
  return {
    queryKey: queryKeys.relatedGroups(mock, bridgeId, seriesId),
    queryFn: ({ signal }) => ds.getRelatedGroups(bridgeId, seriesId, signal),
    enabled: enabled && !!bridgeId && !!seriesId,
  };
}
