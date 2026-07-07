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
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDataEpoch } from './data-epoch';

import { logDiagnostic } from '@/lib/diagnostics';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
import * as api from './api';
import * as mock from './mock';
import type {
  ActivityEntry,
  Bridge,
  BridgeList,
  Chapter,
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
  SeriesListResult,
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
  /** Deferred chapter list (chaptered) or page-thumbnail grid (direct) for a series whose
   *  `getSeriesDetail` came back with `listDeferred: true` — the slow (~200ms) part, fetched
   *  separately so it never blocks the body render. */
  getSeriesList(bridgeId: string, seriesId: string, direct: boolean, signal?: AbortSignal): Promise<SeriesListResult>;
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
 *  `sprite` union. The asset URL is passed through RAW (possibly server-relative): the tile resolves
 *  it lazily as it scrolls into view (see `PageThumb`/`SpriteCrop`), so a long page grid doesn't
 *  resolve every thumbnail — and re-fetch a shared sprite sheet once per tile — up front. Drops a
 *  sprite missing `sheetHeight`: the crop renderer needs it to scale the tile, so treat that case
 *  like "no thumbnail" rather than rendering a distorted crop. */
function toPageThumbSource(t: api.ApiPageThumbnail | undefined): PageThumbSource | null {
  if (!t) return null;
  if (t.kind === 'image') return { kind: 'image', url: t.url };
  if (t.sheetHeight == null) return null;
  return {
    kind: 'sprite',
    sheetUrl: t.sheetUrl,
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
    // Home renders nothing at all when this comes back empty, with no error — log the shape so
    // that state (which list/item counts produced it) is inspectable instead of just "blank".
    if (sections.length === 0 && gridSections.length === 0) {
      logDiagnostic('home-sections-empty', `${lists.length} list(s), ${homeLists.length} non-page`, {
        context:
          `bridge=${bridgeId} ` +
          resolved.map((r) => `${r.list.id}(page=${!!r.list.page},items=${r.items.length})`).join(' '),
      });
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
    // Fetch ONLY the fast info payload (~2-9ms) and return immediately. The chapter
    // list / page-thumbnail grid is the ~200ms bottleneck (see getSeriesList), so
    // it is deferred: awaiting it here would hold the whole body — title, cover,
    // description, meta — behind that slow request (which is exactly why the page
    // felt slower than comical-web). The series screen renders this info at once and
    // streams the list in via `getSeriesList`, flagged by `listDeferred`.
    const info = await api.getSeriesDetail(bridgeId, seriesId, signal);
    // Bridges with capability "related-series" omit `relatedSeriesGroups` from the
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
      listDeferred: true,
    };
    if (opts.direct) {
      // Static/known-from-info parts render right away; the grid streams in later.
      base.readLabel = '▶  Read';
      base.chapterCount = info.pageCount;
    }
    // Chaptered: readLabel/chapterCount aren't known until the chapter list loads —
    // getSeriesList fills them; the Read button waits on that (see series.tsx).
    return base;
  },

  async getSeriesList(bridgeId, seriesId, direct, signal) {
    if (direct) {
      const pages = await api.getSeriesPages(bridgeId, seriesId, signal);
      const result: SeriesListResult = { chapterCount: pages.length, readLabel: '▶  Read' };
      // Mirrors comical-web: only show the preview grid when the bridge actually supplies cheap
      // thumbnails somewhere in the list — never bulk-load full-resolution page images as a
      // stand-in. Sorted by index so array position lines up with the reader's page index (the
      // grid's "start" param depends on this), with `null` gaps `PageThumbGrid` fetches lazily.
      const withThumb = pages.filter((p) => p.thumbnail).length;
      if (withThumb === 0) {
        logDiagnostic('series-pages-no-thumbs', `${pages.length} page(s), 0 with an inline thumbnail`, {
          context: `bridge=${bridgeId} series=${seriesId}`,
        });
      }
      if (withThumb > 0) {
        const sorted = [...pages].sort((a, b) => a.index - b.index);
        result.pageThumbs = sorted.map((p) => toPageThumbSource(p.thumbnail));
        // Only flag thumbnails that were PRESENT but unusable (a malformed sprite — missing
        // sheetHeight / unrecognized kind). A `null` for a page that simply had no inline thumbnail is
        // expected (many bridges only inline the first viewer page; the rest of the grid fetches them
        // lazily via getPageThumb) and must not be reported as dropped.
        const malformed = result.pageThumbs.filter((t, i) => t === null && !!sorted[i].thumbnail).length;
        if (malformed > 0) {
          logDiagnostic('page-thumb-dropped', `${malformed} inline thumbnail(s) present but unusable`, {
            context: `bridge=${bridgeId} series=${seriesId} (missing sheetHeight, or unrecognized kind)`,
          });
        }
      }
      return result;
    }
    const chapters: Chapter[] = (await api.getChapters(bridgeId, seriesId, signal)).map((c) => ({
      id: c.id,
      name: c.name,
      date: c.publishedAt ?? 0,
      read: false,
      ...(c.number !== undefined && { number: c.number }),
      ...(c.group !== undefined && { group: c.group }),
      ...(c.languageCode !== undefined && { languageCode: c.languageCode }),
      ...(c.pageCount !== undefined && { pageCount: c.pageCount }),
    }));
    // The Read label mirrors the Read button's target: the first chapter in reading
    // order (by number), not the raw array's first element (a newest-first layout the
    // bridge never promised).
    const first = firstChapterInReadingOrder(chapters);
    return {
      chapters,
      chapterCount: chapters.length,
      readLabel: first ? `▶  ${first.name}` : undefined,
    };
  },

  async getChapterPages(bridgeId, seriesId, chapterId, signal) {
    const pages = await api.getChapterPages(bridgeId, seriesId, chapterId, signal);
    return [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl);
  },

  async getDirectPages(bridgeId, seriesId, signal) {
    const pages = await api.getSeriesPages(bridgeId, seriesId, signal);
    // Return the raw (possibly server-relative) page paths WITHOUT resolving them here. Some bridges
    // make each `imageUrl` a lazy resolve-route that costs a rate-limited network round-trip; resolving
    // all of them up front (Promise.all over the whole gallery) fires hundreds of parallel requests
    // that overflow the bridge's queue and hit its per-call timeout (BridgeTimeoutError). ReaderPage
    // resolves each lazily via resolveAssetSourceCached as it scrolls into the render window, so only
    // visible pages pay that cost. Absolute URLs pass straight through, so bridges that already return
    // direct CDN URLs behave exactly as before.
    return [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl);
  },

  async getPageThumb(bridgeId, seriesId, pageIndex, signal) {
    try {
      const t = await api.getPageThumb(bridgeId, seriesId, pageIndex, signal);
      return toPageThumbSource(t);
    } catch (e) {
      // A lazy per-page thumbnail is best-effort — the tile just stays a skeleton. But don't swallow
      // the reason silently: surface it (skipping aborts and the expected "bridge has no per-page
      // thumbnails" 404) so a systematically-failing lookup — e.g. a fetch timeout or a proxy block on
      // later viewer pages — is visible instead of an unexplained blank grid past the inline range.
      const msg = (e as Error)?.message || String(e);
      if (!api.isAbort(e) && !msg.includes('not supported')) {
        logDiagnostic('page-thumb-fetch', msg, { context: `bridge=${bridgeId} series=${seriesId} page=${pageIndex}` });
      }
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
  // Mock series populate chapters/pageThumbs inline in mockGetSeriesDetail (and never set
  // `listDeferred`), so the screen never calls this — implemented only to satisfy the contract.
  getSeriesList: () => Promise.resolve({}),
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
/** The one source of truth for "is mock mode active", mirrored into the mock module so its simulated
 *  latency is a no-op in real mode no matter which screen calls it. Kept in sync at every point
 *  `mockToggleOn` changes (below), plus once at module load for the demo build. */
function syncMockActive(): void {
  mock.setMockActive(IS_DEMO_MODE || (__DEV__ && mockToggleOn));
}
function notifyMockToggleChange(): void {
  syncMockActive();
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

// Seed the mock module's flag at load (before the async toggle read below resolves), so the demo
// build (IS_DEMO_MODE) is mock-active immediately and every real build is mock-inactive from the start.
syncMockActive();

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

// ─── NSFW visibility (persisted, not dev-gated) ──────────────────────────────
//
// Four states, picked from Settings:
//   - 'off' / 'on': durable — written to disk, so they're still in effect after
//     the app is force-quit and relaunched.
//   - 'until-background': a session-only override that shows NSFW content, but
//     reverts to whichever durable mode is stored the moment the app is
//     backgrounded (minimized on iOS/Android) — not just on a full restart.
//   - 'until-restart': a session-only override that lasts for this process's
//     lifetime. It survives backgrounding (the JS process is still alive) but
//     is naturally gone after a cold start, since — like 'until-background' —
//     nothing is ever written to storage for it; the module reinitializes from
//     the durable value below.
export type NsfwMode = 'off' | 'on' | 'until-background' | 'until-restart';
type DurableNsfwMode = 'off' | 'on';

const NSFW_MODE_KEY = 'comical:nsfwMode';

let durableNsfwMode: DurableNsfwMode = 'off';
let nsfwMode: NsfwMode = 'off';
const nsfwModeListeners = new Set<() => void>();
function notifyNsfwModeChange(): void {
  for (const l of nsfwModeListeners) l();
}
function subscribeNsfwMode(listener: () => void): () => void {
  nsfwModeListeners.add(listener);
  return () => nsfwModeListeners.delete(listener);
}
function getNsfwModeSnapshot(): NsfwMode {
  return nsfwMode;
}
function getNsfwModeServerSnapshot(): NsfwMode {
  return 'off';
}

AsyncStorage.getItem(NSFW_MODE_KEY)
  .then((stored) => {
    durableNsfwMode = stored === 'on' ? 'on' : 'off';
    nsfwMode = durableNsfwMode;
    notifyNsfwModeChange();
  })
  .catch(() => {});

AppState.addEventListener('change', (state) => {
  if (state === 'background' && nsfwMode === 'until-background') {
    nsfwMode = durableNsfwMode;
    notifyNsfwModeChange();
  }
});

function setNsfwMode(mode: NsfwMode): void {
  nsfwMode = mode;
  if (mode === 'off' || mode === 'on') {
    durableNsfwMode = mode;
    AsyncStorage.setItem(NSFW_MODE_KEY, mode).catch(() => {});
  }
  notifyNsfwModeChange();
}

/** [mode, setMode] — the Settings screen's NSFW picker. */
export function useNsfwMode(): [NsfwMode, (mode: NsfwMode) => void] {
  const mode = useSyncExternalStore(subscribeNsfwMode, getNsfwModeSnapshot, getNsfwModeServerSnapshot);
  return [mode, setNsfwMode];
}

/** True whenever NSFW-flagged bridges/content should stay hidden — every screen
 *  that filters on NSFW (Browse, Library, History, Activity, the Settings
 *  bridge list) reads this instead of caring about the 4 underlying modes. */
export function useHideNsfw(): boolean {
  const [mode] = useNsfwMode();
  return mode === 'off';
}
