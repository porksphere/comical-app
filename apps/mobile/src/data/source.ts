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
import { useMemo } from 'react';
import { use$ } from '@legendapp/state/react';
import { useDataEpoch } from './data-epoch';

import { seriesListSchema } from '@comical/contract';

import { logDiagnostic } from '@/lib/diagnostics';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
import { persisted$ } from '@/lib/observable';
import * as api from './api';
import * as mock from './mock';
import { DIRECT_DOWNLOAD_CHAPTER_ID } from './downloads/constants';
import { localChapterPages } from './downloads/index-cache';
import type {
  ActivityEntry,
  Bridge,
  BridgeList,
  Chapter,
  ChapterProgress,
  GridPage,
  HistoryEntry,
  HomeGridSection,
  LibraryItem,
  Collection,
  MetaCell,
  PageThumbSource,
  RailKind,
  RailSection,
  SeriesDetail,
  SeriesEntry,
  SeriesListResult,
  TrackerLink,
  TrackerSearchResult,
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
  /** One page of a list. `cursor` is the previous page's `nextCursor`, opaque here; omit it to start
   *  from the beginning. */
  getGridPage(
    bridgeId: string,
    listId: string,
    cursor?: api.Cursor,
    opts?: QueryOpts,
    signal?: AbortSignal,
  ): Promise<GridPage>;
  search(bridgeId: string, query: string, cursor?: api.Cursor, opts?: QueryOpts, signal?: AbortSignal): Promise<GridPage>;
  getFilters(bridgeId: string, signal?: AbortSignal): Promise<api.ApiFilter[]>;
  getSortOptions(bridgeId: string, signal?: AbortSignal): Promise<api.ApiSortOption[]>;
  getTags(bridgeId: string, query: string, signal?: AbortSignal): Promise<{ value: string; label: string }[]>;
  getFavorites(bridgeId: string, cursor?: api.Cursor, signal?: AbortSignal): Promise<GridPage>;
  isFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean>;
  addFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;
  removeFavorite(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;

  // ─── Local library / history / activity ─────────────────────────────────────
  // The host's own cross-bridge collection (distinct from a bridge's `favorites`). `getLibrary`
  // resolves to `null` when no library store is mounted, so screens render a "needs a library"
  // state instead of an error — the on-device embedded runtime and older servers may lack one.

  /** The library grid, or `null` when this server/runtime has no library store.
   *  `collectionId`/`uncollected` filter by collection membership (joined host-side). */
  getLibrary(
    opts: { q?: string; sort?: api.LibrarySort; collectionId?: string; uncollected?: boolean },
    signal?: AbortSignal,
  ): Promise<LibraryItem[] | null>;
  isInLibrary(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<boolean>;

  /** A bridge's favorites classified against the library, for the import confirmation dialog.
   *  Read-only — nothing is added until `importBridgeFavorites`. */
  getFavoritesImportPreview(bridgeId: string, signal?: AbortSignal): Promise<api.FavoritesImportPreview>;
  /** Import the confirmed selection into the library. Omitting `items` imports everything. */
  importBridgeFavorites(
    bridgeId: string,
    items?: api.FavoritesImportItem[],
    signal?: AbortSignal,
  ): Promise<api.FavoritesImportResult>;

  // ─── Collections ────────────────────────────────────────────────────────────
  /** The user's collections (ascending order); `[]` when no library store is mounted. */
  getCollections(signal?: AbortSignal): Promise<Collection[]>;
  createCollection(name: string, signal?: AbortSignal): Promise<Collection>;
  renameCollection(id: string, name: string, signal?: AbortSignal): Promise<void>;
  reorderCollections(orderedIds: string[], signal?: AbortSignal): Promise<void>;
  deleteCollection(id: string, signal?: AbortSignal): Promise<void>;
  /** Replace a series' collection memberships. Writes the series ITEM first (idempotent), since
   *  memberships hang off that item rather than the library entry. Passing an EMPTY array removes
   *  the item — an item exists only as a member of something. */
  setSeriesCollections(
    bridgeId: string,
    seriesId: string,
    collectionIds: string[],
    snap: { seriesTitle: string; thumbnailUrl?: string; author?: string },
    signal?: AbortSignal,
  ): Promise<void>;
  /** A series' current collection memberships; `[]` when it isn't filed anywhere. */
  getSeriesCollections(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<string[]>;

  // ─── Collected page items ───────────────────────────────────────────────────
  /** Collected items, or `null` when no library store is mounted. **Pass `type: 'page'`** for a
   *  page grid — omitting it returns the mixed series/chapter/page union. */
  getCollectedItems(query: api.CollectedItemsQuery, signal?: AbortSignal): Promise<api.ApiCollectionItem[] | null>;
  /** The collected page indices for one chapter (stale items excluded). One call per chapter open. */
  getChapterPageIndices(bridgeId: string, seriesId: string, chapterId: string, signal?: AbortSignal): Promise<number[]>;
  /** Re-anchor a chapter's collected pages against a freshly-fetched page list. Prefer this over
   *  `getChapterPageIndices` when the reader already holds the list. */
  reconcileChapterPages(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    pages: api.ChapterPageRef[],
    signal?: AbortSignal,
  ): Promise<{ indices: number[]; repaired: number; stale: number }>;
  /** Collect one page. Idempotent and merging — safe to repeat, and safe to send partially. */
  collectPage(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    pageIndex: number,
    snapshot: api.PageItemSnapshotBody,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Remove a collected page. */
  uncollectPage(bridgeId: string, seriesId: string, chapterId: string, pageIndex: number, signal?: AbortSignal): Promise<void>;
  /** Collect a chapter. Send `number`/`languageCode` when known — they are its re-anchor identity. */
  collectChapter(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    snapshot: api.ChapterItemSnapshotBody,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Remove a collected chapter. */
  uncollectChapter(bridgeId: string, seriesId: string, chapterId: string, signal?: AbortSignal): Promise<void>;
  /** Replace a chapter's collection memberships; an empty array removes the item. */
  setChapterCollections(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    collectionIds: string[],
    signal?: AbortSignal,
  ): Promise<void>;
  /** Replace a page's collection memberships; an empty array removes the item. */
  setPageCollections(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    pageIndex: number,
    collectionIds: string[],
    signal?: AbortSignal,
  ): Promise<void>;
  /** Wipe a series' read state — every chapter's read flag and the resume point. The only call that
   *  destroys it, and it works on an uncollected series so orphaned progress can be reclaimed. */
  resetReadProgress(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;
  /** Record read progress for a *library* series (updates its resume cache). */
  recordChapterProgress(
    bridgeId: string,
    seriesId: string,
    chapterId: string,
    update: { lastPage?: number; pageCount?: number; chapterName?: string },
    signal?: AbortSignal,
  ): Promise<void>;
  /** Persisted read state for one series' chapters. Empty for a series that isn't in the library
   *  (it has nowhere to store progress), so this is safe to call for any series. */
  getChapterProgress(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<ChapterProgress[]>;
  /** Set the read flag on specific chapters (the chapter row's "Mark as read"/"unread"). Pass every
   *  copy of the logical chapter so a multi-scanlator row flips as a whole. Library-only: the host
   *  404s a series that isn't in the library. */
  setChaptersRead(
    bridgeId: string,
    seriesId: string,
    chapters: Chapter[],
    read: boolean,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Mark everything up to and including `chapterId` read, in reading order. The host derives that
   *  order (and the language lane) from `chapters`, so pass the series' full list. Library-only. */
  markReadUpTo(
    bridgeId: string,
    seriesId: string,
    chapters: Chapter[],
    chapterId: string,
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
  /** Unread new-chapter count across the whole feed — items leave it only when their chapter is
   *  read (or their entry is cleared), never by merely looking at the tab. */
  getActivityCount(signal?: AbortSignal): Promise<number>;
  /** Mark one series' feed chapters read (the Activity row's "Mark read" swipe). Doesn't move the
   *  resume pointer or history — dismissing a feed row is not reading. */
  markActivityRead(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;
  /** Scan the library for new chapters. `force` re-checks every entry (the user-facing
   *  "Check for updates"); without it the host skips recently-synced entries, and
   *  `budgetMs`/`trackers: false` keep OS background windows short. */
  checkForUpdates(
    opts?: { force?: boolean; budgetMs?: number; trackers?: boolean },
    signal?: AbortSignal,
  ): Promise<{ newChapters: number; partial: boolean }>;
  /** Empty the new-chapters feed (user "clear" action). */
  clearActivity(signal?: AbortSignal): Promise<void>;
  /** Drop one series' entries from the feed (the Activity row's swipe-away — a series' coalesced new
   *  chapters clear together). */
  removeActivityEntry(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<void>;
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
  /** Lazy per-page thumbnail for a `SeriesListResult.pageThumbs` entry that came back `null`. Resolves
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
  /** Set (or clear via `null`) a bridge's persistent content-rating ceiling (capability
   *  "content-rating"). */
  putMaxContentRating(bridgeId: string, rating: api.ContentRating | null, signal?: AbortSignal): Promise<void>;
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
  /** Begin an in-app OAuth round trip for an `oauth-callback` setting field: returns the
   *  provider's `authUrl` to open in a browser. */
  startTrackerOAuth(
    trackerId: string,
    key: string,
    settings?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ authUrl: string }>;

  /** This series' tracker links (empty array = none linked yet). */
  getTrackerLinks(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<TrackerLink[]>;
  /** Link this series to a tracker's catalog entry. */
  linkTracker(
    bridgeId: string,
    seriesId: string,
    trackerId: string,
    externalId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Unlink one tracker from this series. */
  unlinkTracker(bridgeId: string, seriesId: string, trackerId: string, signal?: AbortSignal): Promise<void>;
  /** Two-way sync one series' tracker link with its tracker (the manual per-row "Sync" action):
   *  whichever side has read further wins. */
  syncTrackerLink(
    bridgeId: string,
    seriesId: string,
    trackerId: string,
    signal?: AbortSignal,
  ): Promise<api.TrackerLinkSyncResult>;
  /** Catalog search on a tracker, for the "+ Link tracker" form. */
  searchTrackerCatalog(trackerId: string, query: string, cursor?: api.Cursor, signal?: AbortSignal): Promise<TrackerSearchResult[]>;

  /** Registries the user has added, or `null` when this server has no registry support mounted. */
  getRegistries(signal?: AbortSignal): Promise<api.SavedRegistry[] | null>;
  /** Available updates for installed registry bridges, or `null` without registry support. */
  checkRegistryUpdates(signal?: AbortSignal): Promise<api.RegistryUpdateInfo[] | null>;
  /** Available updates for installed registry trackers, or `null` without registry support. */
  checkRegistryTrackerUpdates(signal?: AbortSignal): Promise<api.RegistryUpdateInfo[] | null>;
  /** Returns the saved row — the caller needs its `pendingAdoption` to offer the adoption prompt. */
  addRegistry(url: string, requireSignature?: boolean, signal?: AbortSignal): Promise<api.SavedRegistry | null>;
  removeRegistry(url: string, signal?: AbortSignal): Promise<void>;
  /**
   * The user's answer to a registry-move claim it couldn't verify on its own — see `pendingMove` /
   * `pendingAdoption` on `SavedRegistry`. Confirming repoints everything installed from the old URL.
   */
  confirmRegistryMove(url: string, signal?: AbortSignal): Promise<string>;
  dismissRegistryMove(url: string, signal?: AbortSignal): Promise<void>;
  adoptRegistry(newUrl: string, oldUrl: string, signal?: AbortSignal): Promise<void>;
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
  // Spread conditionally so the key is genuinely ABSENT on a last page rather than present-and-
  // undefined. These pages are serialized into the persisted query cache, where the two are the same
  // thing on the way out but not on the way in — keeping them identical here means a rehydrated page
  // ends the walk exactly like a freshly fetched one.
  return { items: p.items.map(toSeriesEntry), ...(p.nextCursor ? { nextCursor: p.nextCursor } : {}) };
}

/** THE one place the collected-series wire shape is read. The library dissolved into collections,
 *  so `/library` serves `CollectionSeriesItem`s: `title` → `seriesTitle`, `addedAt` → `collectedAt`.
 *  Absorbing both renames here is what kept the change off every library screen. */
function toLibraryItem(e: api.ApiCollectedSeries): LibraryItem {
  return {
    bridgeId: e.bridgeId,
    seriesId: e.seriesId,
    title: e.seriesTitle,
    ...(e.thumbnailUrl !== undefined && { thumbnailUrl: e.thumbnailUrl }),
    ...(e.author !== undefined && { author: e.author }),
    unread: e.unreadCount,
    collectedAt: e.collectedAt,
    ...(e.lastReadAt !== undefined && { lastReadAt: e.lastReadAt }),
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

/** Back to the contract's `Chapter` shape, for the routes that take a chapter list as input
 *  (`read-up-to`). The app's `Chapter` renames `publishedAt` to `date` and carries a derived `read`
 *  flag the host has no field for; everything else is already contract-shaped. */
function toApiChapter(c: Chapter): { id: string; name: string; number?: number; languageCode?: string; group?: string; publishedAt?: number } {
  return {
    id: c.id,
    name: c.name,
    ...(c.number !== undefined && { number: c.number }),
    ...(c.languageCode !== undefined && { languageCode: c.languageCode }),
    ...(c.group !== undefined && { group: c.group }),
    ...(c.date ? { publishedAt: c.date } : {}),
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

/** Exported for `fetchBridgeFeaturedRail` (queries.ts), which builds a single rail for the Comical
 *  aggregate home and needs the same layout→kind mapping `getHomeSections` uses. */
export const railKindFor = (layout: BridgeList['layout']): RailKind =>
  layout === 'hero' ? 'hero' : layout === 'ranked' ? 'ranked' : 'regular';

/**
 * Every list-layout hint the bridge contract defines — read straight from the contract's schema, so
 * a layout added to the contract flows through here (and into the custom-page section editor's
 * content-type picker) automatically, with no hand-kept list to drift. Order matches the schema.
 */
export const LIST_LAYOUTS = seriesListSchema.shape.layout.unwrap().options;
/** Exported so the Home screen can shape its loading skeleton (rail rows vs. grid blocks) to match
 *  a bridge's actual section layout before content resolves — see `getHomeSections` below, which
 *  partitions on this same predicate once items are in hand. */
export const isRailLayout = (layout: BridgeList['layout']) =>
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
        const page = await api.getSeriesListItems(bridgeId, l.id, undefined, undefined, signal);
        return { list: l, items: page.items.map(toSeriesEntry), nextCursor: page.nextCursor };
      }),
    );
    const sections: RailSection[] = [];
    const gridSections: HomeGridSection[] = [];
    for (const r of resolved) {
      if (r.items.length === 0) continue;
      if (isRailLayout(r.list.layout)) {
        sections.push({ id: r.list.id, title: r.list.name, kind: railKindFor(r.list.layout), items: r.items });
      } else {
        gridSections.push({
          id: r.list.id,
          title: r.list.name,
          items: r.items,
          ...(r.nextCursor ? { nextCursor: r.nextCursor } : {}),
        });
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

  async getGridPage(bridgeId, listId, cursor, opts, signal) {
    return toGridPage(await api.getSeriesListItems(bridgeId, listId, cursor, opts, signal));
  },

  async search(bridgeId, query, cursor, opts, signal) {
    return toGridPage(await api.searchBridge(bridgeId, query, cursor, opts, signal));
  },

  getFilters: (bridgeId, signal) => api.getFilters(bridgeId, signal),
  getSortOptions: (bridgeId, signal) => api.getSortOptions(bridgeId, signal),
  async getTags(bridgeId, query, signal) {
    const tags = await api.getTags(bridgeId, query, signal);
    return tags.map((t) => ({ value: t.id, label: t.label }));
  },

  async getFavorites(bridgeId, cursor, signal) {
    return toGridPage(await api.getFavorites(bridgeId, cursor, signal));
  },
  isFavorite: (bridgeId, seriesId, signal) => api.isFavorite(bridgeId, seriesId, signal),
  addFavorite: (bridgeId, seriesId, signal) => api.addFavorite(bridgeId, seriesId, signal),
  removeFavorite: (bridgeId, seriesId, signal) => api.removeFavorite(bridgeId, seriesId, signal),

  async getLibrary(opts, signal) {
    const entries = await api.getLibrary(opts, signal);
    return entries === null ? null : entries.map(toLibraryItem);
  },
  getCollections: (signal) => api.getCollections(signal),
  createCollection: (name, signal) => api.createCollection(name, signal),
  async renameCollection(id, name, signal) {
    await api.renameCollection(id, name, signal);
  },
  async reorderCollections(orderedIds, signal) {
    await api.reorderCollections(orderedIds, signal);
  },
  async deleteCollection(id, signal) {
    await api.deleteCollection(id, signal);
  },
  async setSeriesCollections(bridgeId, seriesId, collectionIds, snap, signal) {
    // Empty memberships means the item is gone: with pure collections an item exists only as a
    // member, so there is nothing to leave behind. (PUT collections: [] does the same server-side
    // and reports `{ removed: true }`; DELETE avoids needing the item to exist first.)
    if (collectionIds.length === 0) {
      await api.uncollectSeries(bridgeId, seriesId, signal);
      return;
    }
    // ONE call: the collect PUT files in the same request. Idempotent, so repeating it on every
    // membership change is safe and keeps the snapshot fresh.
    await api.collectSeries(bridgeId, seriesId, { ...snap, collectionIds }, signal);
  },
  getSeriesCollections: (bridgeId, seriesId, signal) => api.getSeriesCollections(bridgeId, seriesId, signal),
  getCollectedItems: (query, signal) => api.getCollectedItems(query, signal),
  getChapterPageIndices: (bridgeId, seriesId, chapterId, signal) =>
    api.getChapterPageIndices(bridgeId, seriesId, chapterId, signal),
  reconcileChapterPages: (bridgeId, seriesId, chapterId, pages, signal) =>
    api.reconcileChapterPages(bridgeId, seriesId, chapterId, pages, signal),
  async collectPage(bridgeId, seriesId, chapterId, pageIndex, snapshot, signal) {
    await api.collectPage(bridgeId, seriesId, chapterId, pageIndex, snapshot, signal);
  },
  uncollectPage: (bridgeId, seriesId, chapterId, pageIndex, signal) =>
    api.uncollectPage(bridgeId, seriesId, chapterId, pageIndex, signal),
  async setPageCollections(bridgeId, seriesId, chapterId, pageIndex, collectionIds, signal) {
    await api.setPageCollections(bridgeId, seriesId, chapterId, pageIndex, collectionIds, signal);
  },
  async collectChapter(bridgeId, seriesId, chapterId, snapshot, signal) {
    await api.collectChapter(bridgeId, seriesId, chapterId, snapshot, signal);
  },
  uncollectChapter: (bridgeId, seriesId, chapterId, signal) =>
    api.uncollectChapter(bridgeId, seriesId, chapterId, signal),
  async setChapterCollections(bridgeId, seriesId, chapterId, collectionIds, signal) {
    await api.setChapterCollections(bridgeId, seriesId, chapterId, collectionIds, signal);
  },
  isInLibrary: (bridgeId, seriesId, signal) => api.isInLibrary(bridgeId, seriesId, signal),
  getFavoritesImportPreview: (bridgeId, signal) => api.getFavoritesImportPreview(bridgeId, signal),
  importBridgeFavorites: (bridgeId, items, signal) => api.importBridgeFavorites(bridgeId, items, signal),
  async resetReadProgress(bridgeId, seriesId, signal) {
    await api.resetReadProgress(bridgeId, seriesId, signal);
  },
  async recordChapterProgress(bridgeId, seriesId, chapterId, update, signal) {
    await api.putChapterProgress(bridgeId, seriesId, chapterId, update, signal);
  },
  async getChapterProgress(bridgeId, seriesId, signal) {
    return (await api.getChapterProgress(bridgeId, seriesId, signal)).map((p) => ({
      chapterId: p.chapterId,
      read: p.read,
      ...(p.number !== undefined && { number: p.number }),
      ...(p.languageCode !== undefined && { languageCode: p.languageCode }),
    }));
  },
  async setChaptersRead(bridgeId, seriesId, chapters, read, signal) {
    // One write per copy — the host's read flag is per chapter id, and a logical chapter can have
    // several (one per scanlation group). Sequential, not Promise.all: they all patch the same
    // entry's progress document, so concurrent writes would race.
    for (const c of chapters) {
      await api.putChapterProgress(
        bridgeId,
        seriesId,
        c.id,
        { read, chapterName: c.name, ...(c.number !== undefined && { number: c.number }) },
        signal,
      );
    }
  },
  async markReadUpTo(bridgeId, seriesId, chapters, chapterId, signal) {
    await api.postReadUpTo(bridgeId, seriesId, chapters.map(toApiChapter), chapterId, signal);
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
  async markActivityRead(bridgeId, seriesId, signal) {
    await api.markActivityRead(bridgeId, seriesId, signal);
  },
  async checkForUpdates(opts = {}, signal) {
    const res = await api.runBackgroundSync(opts, signal);
    return { newChapters: res.newChapters, partial: res.partial };
  },
  async clearActivity(signal) {
    await api.clearActivity(signal);
  },
  async removeActivityEntry(bridgeId, seriesId, signal) {
    await api.deleteActivityEntry(bridgeId, seriesId, signal);
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
      // Carry `kind` (so the genre group is identifiable — genres are just a `kind: "genre"` group)
      // plus the per-tag `tagIds`/`tagQueries` (index-parallel to `tags`) so a tapped chip can drive a
      // filter/search — see chip.tsx + search-intent.ts.
      tagGroups: info.tagGroups?.map((g) => ({
        label: g.label,
        kind: g.kind,
        tags: g.tags,
        tagIds: g.tagIds,
        tagQueries: g.tagQueries,
      })),
      meta: buildMeta(info),
      relatedGroups,
      relatedGroupsDeferred: !info.relatedSeriesGroups,
      listDeferred: true,
    };
    // The host flags a response served from the library's offline metadata cache with additive
    // fields on the SeriesInfo shape — carry them through so the page can show the affordance.
    const offline = info as { cached?: boolean; cachedAt?: number };
    if (offline.cached) {
      base.cached = true;
      if (offline.cachedAt !== undefined) base.cachedAt = offline.cachedAt;
      // A captured cover arrives as the host's server-relative cover route — resolve it into
      // something <Image> can load (remote: apiBase-prefixed URL; embedded: an in-process data URI).
      // Best-effort: an unresolvable cover just leaves the hero on its normal fallback path.
      if (base.cover.startsWith('/')) {
        base.cover = await api.resolveAssetSourceCached(base.cover).catch(() => base.cover);
      }
    }
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
      // A fully-downloaded direct series has every page's bytes on disk (under the reserved direct
      // chapter id, exactly what the reader serves offline). Reuse them as the preview grid's
      // thumbnails — expo-image downscales each to the tile and the grid is virtualized, so only
      // visible pages decode, at no extra storage cost. Only complete downloads are indexed, so array
      // position lines up with the reader's page index just like the bridge path below.
      const localGrid = (): SeriesListResult | undefined => {
        const local = localChapterPages(bridgeId, seriesId, DIRECT_DOWNLOAD_CHAPTER_ID);
        if (!local) return undefined;
        return {
          chapterCount: local.length,
          readLabel: '▶  Read',
          pageThumbs: local.map((url): PageThumbSource => ({ kind: 'image', url })),
        };
      };

      let pages;
      try {
        pages = await api.getSeriesPages(bridgeId, seriesId, signal);
      } catch (e) {
        // Bridge unreachable (offline): fall back to the downloaded copy's grid if we have it.
        const offline = localGrid();
        if (offline) return offline;
        throw e;
      }

      const result: SeriesListResult = { chapterCount: pages.length, readLabel: '▶  Read' };
      // Mirrors comical-web: only show the preview grid when the bridge actually supplies cheap
      // thumbnails somewhere in the list — never bulk-load full-resolution page images as a
      // stand-in. Sorted by index so array position lines up with the reader's page index (the
      // grid's "start" param depends on this), with `null` gaps `PageThumbGrid` fetches lazily.
      const withThumb = pages.filter((p) => p.thumbnail).length;
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
        return result;
      }
      // The bridge supplies no inline thumbnails. If the series is downloaded, fill the grid from its
      // local page bytes rather than showing no grid at all; otherwise leave it thumbless (as before,
      // where `PageThumbGrid` isn't rendered and the page falls back to the Read button alone).
      const downloaded = localGrid();
      if (downloaded) return { ...downloaded, chapterCount: pages.length };
      logDiagnostic('series-pages-no-thumbs', `${pages.length} page(s), 0 with an inline thumbnail`, {
        context: `bridge=${bridgeId} series=${seriesId}`,
      });
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
    // Offline serving: a fully-downloaded chapter serves its local `file://` pages directly — instant,
    // works with the network off, and each URI (absolute) passes straight through `resolveAssetSource`
    // untouched. On a bridge/network error, fall back to the downloaded copy if we have one.
    const local = localChapterPages(bridgeId, seriesId, chapterId);
    if (local) return local;
    try {
      const pages = await api.getChapterPages(bridgeId, seriesId, chapterId, signal);
      return [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl);
    } catch (e) {
      const fallback = localChapterPages(bridgeId, seriesId, chapterId);
      if (fallback) return fallback;
      throw e;
    }
  },

  async getDirectPages(bridgeId, seriesId, signal) {
    // Offline serving for a direct (chapterless) series — filed under the reserved direct chapter id.
    const local = localChapterPages(bridgeId, seriesId, DIRECT_DOWNLOAD_CHAPTER_ID);
    if (local) return local;
    try {
      const pages = await api.getSeriesPages(bridgeId, seriesId, signal);
      // Return the raw (possibly server-relative) page paths WITHOUT resolving them here. Some bridges
      // make each `imageUrl` a lazy resolve-route that costs a rate-limited network round-trip; resolving
      // all of them up front (Promise.all over the whole gallery) fires hundreds of parallel requests
      // that overflow the bridge's queue and hit its per-call timeout (BridgeTimeoutError). ReaderPage
      // resolves each lazily via resolveAssetSourceCached as it scrolls into the render window, so only
      // visible pages pay that cost. Absolute URLs pass straight through, so bridges that already return
      // direct CDN URLs behave exactly as before.
      return [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl);
    } catch (e) {
      const fallback = localChapterPages(bridgeId, seriesId, DIRECT_DOWNLOAD_CHAPTER_ID);
      if (fallback) return fallback;
      throw e;
    }
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
  async putMaxContentRating(bridgeId, rating, signal) {
    await api.putMaxContentRating(bridgeId, rating, signal);
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
  startTrackerOAuth: (trackerId, key, settings, signal) => api.startTrackerOAuth(trackerId, key, settings, signal),

  async getTrackerLinks(bridgeId, seriesId, signal) {
    const links = await api.getTrackerLinks(bridgeId, seriesId, signal);
    return links.map((l) => ({
      trackerId: l.trackerId,
      externalId: String(l.externalId),
      ...(l.chaptersRead !== undefined ? { chaptersRead: l.chaptersRead } : {}),
      ...(l.lastSyncAt !== undefined ? { lastSyncAt: l.lastSyncAt } : {}),
    }));
  },
  async linkTracker(bridgeId, seriesId, trackerId, externalId, signal) {
    await api.linkTracker(bridgeId, seriesId, trackerId, externalId, signal);
  },
  async unlinkTracker(bridgeId, seriesId, trackerId, signal) {
    await api.unlinkTracker(bridgeId, seriesId, trackerId, signal);
  },
  syncTrackerLink: (bridgeId, seriesId, trackerId, signal) => api.syncTrackerLink(bridgeId, seriesId, trackerId, signal),
  async searchTrackerCatalog(trackerId, query, cursor, signal) {
    const res = await api.searchTrackerCatalog(trackerId, query, cursor, signal);
    return res.items.map((r) => ({
      externalId: String(r.externalId),
      title: r.title,
      ...(r.thumbnailUrl ? { thumbnailUrl: r.thumbnailUrl } : {}),
    }));
  },

  getRegistries: (signal) => api.getRegistries(signal),
  checkRegistryUpdates: (signal) => api.checkRegistryUpdates(signal),
  checkRegistryTrackerUpdates: (signal) => api.checkRegistryTrackerUpdates(signal),
  addRegistry: (url, requireSignature, signal) => api.addRegistry(url, requireSignature, signal),
  confirmRegistryMove: (url, signal) => api.confirmRegistryMove(url, signal),
  dismissRegistryMove: (url, signal) => api.dismissRegistryMove(url, signal),
  adoptRegistry: (newUrl, oldUrl, signal) => api.adoptRegistry(newUrl, oldUrl, signal),
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
  getGridPage: (bridgeId, listId, cursor) => mock.mockGetGridPage(bridgeId, listId, cursor),
  search: (bridgeId, query, cursor) => mock.mockSearch(bridgeId, query, cursor),
  getFilters: () => mock.mockGetFilters(),
  getSortOptions: () => mock.mockGetSortOptions(),
  getTags: (bridgeId, query) => mock.mockGetTags(query),
  getFavorites: () => mock.mockGetFavorites(),
  isFavorite: (bridgeId, seriesId) => mock.mockIsFavorite(seriesId),
  addFavorite: (bridgeId, seriesId) => mock.mockAddFavorite(seriesId),
  removeFavorite: (bridgeId, seriesId) => mock.mockRemoveFavorite(seriesId),

  getLibrary: (opts) => mock.mockGetLibrary(opts),
  getCollections: () => mock.mockGetCollections(),
  createCollection: (name) => mock.mockCreateCollection(name),
  renameCollection: (id, name) => mock.mockRenameCollection(id, name),
  reorderCollections: (orderedIds) => mock.mockReorderCollections(orderedIds),
  deleteCollection: (id) => mock.mockDeleteCollection(id),
  setSeriesCollections: (bridgeId, seriesId, collectionIds) =>
    mock.mockSetSeriesCollections(bridgeId, seriesId, collectionIds),
  resetReadProgress: (bridgeId, seriesId) => mock.mockResetReadProgress(bridgeId, seriesId),
  getSeriesCollections: (bridgeId, seriesId) => mock.mockGetSeriesCollections(bridgeId, seriesId),
  getCollectedItems: (query) => mock.mockGetCollectedItems(query),
  getChapterPageIndices: (bridgeId, seriesId, chapterId) =>
    mock.mockGetChapterPageIndices(bridgeId, seriesId, chapterId),
  reconcileChapterPages: (bridgeId, seriesId, chapterId, pages) =>
    mock.mockReconcileChapterPages(bridgeId, seriesId, chapterId, pages),
  collectPage: (bridgeId, seriesId, chapterId, pageIndex, snapshot) =>
    mock.mockCollectPage(bridgeId, seriesId, chapterId, pageIndex, snapshot),
  uncollectPage: (bridgeId, seriesId, chapterId, pageIndex) =>
    mock.mockUncollectPage(bridgeId, seriesId, chapterId, pageIndex),
  setPageCollections: (bridgeId, seriesId, chapterId, pageIndex, collectionIds) =>
    mock.mockSetPageCollections(bridgeId, seriesId, chapterId, pageIndex, collectionIds),
  collectChapter: (bridgeId, seriesId, chapterId, snapshot) =>
    mock.mockCollectChapter(bridgeId, seriesId, chapterId, snapshot),
  uncollectChapter: (bridgeId, seriesId, chapterId) =>
    mock.mockUncollectChapter(bridgeId, seriesId, chapterId),
  setChapterCollections: (bridgeId, seriesId, chapterId, collectionIds) =>
    mock.mockSetChapterCollections(bridgeId, seriesId, chapterId, collectionIds),
  isInLibrary: (bridgeId, seriesId) => mock.mockIsInLibrary(bridgeId, seriesId),
  getFavoritesImportPreview: (bridgeId) => mock.mockGetFavoritesImportPreview(bridgeId),
  importBridgeFavorites: (bridgeId, items) => mock.mockImportBridgeFavorites(bridgeId, items),
  recordChapterProgress: (bridgeId, seriesId, chapterId, update) =>
    mock.mockRecordChapterProgress(bridgeId, seriesId, chapterId, update),
  getChapterProgress: (bridgeId, seriesId) => mock.mockGetChapterProgress(bridgeId, seriesId),
  setChaptersRead: (bridgeId, seriesId, chapters, read) =>
    mock.mockSetChaptersRead(bridgeId, seriesId, chapters, read),
  markReadUpTo: (bridgeId, seriesId, chapters, chapterId) =>
    mock.mockMarkReadUpTo(bridgeId, seriesId, chapters, chapterId),
  recordReadingHistory: (entry) => mock.mockRecordReadingHistory(entry),
  getHistory: () => mock.mockGetHistory(),
  removeHistoryEntry: (bridgeId, seriesId) => mock.mockRemoveHistoryEntry(bridgeId, seriesId),
  getActivity: () => mock.mockGetActivity(),
  getActivityCount: () => mock.mockGetActivityCount(),
  markActivityRead: (bridgeId, seriesId) => mock.mockMarkActivityRead(bridgeId, seriesId),
  checkForUpdates: () => mock.mockCheckForUpdates(),
  clearActivity: () => mock.mockClearActivity(),
  removeActivityEntry: (bridgeId, seriesId) => mock.mockClearActivityForEntry(bridgeId, seriesId),
  getSeriesDetail: (bridgeId, seriesId, opts) => mock.mockGetSeriesDetail(bridgeId, seriesId, opts),
  // Like real bridges, mock series defer the chapter list / page-thumbnail grid to this
  // call (mockGetSeriesDetail flags `listDeferred`), so both paths share one code flow.
  getSeriesList: (bridgeId, seriesId, direct) => mock.mockGetSeriesList(bridgeId, seriesId, direct),
  getChapterPages: (bridgeId, seriesId, chapterId) => mock.mockGetChapterPages(bridgeId, seriesId, chapterId),
  getDirectPages: (bridgeId, seriesId) => mock.mockGetDirectPages(bridgeId, seriesId),
  // mockGetSeriesList populates every pageThumbs entry inline (no `null` gaps), so this
  // lazy per-tile fetch is never actually called — implemented only to satisfy the contract.
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
  putMaxContentRating: (bridgeId, rating) => mock.mockPutMaxContentRating(bridgeId, rating),
  getBridgePrefs: (bridgeId) => mock.mockGetBridgePrefs(bridgeId),
  putBridgePrefs: (bridgeId, update) => mock.mockPutBridgePrefs(bridgeId, update),

  getTrackers: () => mock.mockGetTrackers(),
  getTrackerSettings: (trackerId) => mock.mockGetTrackerSettings(trackerId),
  putTrackerSettings: (trackerId, values) => mock.mockPutTrackerSettings(trackerId, values),
  updateTracker: (trackerId) => mock.mockUpdateTracker(trackerId),
  uninstallTracker: (trackerId) => mock.mockUninstallTracker(trackerId),
  // Mock settings never surface an oauth-callback field (mockGetTrackerSettings returns no
  // settings at all), so this is never actually invoked — implemented only to satisfy the
  // DataSource contract.
  startTrackerOAuth: () => Promise.resolve({ authUrl: '' }),

  getTrackerLinks: (bridgeId, seriesId) => mock.mockGetTrackerLinks(bridgeId, seriesId),
  linkTracker: (bridgeId, seriesId, trackerId, externalId) => mock.mockLinkTracker(bridgeId, seriesId, trackerId, externalId),
  unlinkTracker: (bridgeId, seriesId, trackerId) => mock.mockUnlinkTracker(bridgeId, seriesId, trackerId),
  syncTrackerLink: (bridgeId, seriesId, trackerId) => mock.mockSyncTrackerLink(bridgeId, seriesId, trackerId),
  searchTrackerCatalog: (trackerId, query) => Promise.resolve(mock.mockTrackerSearch(trackerId, query)),

  getRegistries: () => mock.mockGetRegistries(),
  // Mock installs are always current — no update pip in mock/demo mode.
  checkRegistryUpdates: () => Promise.resolve([]),
  checkRegistryTrackerUpdates: () => Promise.resolve([]),
  addRegistry: async (url, requireSignature) => {
    await mock.mockAddRegistry(url, requireSignature);
    return null;
  },
  removeRegistry: (url) => mock.mockRemoveRegistry(url),
  // No mock registry ever advertises a move, so these are unreachable in mock/demo mode.
  confirmRegistryMove: (url) => Promise.resolve(url),
  dismissRegistryMove: () => Promise.resolve(),
  adoptRegistry: () => Promise.resolve(),
  browseRegistryBridges: (url) => mock.mockBrowseRegistryBridges(url),
  browseRegistryTrackers: (url) => mock.mockBrowseRegistryTrackers(url),
  installRegistryBridge: (registryUrl, bridgeId) => mock.mockInstallRegistryBridge(registryUrl, bridgeId),
  installRegistryTracker: (registryUrl, trackerId) => mock.mockInstallRegistryTracker(registryUrl, trackerId),
};

// ─── Dev-only mock toggle + demo-build flag ──────────────────────────────────

const MOCK_TOGGLE_KEY = 'comical:devUseMockData';

/** Set only by the GH Pages preview workflow — see deploy-web.yml. */
export const IS_DEMO_MODE = process.env.EXPO_PUBLIC_COMICAL_DEMO_MODE === '1';

/** Set only by capture-demo.yml, which films the app for the README (see `apps/mobile/e2e/demo/`).
 *  Always paired with demo mode — it suppresses the chrome that exists to caveat a demo build, so
 *  on its own it would claim a real build is being filmed while hiding nothing worth hiding. */
export const IS_CAPTURE_MODE =
  IS_DEMO_MODE && process.env.EXPO_PUBLIC_COMICAL_CAPTURE_MODE === '1';

// Persisted dev-only toggle (Legend State; see `lib/observable.ts`). Holds the raw stored value; the
// `__DEV__` mask is applied at read, so a non-dev build always reports false and never activates mock
// via the toggle. The old store wrote '1'/'0', which parse back as truthy/falsy, so the key carries over.
const mockToggle$ = persisted$<boolean>(MOCK_TOGGLE_KEY, false);

/** The one source of truth for "is mock mode active", mirrored into the mock module so its simulated
 *  latency is a no-op in real mode no matter which screen calls it. Runs once at load (below) and on
 *  every toggle change, including the async hydrate. */
function syncMockActive(): void {
  mock.setMockActive(IS_DEMO_MODE || (__DEV__ && Boolean(mockToggle$.peek())));
}

// Seed the mock module's flag at load (before the async toggle read resolves), so the demo build
// (IS_DEMO_MODE) is mock-active immediately and every real build is mock-inactive from the start; then
// keep it in sync whenever the toggle changes or finishes hydrating.
syncMockActive();
mockToggle$.onChange(syncMockActive);

/** Dev-only: flip the "Use mock data" toggle and persist it locally. No-op outside `__DEV__`. */
export function setMockToggle(enabled: boolean): void {
  if (!__DEV__) return;
  mockToggle$.set(enabled);
}

/** Dev-only hook: [enabled, setEnabled] for the Settings screen's mock-data toggle. */
export function useMockDataToggle(): [boolean, (enabled: boolean) => void] {
  // `use$` is called UNCONDITIONALLY and the `__DEV__` mask applied to its result. Inlining it as
  // `__DEV__ && Boolean(use$(...))` puts a hook inside a `&&` short-circuit: legal-looking, but the
  // React Compiler can memoize that expression and skip re-evaluating it, which silently drops the
  // hook on some renders. That shifts every later hook in the calling component by three
  // (`use$` = useContext + useMemo + useSyncExternalStore) and crashes React's dispatcher with
  // "Cannot read properties of undefined (reading 'length')" out of `areHookInputsEqual`.
  const on = use$(mockToggle$);
  return [__DEV__ && Boolean(on), setMockToggle];
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `epoch` is deliberately unused INSIDE the memo: producing a new identity on a bump is the entire mechanism, so removing it as the rule suggests would silently stop every `ds`-keyed refetch.
  return useMemo(() => (mock ? mockDataSource : { ...realDataSource }), [mock, epoch]);
}

// NSFW visibility now lives in its own Legend State store; re-exported here so
// screens keep importing it from `@/data/source`.
export { useNsfwMode, useHideNsfw, type NsfwMode } from './nsfw';
