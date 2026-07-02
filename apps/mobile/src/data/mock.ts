/**
 * Mock data for the Browse and Series screens — a dev-only / GH-Pages-demo-only
 * stand-in for the real bridge API (see `source.ts` for where this is switched
 * in). Types live in `types.ts` and are shared with the real API adapter in
 * `api.ts`, so wiring real bridge data means replacing the generators below,
 * not the components that read them.
 */

import type {
  Bridge,
  BridgeList,
  Chapter,
  GridPage,
  HomeGridSection,
  MetaCell,
  RailSection,
  SeriesDetail,
  SeriesEntry,
  TagGroup,
  TrackerLink,
  TrackerSearchResult,
  TrackerService,
} from './types';
import type {
  ApiBridgeInfo,
  ApiFilter,
  ApiSortOption,
  BridgePrefs,
  BridgeSummary,
  BridgeSettingsInfo,
  GenreExclusions,
  TrackerSummary,
  TrackerSettingsInfo,
  SavedRegistry,
  AvailableBridge,
  AvailableTracker,
  SettingValue,
} from './api';

export type {
  BadgePosition,
  BadgeTone,
  CardBadge,
  Chapter,
  GridPage,
  MetaCell,
  RailKind,
  RailSection,
  SeriesDetail,
  SeriesEntry,
  TagGroup,
  TrackerLink,
  TrackerSearchResult,
  TrackerService,
} from './types';

/**
 * An intentionally very long title — used to exercise the card's clamp +
 * full-title peek (the title truncates with "…" and reveals on hover/hold).
 * Length is in the spirit of real bridge titles (e.g. light-novel adaptations).
 */
export const LONG_TITLE =
  'I Got a Cheat Skill in Another World and Became Unrivaled in the Real World, Too: The Saga of the Reincarnated Cartographer';

export const TITLES = [
  'The Silent Sea', 'Crimson Harbor', 'Paper Moons', 'A Study in Ash',
  'Northern Lights', 'The Glass Garden', 'Echoes of Tomorrow', 'Saltwater Hymns',
  'The Last Cartographer', 'Velvet Machine', 'Whisper of Pines', 'Iron & Ink',
  'Spirit Zone', 'Ashen Crown', 'Moonlit Vagrant', 'The Ninth Tower',
  LONG_TITLE,
];

const SUBS = [
  'Ch. 176 · 2h ago', 'Ch. 88 · 1d ago', 'Ch. 42 · 3d ago', 'Ch. 210 · 5h ago',
  'Ch. 12 · 1w ago', 'Ch. 305 · 12h ago',
];

export const cover = (seed: string | number) =>
  `https://picsum.photos/seed/comical-${seed}/300/450`;

/** Deterministic pseudo-random so a given id always yields the same entry. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Simulated network latency for a cover, in ms. Deterministic per id so a card
 * always behaves the same. Most covers are instant; ~40% load "slowly" (so the
 * skeleton is visible) — a stand-in for real bridge image latency.
 */
export function coverDelayMs(id: string): number {
  const h = hash(`cover:${id}`);
  if (h % 5 < 2) return 500 + (h % 2000); // ~0.5s–2.5s on ~40% of covers
  return 0;
}

/** Reader-resolution page image (taller than the 300×450 cover thumb). */
export const readerPage = (seed: string | number) =>
  `https://picsum.photos/seed/comical-${seed}/1080/1620`;

/**
 * Flat page list for a DIRECT series. Uses the same `${seed}-p${i}` seeds as
 * `mockSeries`' `pageThumbs`, so a page-thumbnail tap opens a matching image and
 * each page carries the same deterministic `coverDelayMs` latency as its thumb.
 */
export function readerPagesForDirect(seed: string, count = 60): string[] {
  return Array.from({ length: count }, (_, i) => readerPage(`${seed}-p${i}`));
}

/**
 * Per-chapter page list for a CHAPTERED series. Chapters carry no images in the
 * mock, so synthesize a deterministic page count + URLs from the chapter id.
 */
export function readerPagesForChapter(chapterId: string): string[] {
  const count = 8 + (hash(chapterId) % 25); // ~8–32 pages
  return Array.from({ length: count }, (_, i) => readerPage(`${chapterId}-p${i}`));
}

/** Simulated latency (ms) for opening a series detail. */
export const SERIES_OPEN_DELAY_MS = 900;
/** Simulated latency (ms) for loading the next infinite-scroll grid page. */
export const PAGE_LOAD_DELAY_MS = 900;
/** Simulated latency (ms) for a tracker link / unlink / sync action. */
export const TRACKER_ACTION_DELAY_MS = 500;

/** Available tracker services a series can be linked to. Mirrors the
 *  reference's `/trackers` registry (each bridge-agnostic, configured once in
 *  Settings and reused across every series). */
export const TRACKER_SERVICES: TrackerService[] = [
  { id: 'anilist', name: 'AniList' },
  { id: 'mal', name: 'MyAnimeList' },
  { id: 'kitsu', name: 'Kitsu' },
];

function entry(seed: string, i: number, opts: { badges?: boolean; unread?: boolean; sub?: boolean } = {}): SeriesEntry {
  const h = hash(seed);
  const e: SeriesEntry = {
    id: seed,
    title: TITLES[(h + i) % TITLES.length],
    cover: cover(seed),
  };
  if (opts.sub) e.sub = SUBS[(h + i) % SUBS.length];
  if (opts.badges && i % 3 === 0)
    e.badges = [{ text: 'NEW', position: 'top-left', tone: 'info' }];
  if (opts.badges && i % 4 === 1)
    e.badges = [{ text: 'HOT', position: 'top-left', tone: 'warn' }];
  if (opts.unread && i % 3 === 1) e.unread = 1 + (h % 9);
  return e;
}

function items(prefix: string, n: number, opts?: { badges?: boolean; unread?: boolean; sub?: boolean }): SeriesEntry[] {
  return Array.from({ length: n }, (_, i) => entry(`${prefix}-${i}`, i, opts));
}

/**
 * A page's stack of rails (hero / ranked / regular). Every top-level page
 * (home, popular, favorites, …) is its own full page, so the seed is salted
 * with the page name to give each one distinct cards while sharing the layout.
 */
export function mockHomeSections(page = 'home'): RailSection[] {
  const p = page === 'home' ? '' : `${page}-`;
  const featured = items(`${p}hero`, 6, { sub: true });
  // On home, force the lead featured card to carry the very long title (and a
  // stable id whose detail page also gets the "ton of tags" treatment) so the
  // clamp/peek and tag-wrapping can be checked from a known card.
  if (page === 'home') {
    featured[0] = { ...featured[0], id: 'featured-long', title: LONG_TITLE };
  }
  return [
    { id: `${p}featured`, title: 'Featured', kind: 'hero', items: featured },
    { id: `${p}trending`, title: 'Trending now', kind: 'ranked', items: items(`${p}rank`, 10, { sub: true }) },
    { id: `${p}updates`, title: 'Latest updates', kind: 'regular', items: items(`${p}upd`, 14, { badges: true, unread: true, sub: true }) },
    { id: `${p}popular`, title: 'Popular this season', kind: 'regular', items: items(`${p}pop`, 14, { badges: true }) },
    { id: `${p}newish`, title: 'Newly added', kind: 'regular', items: items(`${p}new`, 14, { badges: true }) },
  ];
}

/** Flat grid of results (search / "See all" / non-home page). */
export function mockGrid(prefix = 'grid', n = 30): SeriesEntry[] {
  return items(prefix, n, { badges: true, unread: true, sub: true });
}

const GENRES = ['Fantasy', 'Action', 'Adventure', 'Drama'];
const TAG_GROUPS: TagGroup[] = [
  { label: 'Themes', tags: ['Magic', 'Coming of Age', 'Nobility'] },
  { label: 'Demographic', tags: ['Shounen'] },
];
/** A deliberately large tag list, attached to one series, to test chip wrapping. */
const MANY_TAGS = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Harem', 'Isekai',
  'Magic', 'Martial Arts', 'Romance', 'School Life', 'Sci-Fi', 'Slice of Life',
  'Supernatural', 'Tragedy', 'Mystery', 'Horror', 'Psychological', 'Mecha',
  'Historical', 'Sports', 'Music', 'Seinen', 'Shounen', 'Demons',
  'Reincarnation', 'Time Travel', 'Game', 'Virtual Reality', 'Survival',
  'Revenge', 'Anti-Hero', 'Cultivation', 'Demon Lord', 'Dungeon', 'Monsters',
];
const META: MetaCell[] = [
  { label: 'STATUS', value: 'Ongoing' },
  { label: 'TYPE', value: 'Manhwa' },
  { label: 'AUTHOR', value: 'Chi-U Kim, kiraz' },
  { label: 'ARTIST', value: 'Themis' },
];
const DESCRIPTION =
  'After Sirone was abandoned in a stable, he was found by a family of hunters and ' +
  'raised in a loving home. Despite the hardships of the peasant life, he learned how ' +
  'to read from a young age and became obsessed with books, especially ones on the ' +
  'history of magic. One day, he has an unlikely encounter with a mage and learns how ' +
  'to enter the "spirit zone", the first step to learning how to use magic. Although ' +
  'they say only nobles can be mages, will Sirone be able to defy the odds?';

const DAY = 86_400_000;

function mockChapters(seed: string, count: number): Chapter[] {
  const h = hash(seed);
  const now = Date.now();
  // Newest first; the first ~40% are unread.
  return Array.from({ length: count }, (_, i) => {
    const num = count - i;
    return {
      id: `${seed}-ch-${num}`,
      name: `Chapter ${num}`,
      date: now - i * DAY * (1 + (h % 3)),
      read: i >= Math.floor(count * 0.4),
    };
  });
}

/** Deterministic 0–2 tracker links for a series, seeded off its id so a given
 *  series always opens with the same linked trackers / progress / sync time. */
function mockTrackerLinks(seed: string, chapterCount: number): TrackerLink[] {
  const h = hash(`trackers:${seed}`);
  const count = h % 3;
  return TRACKER_SERVICES.slice(0, count).map((s, i) => ({
    trackerId: s.id,
    externalId: String(10000 + ((h + i * 97) % 90000)),
    externalTitle: TITLES[(h + i) % TITLES.length],
    chaptersRead: chapterCount > 0 ? (h + i * 13) % chapterCount : 0,
    lastSyncAt: Date.now() - ((h + i * 53) % 14) * DAY,
  }));
}

/** Mock catalog search for the "+ Link tracker" form: substring-matches the
 *  shared title pool, standing in for a tracker's real search API. */
export function mockTrackerSearch(trackerId: string, query: string): TrackerSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return TITLES.filter((t) => t.toLowerCase().includes(q))
    .slice(0, 6)
    .map((title) => {
      const h = hash(`${trackerId}:${title}`);
      return { externalId: String(10000 + (h % 90000)), title, thumbnail: cover(`tracker-${h}`) };
    });
}

/**
 * Build a series detail. `id` seeds deterministic content; a couple of seeds
 * exercise the per-bridge-dynamic branches so the UI can be checked with and
 * without optional sections:
 *  - id containing "direct" → direct series (page thumbnails, no chapters)
 *  - id containing "bare"   → minimal bridge (no genres/tags/stats/related)
 */
export function mockSeries(
  id: string,
  title?: string,
  bridge = 'Library',
  opts: { direct?: boolean } = {},
): SeriesDetail {
  const seed = id || title || 'series';
  // Direct series carry page thumbnails and no chapter list. Driven by the
  // bridge (opts.direct, from its capabilities) or a "direct" seed for testing.
  const direct = opts.direct || seed.includes('direct');
  const bare = seed.includes('bare');
  const h = hash(seed);
  const chapterCount = 40 + (h % 160);

  const base: SeriesDetail = {
    id: seed,
    title: title || TITLES[h % TITLES.length],
    cover: cover(seed),
    bridge,
    chapterCount: direct ? undefined : chapterCount,
    description: DESCRIPTION,
    meta: META,
  };

  if (direct) {
    // Many pages so the "Show all" affordance and the per-tile load skeletons
    // are both exercised.
    base.pageThumbs = Array.from({ length: 60 }, (_, i) => cover(`${seed}-p${i}`));
    base.readLabel = '▶  Read';
  } else {
    const chapters = mockChapters(seed, chapterCount);
    base.chapters = chapters;
    base.readLabel = `▶  ${chapters[chapters.length - 1].name}`;
  }

  if (!bare) {
    base.genres = GENRES;
    // The long-title series doubles as the "ton of tags" case.
    base.tagGroups = seed.includes('long')
      ? [...TAG_GROUPS, { label: 'Tags', tags: MANY_TAGS }]
      : TAG_GROUPS;
    base.hasSources = h % 2 === 0;
    base.hasTrackers = true;
    base.trackers = mockTrackerLinks(seed, chapterCount);
    base.newCount = h % 5 === 0 ? 3 : undefined;
    // Two groups, so multi-group related rendering is exercisable in mock mode too.
    base.relatedGroups = [
      { label: 'Related', items: items(`${seed}-rel`, 12, { sub: true }) },
      { label: 'Similar', items: items(`${seed}-sim`, 8, { sub: true }) },
    ];
  }

  return base;
}

/** "2h ago" / "3d ago" / "Jan 5" relative time for chapter rows. */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── DataSource-shaped wrappers ──────────────────────────────────────────────
// The functions below give the mock generators above the same async shape as
// the real API (`api.ts`), so `source.ts` can switch between them uniformly.
// Only reachable via the dev-only mock toggle or the GH Pages demo build — see
// `source.ts`.

const MOCK_BRIDGE_NAMES = ['Panelfox', 'Inkwell', 'Driftpage', 'Nightshelf', 'Coldspine'];
const MOCK_DIRECT_BRIDGES = new Set(['Coldspine']);
const slugify = (name: string) => name.toLowerCase();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mockGetBridges(): Promise<Bridge[]> {
  return MOCK_BRIDGE_NAMES.map((name) => ({
    id: slugify(name),
    name,
    nsfw: false,
    capabilities: MOCK_DIRECT_BRIDGES.has(name)
      ? ['lists', 'search', 'direct', 'filters', 'sort']
      : ['lists', 'search', 'filters', 'sort'],
    thumbnail: `https://picsum.photos/seed/bridge-${slugify(name)}/100/100`,
  }));
}

export async function mockGetBridgeLists(_bridgeId: string): Promise<BridgeList[]> {
  return [
    { id: 'home', name: 'Home', page: false },
    { id: 'popular', name: 'Popular', page: true },
    { id: 'favorites', name: 'Favorites', page: true },
  ];
}

export async function mockGetHomeSections(
  _bridgeId: string,
): Promise<{ sections: RailSection[]; gridSections: HomeGridSection[] }> {
  // Simulate bridge-switch latency so the Browse screen's loading skeleton
  // (shown while this is in flight) is actually observable in mock/demo mode.
  await delay(PAGE_LOAD_DELAY_MS);
  // Two grid sections so the non-terminal "Load more" / terminal infinite-scroll
  // split (see types.ts's HomeGridSection doc) is exercisable in mock mode too.
  return {
    sections: mockHomeSections('home'),
    gridSections: [
      { id: 'staff-picks', title: 'Staff Picks', items: mockGrid('staff-picks', 12), hasNextPage: true },
      { id: 'home', title: 'Browse all', items: mockGrid('home', 24), hasNextPage: true },
    ],
  };
}

/** Infinite mock grid: always reports another page so infinite-scroll stays exercisable. Also
 *  delays the first page so sub-page switches (and "See all") show their loading skeleton. */
export async function mockGetGridPage(_bridgeId: string, listId: string, page: number): Promise<GridPage> {
  await delay(PAGE_LOAD_DELAY_MS);
  return { items: mockGrid(`${listId}-p${page}`, 24), hasNextPage: true };
}

/** Finite mock search results (3 pages), so the "end of results" case is reachable too. */
export async function mockSearch(_bridgeId: string, query: string, page: number): Promise<GridPage> {
  await delay(PAGE_LOAD_DELAY_MS);
  return { items: mockGrid(`${query || 'search'}-p${page}`, 24), hasNextPage: page < 3 };
}

export async function mockGetSeriesDetail(
  _bridgeId: string,
  seriesId: string,
  opts: { direct?: boolean; bridgeName?: string; title?: string } = {},
): Promise<SeriesDetail> {
  await delay(SERIES_OPEN_DELAY_MS);
  return mockSeries(seriesId, opts.title, opts.bridgeName ?? 'Library', { direct: opts.direct });
}

export async function mockGetChapterPages(_bridgeId: string, _seriesId: string, chapterId: string): Promise<string[]> {
  return readerPagesForChapter(chapterId);
}

export async function mockGetDirectPages(_bridgeId: string, seriesId: string): Promise<string[]> {
  return readerPagesForDirect(seriesId);
}

// ─── Filters, sort, tags, favorites ──────────────────────────────────────────

export async function mockGetFilters(): Promise<ApiFilter[]> {
  return [
    { type: 'multiselect', key: 'genre', label: 'Genres', options: GENRES.map((g) => ({ value: g, label: g })) },
    { type: 'toggle', key: 'ongoing', label: 'Ongoing only' },
    { type: 'tag-multiselect', key: 'tags', label: 'Tags', excludable: true },
  ];
}

export async function mockGetSortOptions(): Promise<ApiSortOption[]> {
  return [
    { key: 'relevance', label: 'Relevance' },
    { key: 'newest', label: 'Newest' },
    { key: 'title', label: 'Title' },
  ];
}

export async function mockGetTags(query: string): Promise<{ value: string; label: string }[]> {
  return MANY_TAGS.filter((t) => t.toLowerCase().includes(query.trim().toLowerCase())).map((t) => ({
    value: t,
    label: t,
  }));
}

const mockFavorites = new Set<string>();

export async function mockGetFavorites(page: number): Promise<GridPage> {
  if (page > 1) return { items: [], hasNextPage: false };
  return { items: [...mockFavorites].map((id) => entry(id, hash(id))), hasNextPage: false };
}

export async function mockIsFavorite(seriesId: string): Promise<boolean> {
  return mockFavorites.has(seriesId);
}

export async function mockAddFavorite(seriesId: string): Promise<void> {
  mockFavorites.add(seriesId);
}

export async function mockRemoveFavorite(seriesId: string): Promise<void> {
  mockFavorites.delete(seriesId);
}

// ─── Settings + registries ────────────────────────────────────────────────────
// Minimal, non-throwing stand-ins — Settings isn't a screen mock-data users will heavily
// exercise, so no fake registry catalog or bridge settings forms, just empty/no-op shapes.

export async function mockGetBridgeSummaries(): Promise<BridgeSummary[]> {
  const bridges = await mockGetBridges();
  return bridges.map((b) => ({ info: b, configured: true, missingRequired: [], source: 'local' }));
}

export async function mockGetBridgeSettings(bridgeId: string): Promise<BridgeSettingsInfo> {
  const bridges = await mockGetBridges();
  const b = bridges.find((b) => b.id === bridgeId) ?? bridges[0]!;
  const info: ApiBridgeInfo = {
    id: b.id,
    name: b.name,
    version: '1.0.0',
    contractVersion: '1',
    languages: ['en'],
    nsfw: b.nsfw,
    capabilities: b.capabilities as ApiBridgeInfo['capabilities'],
    iconUrl: b.thumbnail,
  };
  return {
    info,
    settings: [],
    values: {},
    secretsSet: [],
    missingRequired: [],
    configured: true,
    excludedTags: [],
    excludedTagLabels: {},
  };
}

export async function mockPutBridgeSettings(_bridgeId: string, _values: Record<string, SettingValue>): Promise<void> {}
export async function mockUpdateBridge(_bridgeId: string): Promise<void> {}
export async function mockUninstallBridge(_bridgeId: string): Promise<void> {}
export async function mockPutExcludedTags(_bridgeId: string, _tags: { id: string; label: string }[]): Promise<void> {}
export async function mockGetGenreExclusions(_bridgeId: string): Promise<GenreExclusions> {
  return { available: [], excluded: [] };
}
export async function mockPutGenreExclusions(_bridgeId: string, _genres: string[]): Promise<void> {}
export async function mockGetBridgePrefs(bridgeId: string): Promise<BridgePrefs> {
  return { bridgeId, trackersDisabled: false, historyDisabled: false };
}
export async function mockPutBridgePrefs(
  _bridgeId: string,
  _update: { trackersDisabled?: boolean; historyDisabled?: boolean },
): Promise<void> {}

export async function mockGetTrackers(): Promise<TrackerSummary[]> {
  return [];
}

export async function mockGetTrackerSettings(trackerId: string): Promise<TrackerSettingsInfo> {
  return { info: { id: trackerId, name: trackerId, capabilities: [] }, settings: [], values: {}, secretsSet: [] };
}

export async function mockPutTrackerSettings(_trackerId: string, _values: Record<string, SettingValue>): Promise<void> {}
export async function mockUpdateTracker(_trackerId: string): Promise<void> {}
export async function mockUninstallTracker(_trackerId: string): Promise<void> {}

const mockRegistries: SavedRegistry[] = [];

export async function mockGetRegistries(): Promise<SavedRegistry[]> {
  return mockRegistries;
}

export async function mockAddRegistry(url: string, requireSignature?: boolean): Promise<void> {
  mockRegistries.push({ url, name: url, requireSignature: requireSignature ?? false });
}

export async function mockRemoveRegistry(url: string): Promise<void> {
  const i = mockRegistries.findIndex((r) => r.url === url);
  if (i !== -1) mockRegistries.splice(i, 1);
}

export async function mockBrowseRegistryBridges(_url: string): Promise<AvailableBridge[]> {
  return [];
}

export async function mockBrowseRegistryTrackers(_url: string): Promise<AvailableTracker[]> {
  return [];
}

export async function mockInstallRegistryBridge(_registryUrl: string, _bridgeId: string): Promise<void> {}
export async function mockInstallRegistryTracker(_registryUrl: string, _trackerId: string): Promise<void> {}
