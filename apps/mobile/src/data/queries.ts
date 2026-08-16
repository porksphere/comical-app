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
import { keepPreviousData, type UseQueryOptions } from '@tanstack/react-query';

import { STALE_TIME_MS } from './query-client';
import type * as api from './api';
import { isRailLayout, railKindFor, type DataSource, type QueryOpts } from './source';
import type {
  ActivityEntry,
  ChapterProgress,
  GridPage,
  HistoryEntry,
  HomeGridSection,
  LibraryItem,
  Collection,
  RailSection,
  SeriesDetail,
  SeriesEntry,
  SeriesListResult,
} from './types';

/** How the Library grid is scoped to a collection. `null` = all entries; `'uncollected'` = entries
 *  in no collection; otherwise a collection id. Part of the library query key so each view caches
 *  apart. The host resolves membership by joining series favorites, so this stays one query. */
export type CollectionFilter = string | 'uncollected' | null;

/** Per-series fetch options that affect the *shape* of the result (and thus the key). */
export type SeriesDetailOpts = { direct?: boolean; bridgeName?: string; title?: string; cover?: string };

/**
 * A single logical Browse grid "scope" — everything the flat results/terminal grid can be showing,
 * as one discriminated value. It's both the query-key discriminator (so each scope caches
 * separately and a scope switch is a key change, not a manual `setState([])`) and the input to
 * `fetchBrowseScope` below, which maps it to the right data-source call. Keeping the two derived
 * from one value is what lets the grid move between scopes without ever clearing to empty (the old
 * flash / LegendList-remount trigger): react-query holds the previous scope's data (keepPreviousData)
 * until the new scope resolves.
 */
export type BrowseScope =
  | { kind: 'favorites' }
  /** A page-flagged list (e.g. "Popular"), optionally filtered/sorted, or scoped-searched when the
   *  list is `searchable` and a query is set. */
  | { kind: 'list'; listId: string; opts?: QueryOpts }
  /** Global search: an unscoped query, or filters/sort with no specific list. */
  | { kind: 'search'; query: string; opts?: QueryOpts }
  /** A rail's "See all" drill-down — that list's items, page-only. */
  | { kind: 'seeAll'; listId: string }
  /** A composed-Home grid section (the terminal one that shares the main list's infinite scroll, or
   *  a non-terminal "Load more" block). Page 1 is seeded from `getHomeSections` (no extra request);
   *  later pages come through here. */
  | { kind: 'homeGrid'; listId: string };

export const queryKeys = {
  seriesDetail: (mock: boolean, bridgeId: string, seriesId: string, direct: boolean) =>
    ['seriesDetail', mock, bridgeId, seriesId, direct] as const,
  seriesList: (mock: boolean, bridgeId: string, seriesId: string, direct: boolean) =>
    ['seriesList', mock, bridgeId, seriesId, direct] as const,
  chapterPages: (mock: boolean, bridgeId: string, seriesId: string, chapterId: string) =>
    ['chapterPages', mock, bridgeId, seriesId, chapterId] as const,
  directPages: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['directPages', mock, bridgeId, seriesId] as const,
  /** One series' persisted chapter read state. Deliberately NOT folded into `seriesList`: read
   *  state is local library data that changes on every mark-read/finished chapter, while the
   *  chapter list itself comes from the bridge over the network — keeping them apart means a
   *  mark-read invalidates only this key instead of re-fetching chapters. */
  chapterProgress: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['chapterProgress', mock, bridgeId, seriesId] as const,
  pageThumb: (mock: boolean, bridgeId: string, seriesId: string, pageIndex: number) =>
    ['pageThumb', mock, bridgeId, seriesId, pageIndex] as const,
  isFavorite: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['isFavorite', mock, bridgeId, seriesId] as const,
  relatedGroups: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['relatedGroups', mock, bridgeId, seriesId] as const,
  library: (mock: boolean, q: string, sort: api.LibrarySort, collection: CollectionFilter = null) =>
    ['library', mock, q, sort, collection] as const,
  /** The user's collections. */
  collections: (mock: boolean) => ['collections', mock] as const,
  /** One series' collection memberships (for the assign picker). */
  seriesCollections: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['seriesCollections', mock, bridgeId, seriesId] as const,
  /** A scoped collected-items listing. Every variant sits under the `collectionItems` prefix so one
   *  write can invalidate them all — see `collectionItemsAll`. */
  collectionItems: (mock: boolean, query: api.CollectedItemsQuery) =>
    ['collectionItems', mock, query] as const,
  /** PREFIX key: invalidating this refreshes every collected grid whatever its type/sort/dir/
   *  collection, the same trick `libraryList` uses for the library grid. */
  collectionItemsAll: (mock: boolean) => ['collectionItems', mock] as const,
  /** One chapter's collected page indices — what the reader's heart reads. */
  chapterPageIndices: (mock: boolean, bridgeId: string, seriesId: string, chapterId: string) =>
    ['chapterPageIndices', mock, bridgeId, seriesId, chapterId] as const,
  trackerLinks: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['trackerLinks', mock, bridgeId, seriesId] as const,
  inLibrary: (mock: boolean, bridgeId: string, seriesId: string) =>
    ['inLibrary', mock, bridgeId, seriesId] as const,
  /** A bridge's favorites classified against the library, for the import dialog. Invalidated after
   *  an import so re-opening the dialog shows what just landed as "already in library". */
  favoritesImportPreview: (mock: boolean, bridgeId: string) =>
    ['favoritesImportPreview', mock, bridgeId] as const,
  history: (mock: boolean) => ['history', mock] as const,
  activity: (mock: boolean) => ['activity', mock] as const,
  /** The tab/app badge count — unread items across the whole feed. It only drops when a chapter
   *  is read (or marked read / cleared from the feed), never from merely opening the tab. */
  activityCount: (mock: boolean) => ['activityCount', mock] as const,
  // The composed Home surface (rails + grid sections) for a bridge.
  homeSections: (mock: boolean, bridgeId: string) => ['homeSections', mock, bridgeId] as const,
  // One representative rail for a bridge (its `featured`/first rail list, page 1) — the building
  // block of the synthetic "Comical" aggregate home.
  bridgeFeaturedRail: (mock: boolean, bridgeId: string) => ['bridgeFeaturedRail', mock, bridgeId] as const,
  // Page 1 of a bridge's account favorites, for the consolidated Comical Favorites page's rail. A
  // SEPARATE key from `browseGrid({kind:'favorites'})` ON PURPOSE (same reasoning as `customSectionPage`
  // below): that key is owned by the single-bridge favorites INFINITE grid, and this plain page-1
  // query must not share its cache entry — the shapes differ (`GridPage` vs react-query `InfiniteData`),
  // and an infinite query reading a plain `GridPage` reads `data.pages.length` off `undefined` → crash.
  bridgeFavoritesRail: (mock: boolean, bridgeId: string) => ['bridgeFavoritesRail', mock, bridgeId] as const,
  // Page 1 of a bridge's search, for the cross-bridge (Comical) search fan-out's per-bridge rail. A
  // SEPARATE key from `browseGrid({kind:'search',query})` ON PURPOSE (same reasoning as
  // `bridgeFavoritesRail` above): that key is owned by the INFINITE search grid — the reader's `/results`
  // "See all" of a search rail runs `useInfiniteQuery` on exactly `browseGrid({kind:'search',query})`
  // (no `opts`, unlike the single-bridge search screen, so it hashes the same). If this plain page-1
  // rail query shared that entry, opening See all would hydrate the infinite query from a plain
  // `GridPage` and crash on `data.pages.length`.
  bridgeSearchRail: (mock: boolean, bridgeId: string, query: string) =>
    ['bridgeSearchRail', mock, bridgeId, query] as const,
  // Page 1 of a specific bridge list, for a user-composed custom page's section (rail items, or the
  // grid block's seed). A SEPARATE key from `browseGrid({kind:'homeGrid'})` on purpose — that one is
  // owned by the infinite-scroll grid queries, and a plain (non-infinite) query must not share their
  // cache entry (incompatible data shapes). See `use-custom-page-rows.ts`.
  customSectionPage: (mock: boolean, bridgeId: string, listId: string) =>
    ['customSectionPage', mock, bridgeId, listId] as const,
  // Per-bridge browse metadata (the Page selector's lists, and the filter/sort definitions).
  bridgeLists: (mock: boolean, bridgeId: string) => ['bridgeLists', mock, bridgeId] as const,
  bridgeFilters: (mock: boolean, bridgeId: string) => ['bridgeFilters', mock, bridgeId] as const,
  bridgeSortOptions: (mock: boolean, bridgeId: string) => ['bridgeSortOptions', mock, bridgeId] as const,
  // Live tag autocomplete. `sourceKey` is a per-bridge token (so two bridges' searches for the same
  // text don't collide in the global cache); `query` is the debounced search text.
  tagSearch: (sourceKey: string, query: string) => ['tagSearch', sourceKey, query] as const,
  // The flat Browse results/terminal grid. `scope` (a `BrowseScope`) fully discriminates what's
  // shown — react-query's default key hashing is stable over object key order, so this dedupes
  // correctly. A bridge switch or filter/sort/search change is just a new key here.
  browseGrid: (mock: boolean, bridgeId: string, scope: BrowseScope) =>
    ['browseGrid', mock, bridgeId, scope] as const,

  // The installed-bridges list (Browse's rails/selector, the Library/History/Activity bridge map).
  // Unlike the server-infra keys below this one DOES carry `mock`: the mock source serves a
  // different bridge list, and without `mock` in the key the dev toggle left the previous mode's
  // cached (possibly empty) list on screen until a full restart.
  bridges: (mock: boolean) => ['bridges', mock] as const,

  // ─── Server-infra reads (Settings / registry screens) ──────────────────────
  // These are mock-agnostic — the registry/bridge/tracker plumbing is the same regardless of the
  // dev mock toggle — so, unlike the content keys above, they carry no `mock`. Several are shared
  // across files (a bridge-settings save must invalidate the same key the settings screen reads),
  // which is why they live here rather than as raw literals that can silently drift apart.
  bridgeSummaries: () => ['bridgeSummaries'] as const,
  bridgeSettings: (bridgeId: string) => ['bridgeSettings', bridgeId] as const,
  bridgePrefs: (bridgeId: string) => ['bridgePrefs', bridgeId] as const,
  trackers: () => ['trackers'] as const,
  trackerSettings: (trackerId: string) => ['trackerSettings', trackerId] as const,
  /** Catalog search results for the "+ Link tracker" form — mock-agnostic like `trackers` above. The
   *  form only ever shows the first page (you pick one match and link it), so there's nothing to
   *  discriminate beyond the query. */
  trackerCatalogSearch: (trackerId: string, query: string) =>
    ['trackerCatalogSearch', trackerId, query] as const,
  registries: () => ['registries'] as const,
  registryBridges: (url: string) => ['registryBridges', url] as const,
  registryTrackers: (url: string) => ['registryTrackers', url] as const,
  // One combined count of available bridge + tracker updates, behind the Settings tab pip.
  registryUpdateCount: () => ['registryUpdateCount'] as const,
  // The in-app update checker's result — keyed by the channel AND the exact build asking. The
  // verdict is a statement *about the running binary* ("something newer than ME exists"), so it must
  // never outlive it: this entry is persisted to disk, and an in-place update keeps that storage
  // (SideStore/AltStore reinstalls over the same bundle id, an APK installs over itself, a web
  // reload is the same origin). Keyed on channel alone, a freshly updated build rehydrated the OLD
  // build's "update available: X" and — the entry still being inside its staleTime — showed it
  // without refetching, i.e. told you to update to the version you had just installed. Both parts of
  // the build id are needed: APP_VERSION doesn't move per-build on android/web (the reason those
  // channels compare commits instead), and BUILD_COMMIT is empty outside CI.
  appUpdateCheck: (channel: string, build: string) => ['appUpdateCheck', channel, build] as const,

  // ─── Downloads (device-local offline manifest) ─────────────────────────────
  // Downloads are device data, not source content, so these carry no `mock`. Both are prefixed
  // `['downloads']` so the engine can refresh the whole surface with one invalidation.
  downloadsUsage: () => ['downloads', 'usage'] as const,
  seriesDownloads: (bridgeId: string, seriesId: string) =>
    ['downloads', 'series', bridgeId, seriesId] as const,
  /** The library's host-side storage footprint (the Storage screen's breakdown segment). */
  libraryUsage: () => ['libraryUsage'] as const,

  // Invalidation target that prefix-matches the library grid (`['library', mock, q, sort]`), so
  // invalidating this refreshes the Library tab regardless of its current search/sort.
  libraryList: (mock: boolean) => ['library', mock] as const,
};

/** Maps a `BrowseScope` (+ resume cursor) to the data-source call that fetches it — the single place
 *  the grid's "which endpoint for this view" branching lives, shared by the infinite query's
 *  `queryFn`. Mirrors the old inline `fetchGrid`. */
export function fetchBrowseScope(
  ds: DataSource,
  bridgeId: string,
  scope: BrowseScope,
  cursor?: api.Cursor,
  signal?: AbortSignal,
): Promise<GridPage> {
  switch (scope.kind) {
    case 'favorites':
      return ds.getFavorites(bridgeId, cursor, signal);
    case 'seeAll':
    case 'homeGrid':
      return ds.getGridPage(bridgeId, scope.listId, cursor, undefined, signal);
    case 'list':
      return ds.getGridPage(bridgeId, scope.listId, cursor, scope.opts, signal);
    case 'search':
      return ds.search(bridgeId, scope.query, cursor, scope.opts, signal);
  }
}

/**
 * `initialPageParam` for every grid infinite query: the first read carries no cursor, because "start
 * at the beginning" is the absence of a position rather than a magic first value. Declared here with
 * an explicit type (not inlined as a bare `undefined`) so react-query infers the page param as a
 * cursor and `nextGridCursor` can hand back a real one.
 */
export const NO_CURSOR: api.Cursor | undefined = undefined;

/**
 * `getNextPageParam` for every grid infinite query: follow whatever cursor the last page handed back.
 *
 * This replaced a `(last, _all, lastParam) => last.hasNextPage ? lastParam + 1 : undefined` that each
 * screen redeclared. Guessing the next position from the previous one is exactly what a cursor
 * removes: a page with no `nextCursor` IS the last page, so there is no longer a flag that can claim
 * more results while pointing at the page just fetched.
 */
export const nextGridCursor = (last: GridPage): api.Cursor | undefined => last.nextCursor;

/**
 * One representative rail for a bridge — the building block of the synthetic "Comical" aggregate home.
 * Picks the bridge's `featured` rail-layout list (the contract's "surface prominently on home" flag),
 * else its first rail-layout home list, else its first home list; then fetches that list's page 1.
 * Returns `null` when the bridge has no non-page list with items. `ds`-polymorphic (works for real,
 * mock, and the on-device runtime with no per-source change).
 */
export async function fetchBridgeFeaturedRail(
  ds: DataSource,
  bridgeId: string,
  signal?: AbortSignal,
): Promise<RailSection | null> {
  const lists = await ds.getBridgeLists(bridgeId, signal);
  const pick =
    lists.find((l) => l.featured) ?? // the bridge's declared rail (any layout), if it marked one
    lists.find((l) => !l.page && isRailLayout(l.layout)) ?? // else its first rail-layout home list
    lists.find((l) => !l.page) ?? // else its first home section — a grid, shown here AS a rail
    lists[0]; // else its first list of ANY kind (incl. a page / infinite grid), also shown as a rail
  if (!pick) return null;
  const page = await ds.getGridPage(bridgeId, pick.id, undefined, undefined, signal);
  if (page.items.length === 0) return null;
  // A grid/page list gets `kind: 'regular'` from railKindFor, so it renders as a normal horizontal rail.
  return { id: pick.id, title: pick.name, kind: railKindFor(pick.layout), items: page.items };
}

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
    // A `cached` payload is the host's OFFLINE fallback — the live `getSeriesDetails` fetch failed
    // and it served the library's saved detail (see host-server router). Left under the normal 5-min
    // staleTime, that offline copy is treated as fresh and never re-attempted on a revisit, so a
    // series that failed once (a cold-start bridge load, a blip, a transient source error) stays
    // pinned in "offline mode" until the entry is removed and re-added. Mark an offline result as
    // ALWAYS stale so it re-attempts live automatically — on the next mount/revisit, on refocus, and
    // on reconnect — not only when the user manually pulls to refresh. A live result heals it and
    // reverts to the normal staleTime; a still-failing fetch just re-serves the cached copy (one
    // attempt per trigger, so there's no refetch loop). Fresh (non-cached) details keep the 5-min
    // reuse window that makes revisits instant.
    staleTime: (query) => (query.state.data?.cached ? 0 : STALE_TIME_MS),
    refetchOnMount: (query) => (query.state.data?.cached ? 'always' : true),
    refetchOnReconnect: (query) => query.state.data?.cached === true,
    refetchOnWindowFocus: (query) => query.state.data?.cached === true,
  };
}

/** `useQuery` options for a series' deferred chapter list / page-thumbnail grid
 *  (the ~200ms part `getSeriesDetail` no longer waits on). Pass `series.listDeferred`
 *  (ANDed with a real id) as `enabled` so it only fires when actually deferred. */
export function seriesListQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  direct: boolean,
  enabled: boolean,
): UseQueryOptions<SeriesListResult, Error> {
  return {
    queryKey: queryKeys.seriesList(mock, bridgeId, seriesId, direct),
    queryFn: ({ signal }) => ds.getSeriesList(bridgeId, seriesId, direct, signal),
    enabled: enabled && !!seriesId,
  };
}

/** `useQuery` options for a series' chapter read state. Safe for any series — one that isn't in the
 *  library has nowhere to store progress and simply resolves empty. */
export function chapterProgressQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  enabled: boolean,
): UseQueryOptions<ChapterProgress[], Error> {
  return {
    queryKey: queryKeys.chapterProgress(mock, bridgeId, seriesId),
    queryFn: ({ signal }) => ds.getChapterProgress(bridgeId, seriesId, signal),
    enabled: enabled && !!bridgeId && !!seriesId,
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

/** `useQuery` options for a bridge's favorites-import preview. Always refetched on open (`staleTime: 0`):
 *  the point of the dialog is to show the library as it is right now, and it's a per-open user action,
 *  not a background read. */
export function favoritesImportPreviewQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
): UseQueryOptions<api.FavoritesImportPreview, Error> {
  return {
    queryKey: queryKeys.favoritesImportPreview(mock, bridgeId),
    queryFn: ({ signal }) => ds.getFavoritesImportPreview(bridgeId, signal),
    enabled: !!bridgeId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  };
}

/** `useQuery` options for the library grid (`null` result = no library store mounted). `collection`
 *  scopes to a collection (`'uncollected'` = entries in none; an id; or `null` for all). */
export function libraryQuery(
  ds: DataSource,
  mock: boolean,
  q: string,
  sort: api.LibrarySort,
  collection: CollectionFilter = null,
): UseQueryOptions<LibraryItem[] | null, Error> {
  return {
    queryKey: queryKeys.library(mock, q, sort, collection),
    queryFn: ({ signal }) =>
      ds.getLibrary(
        {
          ...(q ? { q } : {}),
          sort,
          ...(collection === 'uncollected'
            ? { uncollected: true }
            : collection
              ? { collectionId: collection }
              : {}),
        },
        signal,
      ),
  };
}

/** `useQuery` options for a collected-items listing. **Pass `type: 'page'`** for a page grid: a
 *  query without it returns the mixed series/chapter/page union, and the failure is silent. */
export function collectionItemsQuery(
  ds: DataSource,
  mock: boolean,
  query: api.CollectedItemsQuery,
): UseQueryOptions<api.ApiCollectionItem[] | null, Error> {
  return {
    queryKey: queryKeys.collectionItems(mock, query),
    queryFn: ({ signal }) => ds.getCollectedItems(query, signal),
  };
}

/** `useQuery` options for one chapter's collected page indices. Loaded once per chapter open; the
 *  reader drives its heart off the result rather than checking per page. */
export function chapterPageIndicesQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  seriesId: string,
  chapterId: string,
): UseQueryOptions<number[], Error> {
  return {
    queryKey: queryKeys.chapterPageIndices(mock, bridgeId, seriesId, chapterId),
    queryFn: ({ signal }) => ds.getChapterPageIndices(bridgeId, seriesId, chapterId, signal),
  };
}

/** `useQuery` options for the user's collections. */
export function collectionsQuery(ds: DataSource, mock: boolean): UseQueryOptions<Collection[], Error> {
  return {
    queryKey: queryKeys.collections(mock),
    queryFn: ({ signal }) => ds.getCollections(signal),
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

/** `useQuery` options for the composed Home surface (rails + grid sections). `keepPreviousData`
 *  keeps the prior bridge's Home on screen while the new one loads instead of clearing to a
 *  skeleton — so the shared list instance (and the filter bar in its header) never unmounts on a
 *  bridge switch. `enabled` should gate on the Home tab being active AND this bridge's lists being
 *  loaded (see the screen). */
export function homeSectionsQuery(
  ds: DataSource,
  mock: boolean,
  bridgeId: string,
  enabled: boolean,
): UseQueryOptions<{ sections: RailSection[]; gridSections: HomeGridSection[] }, Error> {
  return {
    queryKey: queryKeys.homeSections(mock, bridgeId),
    queryFn: ({ signal }) => ds.getHomeSections(bridgeId, signal),
    enabled: enabled && !!bridgeId,
    placeholderData: keepPreviousData,
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

/** `useQuery` options for the unread feed count behind the Activity tab pip and the app-icon
 *  badge. Inbox-style: reading (or explicitly marking/clearing) is the only thing that drains it. */
export function activityCountQuery(ds: DataSource, mock: boolean): UseQueryOptions<number, Error> {
  return {
    queryKey: queryKeys.activityCount(mock),
    queryFn: ({ signal }) => ds.getActivityCount(signal),
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
