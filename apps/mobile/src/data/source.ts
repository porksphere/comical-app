/**
 * The single switch point between the real Comical API and mock data.
 *
 * Screens call `useDataSource()` and never import `api.ts` or `mock.ts`
 * directly. Mock data is reachable in exactly two cases, both compiled out of
 * a real production build:
 *   - `__DEV__` + the "Use mock data" toggle in Settings (persisted locally,
 *     dev builds only).
 *   - `EXPO_PUBLIC_COMICAL_DEMO_MODE=1`, set only by the GitHub Pages preview
 *     workflow (no backend to reach from static hosting) — see
 *     `components/demo-banner.tsx` for the accompanying "sample data" banner.
 * Everywhere else (including every real production build) `realDataSource`
 * is the only reachable path, and a failed fetch is a real error — no silent
 * fallback to fake content.
 */
import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDataEpoch } from './data-epoch';

import * as api from './api';
import * as mock from './mock';
import type {
  ActivityEntry,
  Bridge,
  BridgeList,
  GridPage,
  HistoryEntry,
  HomeGridSection,
  LibraryItem,
  MetaCell,
  PageThumbSource,
  RailKind,
  RailSection,
  SeriesDetail,
  SeriesEntry,
} from './types';

/**
 * Filter/sort choice to apply to a list or search fetch — see `filterValueToApi`
 * in filter-types.ts. `query` scopes a list fetch to a free-text search when
 * the list is `searchable`, instead of calling `search()`.
 */
export type QueryOpts = { query?: string; filters?: api.ApiFilterValue[]; sort?: api.ApiSortSelection };

export interface DataSource {
  getBridges(signal?: AbortSignal): Promise<Bridge[]>;
  getBridgeLists(bridgeId: string, signal?: AbortSignal): Promise<BridgeList[]>;
  getHomeSections(
    bridgeId: string,
    signal?: AbortSignal,
  ): Promise<{ sections: RailSection[]; gridSections: HomeGridSection[] }>;
  getGridPage(
    bridgeId: string,
    listId: string,
    page: number,
    opts?: QueryOpts,
    signal?: AbortSignal,
  ): Promise<GridPage>;
  search(bridgeId: string, query: string, page: number, opts?: QueryOpts, signal?: AbortSignal): Promise<GridPage>;
  getFilters(bridgeId: string, signal?: AbortSignal): Promise<api.ApiFilter[]>;
  getSortOptions(bridgeId: string, signal?: AbortSignal): Promise<api.ApiSortOption[]>;
  getTags(bridgeId: string, query: string, signal?: AbortSignal): Promise<{ value: string; label: string }[]>;
  getFavorites(bridgeId: string, page: number, signal?: AbortSignal): Promise<GridPage>;
  isFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean>;
  addFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;
  removeFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;

  // ─── Local library / history / activity ─────────────────────────────────────
  // The host's own cross-bridge collection (distinct from a bridge's `favorites`). `getLibrary`
  // resolves to `null` when no library store is mounted, so screens render a "needs a library"
  // state instead of an error — the on-device embedded runtime and older servers may lack one.

  /** The library grid, or `null` when this server/runtime has no library store. */
  getLibrary(opts: { q?: string; sort?: api.LibrarySort }, signal?: AbortSignal): Promise<LibraryItem[] | null>;
  isInLibrary(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean>;
  addToLibrary(bridgeId: string, seriesId: string, snap: api.LibrarySnapshot, signal?: AbortSignal): Promise<void>;
  removeFromLibrary(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;
  /** Record read progress for a *library* series (updates its resume cache). */
  recordChapterProgress(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    update: { lastPage?: number; pageCount?: number; chapterName?: string },
    signal?: AbortSignal,
  ): Promise<void>;
  /** Record a *non-library* read into the reading log (library reads persist via progress instead). */
  recordReadingHistory(
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
  ): Promise<void>;

  getHistory(signal?: AbortSignal): Promise<HistoryEntry[]>;
  removeHistoryEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;

  getActivity(signal?: AbortSignal): Promise<ActivityEntry[]>;
  getActivityCount(signal?: AbortSignal): Promise<number>;
  /** Scan the library for new chapters (the "Check for updates" action). */
  checkForUpdates(signal?: AbortSignal): Promise<void>;
  getSeriesDetail(
    bridgeId: string,
    seriesId: string,
    opts?: { direct?: boolean; bridgeName?: string; title?: string },
    signal?: AbortSignal,
  ): Promise<SeriesDetail>;
  getChapterPages(bridgeId: string, seriesId: string, chapterId: string, signal?: AbortSignal): Promise<string[]>;
  getDirectPages(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<string[]>;
  /** Lazy fallback for a series' related-series rails when `getSeriesDetail` came back with
   *  `relatedGroupsDeferred: true` — see that field's doc in types.ts. */
  getRelatedGroups(
    bridgeId: string,
    seriesId: string,
    signal?: AbortSignal,
  ): Promise<{ label: string; items: SeriesEntry[] }[]>;
  /** Lazy per-page thumbnail for a `SeriesDetail.pageThumbs` entry that came back `null`. Resolves
   *  to `null` (rather than throwing) for "not supported" — the caller's placeholder just stays. */
  getPageThumb(bridgeId: string, seriesId: string, pageIndex: number, signal?: AbortSignal): Promise<PageThumbSource | null>;

  // ─── Settings + registries (Settings screen only) ──────────────────────────

  /** Per-bridge summaries with settings status, for the Settings screen's Bridges section. */
  getBridgeSummaries(signal?: AbortSignal): Promise<api.BridgeSummary[]>;
  getBridgeSettings(bridgeId: string, signal?: AbortSignal): Promise<api.BridgeSettingsInfo>;
  putBridgeSettings(bridgeId: string, values: Record<string, api.SettingValue>, signal?: AbortSignal): Promise<void>;
  /** Update a registry-installed bridge to its latest version. */
  updateBridge(bridgeId: string, signal?: AbortSignal): Promise<void>;
  /** Uninstall a registry-installed bridge. */
  uninstallBridge(bridgeId: string, signal?: AbortSignal): Promise<void>;

  /** Replace a bridge's persistent tag exclusions (capability "exclude-tags"). */
  putExcludedTags(bridgeId: string, tags: { id: string; label: string }[], signal?: AbortSignal): Promise<void>;
  /** Account-wide genre exclusions for a bridge (capability "exclude-genres"). */
  getGenreExclusions(bridgeId: string, signal?: AbortSignal): Promise<api.GenreExclusions>;
  putGenreExclusions(bridgeId: string, genres: string[], signal?: AbortSignal): Promise<void>;
  /** Per-bridge library prefs (tracker sync / reading-history opt-out), or `null` when this
   *  server has no library store mounted. */
  getBridgePrefs(bridgeId: string, signal?: AbortSignal): Promise<api.BridgePrefs | null>;
  putBridgePrefs(
    bridgeId: string,
    update: { trackersDisabled?: boolean; historyDisabled?: boolean },
    signal?: AbortSignal,
  ): Promise<void>;

  /** The mounted trackers, or `null` when this server has no `TrackerManager` (an expected,
   *  non-error state — the Settings screen renders "not available" rather than an error banner). */
  getTrackers(signal?: AbortSignal): Promise<api.TrackerSummary[] | null>;
  getTrackerSettings(trackerId: string, signal?: AbortSignal): Promise<api.TrackerSettingsInfo>;
  putTrackerSettings(trackerId: string, values: Record<string, api.SettingValue>, signal?: AbortSignal): Promise<void>;
  updateTracker(trackerId: string, signal?: AbortSignal): Promise<void>;
  uninstallTracker(trackerId: string, signal?: AbortSignal): Promise<void>;

  /** Registries the user has added, or `null` when this server has no registry support mounted. */
  getRegistries(signal?: AbortSignal): Promise<api.SavedRegistry[] | null>;
  addRegistry(url: string, requireSignature?: boolean, signal?: AbortSignal): Promise<void>;
  removeRegistry(url: string, signal?: AbortSignal): Promise<void>;
  browseRegistryBridges(url: string, signal?: AbortSignal): Promise<api.AvailableBridge[]>;
  browseRegistryTrackers(url: string, signal?: AbortSignal): Promise<api.AvailableTracker[]>;
  installRegistryBridge(registryUrl: string, bridgeId: string, signal?: AbortSignal): Promise<void>;
  installRegistryTracker(registryUrl: string, trackerId: string, signal?: AbortSignal): Promise<void>;
}

// ─── Real data source: adapts api.ts's server-shaped responses to the UI types ──

function toSeriesEntry(e: api.ApiSeriesEntry): SeriesEntry {
  return { id: e.id, title: e.title, sub: e.subtitle, cover: e.thumbnailUrl ?? '', badges: e.badges, excluded: e.excluded };
}

function toGridPage(p: api.PagedResults<api.ApiSeriesEntry>): GridPage {
  return { items: p.items.map(toSeriesEntry), hasNextPage: p.hasNextPage };
}

function toLibraryItem(e: api.ApiLibraryEntry): LibraryItem {
  return {
    bridgeId: e.bridgeId,
    seriesId: e.seriesId,
    title: e.title,
    ...(e.thumbnailUrl !== undefined && { thumbnailUrl: e.thumbnailUrl }),
    ...(e.author !== undefined && { author: e.author }),
    unread: e.unreadCount,
  };
}

function toHistoryEntry(h: api.ApiHistoryItem): HistoryEntry {
  return {
    bridgeId: h.bridgeId,
    seriesId: h.seriesId,
    title: h.title,
    ...(h.thumbnailUrl !== undefined && { thumbnailUrl: h.thumbnailUrl }),
    ...(h.lastReadChapterId !== undefined && { chapterId: h.lastReadChapterId }),
    ...(h.lastReadChapterName !== undefined && { chapterName: h.lastReadChapterName }),
    ...(h.lastPage !== undefined && { lastPage: h.lastPage }),
    ...(h.pageCount !== undefined && { pageCount: h.pageCount }),
    lastReadAt: h.lastReadAt,
  };
}

function toActivityEntry(a: api.ApiActivityItem): ActivityEntry {
  return {
    bridgeId: a.bridgeId,
    seriesId: a.seriesId,
    chapterId: a.chapterId,
    title: a.title,
    ...(a.thumbnailUrl !== undefined && { thumbnailUrl: a.thumbnailUrl }),
    ...(a.chapterName !== undefined && { chapterName: a.chapterName }),
    ...(a.number !== undefined && { number: a.number }),
    detectedAt: a.detectedAt,
    read: a.read,
  };
}

const railKindFor = (layout: BridgeList['layout']): RailKind =>
  layout === 'hero' ? 'hero' : layout === 'ranked' ? 'ranked' : 'regular';
const isRailLayout = (layout: BridgeList['layout']) =>
  layout === 'carousel' || layout === 'ranked' || layout === 'hero';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function buildMeta(info: api.ApiSeriesInfo): MetaCell[] {
  const meta: MetaCell[] = [];
  if (info.status && info.status !== 'unknown') meta.push({ label: 'STATUS', value: capitalize(info.status) });
  if (info.type) meta.push({ label: 'TYPE', value: info.type });
  if (info.author) meta.push({ label: 'AUTHOR', value: info.author });
  if (info.artist) meta.push({ label: 'ARTIST', value: info.artist });
  return meta;
}

/** Adapts a contract `ApiPageThumbnail` into the UI-facing `PageThumbSource` — same `image`/
 *  `sprite` union, but resolves a sprite's `sheetUrl` in case a bridge returned it server-relative
 *  (the contract documents asset URLs as "absolute or server-relative", same as `Page.imageUrl`).
 *  Drops a sprite missing `sheetHeight` — the contract keeps it optional for forward
 *  compatibility, but the crop renderer needs it to scale the tile, so treat that case like "no
 *  thumbnail" rather than rendering a distorted crop. */
function toPageThumbSource(t: api.ApiPageThumbnail | undefined): PageThumbSource | null {
  if (!t) return null;
  if (t.kind === 'image') return { kind: 'image', url: t.url };
  if (t.sheetHeight == null) return null;
  return {
    kind: 'sprite',
    sheetUrl: api.resolveAssetUrl(t.sheetUrl),
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    sheetWidth: t.sheetWidth,
    sheetHeight: t.sheetHeight,
  };
}

const realDataSource: DataSource = {
  getBridges: (signal) => api.getBridges(signal),
  getBridgeLists: (bridgeId, signal) => api.getBridgeLists(bridgeId, signal),

  async getHomeSections(bridgeId, signal) {
    const lists = await api.getBridgeLists(bridgeId, signal);
    const homeLists = lists.filter((l) => !l.page);
    // Fetch every home list's first page in parallel, but partition into rails vs.
    // grid sections AFTER all resolve, preserving `homeLists`' original order —
    // `Promise.all` keeps result-array order aligned with the input regardless of
    // resolution timing, so a `for` loop over it is safe; pushing inside the async
    // callbacks themselves would not be.
    const resolved = await Promise.all(
      homeLists.map(async (l) => {
        const page = await api.getSeriesListItems(bridgeId, l.id, 1, undefined, signal);
        return { list: l, items: page.items.map(toSeriesEntry), hasNextPage: page.hasNextPage };
      }),
    );
    const sections: RailSection[] = [];
    const gridSections: HomeGridSection[] = [];
    for (const r of resolved) {
      if (r.items.length === 0) continue;
      if (isRailLayout(r.list.layout)) {
        sections.push({ id: r.list.id, title: r.list.name, kind: railKindFor(r.list.layout), items: r.items });
      } else {
        gridSections.push({ id: r.list.id, title: r.list.name, items: r.items, hasNextPage: r.hasNextPage });
      }
    }
    return { sections, gridSections };
  },

  async getGridPage(bridgeId, listId, page, opts, signal) {
    return toGridPage(await api.getSeriesListItems(bridgeId, listId, page, opts, signal));
  },

  async search(bridgeId, query, page, opts, signal) {
    return toGridPage(await api.searchBridge(bridgeId, query, page, opts, signal));
  },

  getFilters: (bridgeId, signal) => api.getFilters(bridgeId, signal),
  getSortOptions: (bridgeId, signal) => api.getSortOptions(bridgeId, signal),
  async getTags(bridgeId, query, signal) {
    const tags = await api.getTags(bridgeId, query, signal);
    return tags.map((t) => ({ value: t.id, label: t.label }));
  },

  async getFavorites(bridgeId, page, signal) {
    return toGridPage(await api.getFavorites(bridgeId, page, signal));
  },
  isFavorite: (bridgeId, seriesId, signal) => api.isFavorite(bridgeId, seriesId, signal),
  addFavorite: (bridgeId, seriesId, signal) => api.addFavorite(bridgeId, seriesId, signal),
  removeFavorite: (bridgeId, seriesId, signal) => api.removeFavorite(bridgeId, seriesId, signal),

  async getLibrary(opts, signal) {
    const entries = await api.getLibrary(opts, signal);
    return entries === null ? null : entries.map(toLibraryItem);
  },
  isInLibrary: (bridgeId, seriesId, signal) => api.isInLibrary(bridgeId, seriesId, signal),
  async addToLibrary(bridgeId, seriesId, snap, signal) {
    await api.addLibraryEntry(bridgeId, seriesId, snap, signal);
  },
  async removeFromLibrary(bridgeId, seriesId, signal) {
    await api.removeLibraryEntry(bridgeId, seriesId, signal);
  },
  async recordChapterProgress(bridgeId, seriesId, chapterId, update, signal) {
    await api.putChapterProgress(bridgeId, seriesId, chapterId, update, signal);
  },
  async recordReadingHistory(entry, signal) {
    await api.recordReadingHistory(entry, signal);
  },
  async getHistory(signal) {
    return (await api.getHistory(undefined, signal)).map(toHistoryEntry);
  },
  async removeHistoryEntry(bridgeId, seriesId, signal) {
    await api.deleteHistoryEntry(bridgeId, seriesId, signal);
  },
  async getActivity(signal) {
    return (await api.getActivity(signal)).map(toActivityEntry);
  },
  async getActivityCount(signal) {
    return (await api.getActivityCount(signal)).unread;
  },
  async checkForUpdates(signal) {
    await api.runBackgroundSync(signal);
  },

  async getSeriesDetail(bridgeId, seriesId, opts = {}, signal) {
    const info = await api.getSeriesDetail(bridgeId, seriesId, signal);
    // Bridges with capability "related-series" (e.g. example-bridge) omit `relatedSeriesGroups` from the
    // main response and provide it via a separate endpoint instead — see contract's SeriesInfo docs.
    // Leave `relatedGroups` unset and flag `relatedGroupsDeferred` rather than fetching it inline
    // here: that fetch can be slow, and awaiting it would hold up the rest of the series page (and
    // its skeleton) just for a rail at the bottom. The series screen fetches it separately via
    // `getRelatedGroups` once this query resolves, showing a rail skeleton in the meantime.
    const relatedGroups = info.relatedSeriesGroups?.map((g) => ({
      label: g.label,
      items: g.series.map(toSeriesEntry),
    }));
    const base: SeriesDetail = {
      id: info.id,
      title: info.title,
      cover: info.thumbnailUrl ?? '',
      bridge: opts.bridgeName ?? '',
      description: info.description,
      genres: info.genres,
      // Carry the per-tag `tagIds`/`tagQueries` through (dropping the UI-unused
      // `kind`) so a tapped tag chip can drive a filter/search — see chip.tsx +
      // browse-intent.ts. Both are index-parallel to `tags`.
      tagGroups: info.tagGroups?.map((g) => ({
        label: g.label,
        tags: g.tags,
        tagIds: g.tagIds,
        tagQueries: g.tagQueries,
      })),
      meta: buildMeta(info),
      relatedGroups,
      relatedGroupsDeferred: !info.relatedSeriesGroups,
    };
    if (opts.direct) {
      const pages = await api.getSeriesPages(bridgeId, seriesId, signal);
      // Mirrors comical-web: only show the preview grid when the bridge actually supplies cheap
      // thumbnails somewhere in the list — never bulk-load full-resolution page images as a
      // stand-in. Sorted by index so array position lines up with the reader's page index (the
      // grid's "start" param depends on this), with `null` gaps `PageThumbGrid` fetches lazily.
      if (pages.some((p) => p.thumbnail)) {
        base.pageThumbs = [...pages]
          .sort((a, b) => a.index - b.index)
          .map((p) => toPageThumbSource(p.thumbnail));
      }
      base.readLabel = '▶  Read';
      base.chapterCount = info.pageCount ?? pages.length;
    } else {
      const chapters = await api.getChapters(bridgeId, seriesId, signal);
      base.chapters = chapters.map((c) => ({ id: c.id, name: c.name, date: c.publishedAt ?? 0, read: false }));
      base.chapterCount = chapters.length;
      base.readLabel = chapters.length ? `▶  ${chapters[0].name}` : undefined;
    }
    return base;
  },

  async getChapterPages(bridgeId, seriesId, chapterId, signal) {
    const pages = await api.getChapterPages(bridgeId, seriesId, chapterId, signal);
    return [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl);
  },

  async getDirectPages(bridgeId, seriesId, signal) {
    const pages = await api.getSeriesPages(bridgeId, seriesId, signal);
    return [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl);
  },

  async getPageThumb(bridgeId, seriesId, pageIndex, signal) {
    try {
      const t = await api.getPageThumb(bridgeId, seriesId, pageIndex, signal);
      return toPageThumbSource(t);
    } catch {
      return null;
    }
  },

  async getRelatedGroups(bridgeId, seriesId, signal) {
    const groups = await api.getRelatedSeries(bridgeId, seriesId, signal);
    return groups.map((g) => ({ label: g.label, items: g.series.map(toSeriesEntry) }));
  },

  getBridgeSummaries: (signal) => api.getBridgeSummaries(signal),
  getBridgeSettings: (bridgeId, signal) => api.getBridgeSettings(bridgeId, signal),
  async putBridgeSettings(bridgeId, values, signal) {
    await api.putBridgeSettings(bridgeId, values, signal);
  },
  async updateBridge(bridgeId, signal) {
    await api.updateBridge(bridgeId, signal);
  },
  async uninstallBridge(bridgeId, signal) {
    await api.uninstallBridge(bridgeId, signal);
  },
  async putExcludedTags(bridgeId, tags, signal) {
    const labels: Record<string, string> = {};
    for (const t of tags) if (t.label && t.label !== t.id) labels[t.id] = t.label;
    await api.putExcludedTags(bridgeId, tags.map((t) => t.id), labels, signal);
  },
  getGenreExclusions: (bridgeId, signal) => api.getGenreExclusions(bridgeId, signal),
  async putGenreExclusions(bridgeId, genres, signal) {
    await api.putGenreExclusions(bridgeId, genres, signal);
  },
  getBridgePrefs: (bridgeId, signal) => api.getBridgePrefs(bridgeId, signal),
  async putBridgePrefs(bridgeId, update, signal) {
    await api.putBridgePrefs(bridgeId, update, signal);
  },

  getTrackers: (signal) => api.getTrackers(signal),
  getTrackerSettings: (trackerId, signal) => api.getTrackerSettings(trackerId, signal),
  async putTrackerSettings(trackerId, values, signal) {
    await api.putTrackerSettings(trackerId, values, signal);
  },
  async updateTracker(trackerId, signal) {
    await api.updateTracker(trackerId, signal);
  },
  async uninstallTracker(trackerId, signal) {
    await api.uninstallTracker(trackerId, signal);
  },

  getRegistries: (signal) => api.getRegistries(signal),
  async addRegistry(url, requireSignature, signal) {
    await api.addRegistry(url, requireSignature, signal);
  },
  async removeRegistry(url, signal) {
    await api.removeRegistry(url, signal);
  },
  browseRegistryBridges: (url, signal) => api.browseRegistryBridges(url, signal),
  browseRegistryTrackers: (url, signal) => api.browseRegistryTrackers(url, signal),
  async installRegistryBridge(registryUrl, bridgeId, signal) {
    await api.installRegistryBridge(registryUrl, bridgeId, signal);
  },
  async installRegistryTracker(registryUrl, trackerId, signal) {
    await api.installRegistryTracker(registryUrl, trackerId, signal);
  },
};

// ─── Mock data source: thin wrapper over mock.ts's generators ───────────────

const mockDataSource: DataSource = {
  getBridges: () => mock.mockGetBridges(),
  getBridgeLists: (bridgeId) => mock.mockGetBridgeLists(bridgeId),
  getHomeSections: (bridgeId) => mock.mockGetHomeSections(bridgeId),
  getGridPage: (bridgeId, listId, page) => mock.mockGetGridPage(bridgeId, listId, page),
  search: (bridgeId, query, page) => mock.mockSearch(bridgeId, query, page),
  getFilters: () => mock.mockGetFilters(),
  getSortOptions: () => mock.mockGetSortOptions(),
  getTags: (bridgeId, query) => mock.mockGetTags(query),
  getFavorites: (bridgeId, page) => mock.mockGetFavorites(page),
  isFavorite: (bridgeId, seriesId) => mock.mockIsFavorite(seriesId),
  addFavorite: (bridgeId, seriesId) => mock.mockAddFavorite(seriesId),
  removeFavorite: (bridgeId, seriesId) => mock.mockRemoveFavorite(seriesId),

  getLibrary: (opts) => mock.mockGetLibrary(opts),
  isInLibrary: (bridgeId, seriesId) => mock.mockIsInLibrary(bridgeId, seriesId),
  addToLibrary: (bridgeId, seriesId, snap) => mock.mockAddToLibrary(bridgeId, seriesId, snap),
  removeFromLibrary: (bridgeId, seriesId) => mock.mockRemoveFromLibrary(bridgeId, seriesId),
  recordChapterProgress: (bridgeId, seriesId, chapterId, update) =>
    mock.mockRecordChapterProgress(bridgeId, seriesId, chapterId, update),
  recordReadingHistory: (entry) => mock.mockRecordReadingHistory(entry),
  getHistory: () => mock.mockGetHistory(),
  removeHistoryEntry: (bridgeId, seriesId) => mock.mockRemoveHistoryEntry(bridgeId, seriesId),
  getActivity: () => mock.mockGetActivity(),
  getActivityCount: () => mock.mockGetActivityCount(),
  checkForUpdates: () => mock.mockCheckForUpdates(),
  getSeriesDetail: (bridgeId, seriesId, opts) => mock.mockGetSeriesDetail(bridgeId, seriesId, opts),
  getChapterPages: (bridgeId, seriesId, chapterId) => mock.mockGetChapterPages(bridgeId, seriesId, chapterId),
  getDirectPages: (bridgeId, seriesId) => mock.mockGetDirectPages(bridgeId, seriesId),
  // Mock series always populate every pageThumbs entry inline (see mockGetSeriesDetail), so this
  // is never actually called — implemented only to satisfy the DataSource contract.
  getPageThumb: () => Promise.resolve(null),
  // Mock series always populate `relatedGroups` inline (never set `relatedGroupsDeferred`), so
  // this is never actually called — implemented only to satisfy the DataSource contract.
  getRelatedGroups: () => Promise.resolve([]),

  getBridgeSummaries: () => mock.mockGetBridgeSummaries(),
  getBridgeSettings: (bridgeId) => mock.mockGetBridgeSettings(bridgeId),
  putBridgeSettings: (bridgeId, values) => mock.mockPutBridgeSettings(bridgeId, values),
  updateBridge: (bridgeId) => mock.mockUpdateBridge(bridgeId),
  uninstallBridge: (bridgeId) => mock.mockUninstallBridge(bridgeId),
  putExcludedTags: (bridgeId, tags) => mock.mockPutExcludedTags(bridgeId, tags),
  getGenreExclusions: (bridgeId) => mock.mockGetGenreExclusions(bridgeId),
  putGenreExclusions: (bridgeId, genres) => mock.mockPutGenreExclusions(bridgeId, genres),
  getBridgePrefs: (bridgeId) => mock.mockGetBridgePrefs(bridgeId),
  putBridgePrefs: (bridgeId, update) => mock.mockPutBridgePrefs(bridgeId, update),

  getTrackers: () => mock.mockGetTrackers(),
  getTrackerSettings: (trackerId) => mock.mockGetTrackerSettings(trackerId),
  putTrackerSettings: (trackerId, values) => mock.mockPutTrackerSettings(trackerId, values),
  updateTracker: (trackerId) => mock.mockUpdateTracker(trackerId),
  uninstallTracker: (trackerId) => mock.mockUninstallTracker(trackerId),

  getRegistries: () => mock.mockGetRegistries(),
  addRegistry: (url, requireSignature) => mock.mockAddRegistry(url, requireSignature),
  removeRegistry: (url) => mock.mockRemoveRegistry(url),
  browseRegistryBridges: (url) => mock.mockBrowseRegistryBridges(url),
  browseRegistryTrackers: (url) => mock.mockBrowseRegistryTrackers(url),
  installRegistryBridge: (registryUrl, bridgeId) => mock.mockInstallRegistryBridge(registryUrl, bridgeId),
  installRegistryTracker: (registryUrl, trackerId) => mock.mockInstallRegistryTracker(registryUrl, trackerId),
};

// ─── Dev-only mock toggle + demo-build flag ──────────────────────────────────

const MOCK_TOGGLE_KEY = 'comical:devUseMockData';

/** Set only by the GH Pages preview workflow — see deploy-web.yml. */
export const IS_DEMO_MODE = process.env.EXPO_PUBLIC_COMICAL_DEMO_MODE === '1';

let mockToggleOn = false;
const listeners = new Set<() => void>();
function notifyMockToggleChange(): void {
  for (const l of listeners) l();
}
function subscribeMockToggle(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getMockToggleSnapshot(): boolean {
  return __DEV__ && mockToggleOn;
}
function getMockToggleServerSnapshot(): boolean {
  return false;
}

if (__DEV__) {
  AsyncStorage.getItem(MOCK_TOGGLE_KEY)
    .then((stored) => {
      mockToggleOn = stored === '1';
      notifyMockToggleChange();
    })
    .catch(() => {});
}

/** Dev-only: flip the "Use mock data" toggle and persist it locally. No-op outside `__DEV__`. */
export function setMockToggle(enabled: boolean): void {
  if (!__DEV__) return;
  mockToggleOn = enabled;
  notifyMockToggleChange();
  AsyncStorage.setItem(MOCK_TOGGLE_KEY, enabled ? '1' : '0').catch(() => {});
}

/** Dev-only hook: [enabled, setEnabled] for the Settings screen's mock-data toggle. */
export function useMockDataToggle(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeMockToggle, getMockToggleSnapshot, getMockToggleServerSnapshot);
  return [enabled, setMockToggle];
}

/** True whenever mock data should be used: the GH Pages demo build, or the dev toggle. */
export function useMockActive(): boolean {
  const [mockOn] = useMockDataToggle();
  return IS_DEMO_MODE || mockOn;
}

/** The data source screens should call: real API by default, mock only when explicitly enabled. */
export function useDataSource(): DataSource {
  const mock = useMockActive();
  const epoch = useDataEpoch();
  // Return a fresh reference whenever the epoch bumps (transport/registry change) so screens keying
  // effects on `ds` refetch. The spread keeps the same method implementations, just a new identity.
  return useMemo(() => (mock ? mockDataSource : { ...realDataSource }), [mock, epoch]);
}

// ─── Hide NSFW toggle (persisted, not dev-gated) ─────────────────────────────

const HIDE_NSFW_KEY = 'comical:hideNsfw';

let hideNsfwOn = false;
const hideNsfwListeners = new Set<() => void>();
function notifyHideNsfwChange(): void {
  for (const l of hideNsfwListeners) l();
}
function subscribeHideNsfw(listener: () => void): () => void {
  hideNsfwListeners.add(listener);
  return () => hideNsfwListeners.delete(listener);
}
function getHideNsfwSnapshot(): boolean {
  return hideNsfwOn;
}
function getHideNsfwServerSnapshot(): boolean {
  return false;
}

AsyncStorage.getItem(HIDE_NSFW_KEY)
  .then((stored) => {
    hideNsfwOn = stored === '1';
    notifyHideNsfwChange();
  })
  .catch(() => {});

function setHideNsfw(enabled: boolean): void {
  hideNsfwOn = enabled;
  notifyHideNsfwChange();
  AsyncStorage.setItem(HIDE_NSFW_KEY, enabled ? '1' : '0').catch(() => {});
}

/** [hideNsfw, setHideNsfw] — persisted app-wide, drives NSFW bridge filtering. */
export function useHideNsfw(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeHideNsfw, getHideNsfwSnapshot, getHideNsfwServerSnapshot);
  return [enabled, setHideNsfw];
}
