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
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as api from './api';
import * as mock from './mock';
import type {
  Bridge,
  BridgeList,
  GridPage,
  HomeGridSection,
  MetaCell,
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
  getSeriesDetail(
    bridgeId: string,
    seriesId: string,
    opts?: { direct?: boolean; bridgeName?: string; title?: string },
    signal?: AbortSignal,
  ): Promise<SeriesDetail>;
  getChapterPages(bridgeId: string, seriesId: string, chapterId: string, signal?: AbortSignal): Promise<string[]>;
  getDirectPages(bridgeId: string, seriesId: string, signal?: AbortSignal): Promise<string[]>;
  /** Lazy per-page thumbnail for a `SeriesDetail.pageThumbs` entry that came back `null`. Resolves
   *  to `null` (rather than throwing) for "not supported" and for `sprite`-kind thumbnails, which
   *  have no RN crop renderer yet — either way the caller's placeholder just stays. */
  getPageThumb(bridgeId: string, seriesId: string, pageIndex: number, signal?: AbortSignal): Promise<string | null>;
}

// ─── Real data source: adapts api.ts's server-shaped responses to the UI types ──

function toSeriesEntry(e: api.ApiSeriesEntry): SeriesEntry {
  return { id: e.id, title: e.title, sub: e.subtitle, cover: e.thumbnailUrl ?? '', badges: e.badges, excluded: e.excluded };
}

function toGridPage(p: api.PagedResults<api.ApiSeriesEntry>): GridPage {
  return { items: p.items.map(toSeriesEntry), hasNextPage: p.hasNextPage };
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

  async getSeriesDetail(bridgeId, seriesId, opts = {}, signal) {
    const info = await api.getSeriesDetail(bridgeId, seriesId, signal);
    const base: SeriesDetail = {
      id: info.id,
      title: info.title,
      cover: info.thumbnailUrl ?? '',
      bridge: opts.bridgeName ?? '',
      description: info.description,
      genres: info.genres,
      tagGroups: info.tagGroups,
      meta: buildMeta(info),
      relatedGroups: info.relatedSeriesGroups?.map((g) => ({ label: g.label, items: g.series.map(toSeriesEntry) })),
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
          .map((p) => (p.thumbnail?.kind === 'image' ? p.thumbnail.url : null));
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
      return t.kind === 'image' ? t.url : null;
    } catch {
      return null;
    }
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
  getSeriesDetail: (bridgeId, seriesId, opts) => mock.mockGetSeriesDetail(bridgeId, seriesId, opts),
  getChapterPages: (bridgeId, seriesId, chapterId) => mock.mockGetChapterPages(bridgeId, seriesId, chapterId),
  getDirectPages: (bridgeId, seriesId) => mock.mockGetDirectPages(bridgeId, seriesId),
  // Mock series always populate every pageThumbs entry inline (see mockGetSeriesDetail), so this
  // is never actually called — implemented only to satisfy the DataSource contract.
  getPageThumb: () => Promise.resolve(null),
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
  return useMockActive() ? mockDataSource : realDataSource;
}
