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

import type { DataSource } from './source';
import type { SeriesDetail } from './types';

/** Per-series fetch options that affect the *shape* of the result (and thus the key). */
export type SeriesDetailOpts = { direct?: boolean; bridgeName?: string; title?: string };

export const queryKeys = {
  seriesDetail: (mock: boolean, bridgeId: string, seriesId: string, direct: boolean) =>
    ['seriesDetail', mock, bridgeId, seriesId, direct] as const,
  chapterPages: (mock: boolean, bridgeId: string, seriesId: string, chapterId: string) =>
    ['chapterPages', mock, bridgeId, seriesId, chapterId] as const,
  directPages: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['directPages', mock, bridgeId, seriesId] as const,
  isFavorite: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['isFavorite', mock, bridgeId, seriesId] as const,
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
  return {
    queryKey: queryKeys.seriesDetail(mock, bridgeId, seriesId, direct),
    queryFn: ({ signal }) => ds.getSeriesDetail(bridgeId, seriesId, opts, signal),
    enabled: !!seriesId,
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
