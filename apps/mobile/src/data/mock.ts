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
  PageThumbSource,
  RailSection,
  SeriesDetail,
  SeriesEntry,
  SeriesListResult,
  TagGroup,
  TrackerLink,
  TrackerSearchResult,
  TrackerService,
} from './types';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
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

/** A handful of cover box shapes (width×height), deterministically picked per
 *  series — used only for `VARIED_ASPECT_BRIDGE`'s series so ONE mock bridge
 *  stands in for a real bridge whose thumbnails aren't all cropped to a
 *  uniform shape (every other mock bridge stays a fixed 300×450 / 2:3, same
 *  as `cover` above). Exercises `SeriesCard`/`PageThumb`'s aspect-ratio-lands
 *  shrink animation, which a uniform-2:3 catalog never triggers. */
const VARIED_COVER_SHAPES: [width: number, height: number][] = [
  [300, 450], // 2:3 — matches the default placeholder, no visible shrink
  [300, 400],
  [300, 350],
  [300, 300], // square
  [300, 220], // landscape-ish — the most visible shrink
];

/** Slug of the one mock bridge whose covers vary shape (see
 *  `VARIED_COVER_SHAPES`); every other mock bridge reports the uniform
 *  `cover()` shape. Matches `slugify('Nightshelf')` in `MOCK_BRIDGE_NAMES`. */
const VARIED_ASPECT_BRIDGE = 'nightshelf';

function coverForBridge(seed: string, bridgeId?: string): string {
  if (bridgeId !== VARIED_ASPECT_BRIDGE) return cover(seed);
  const [w, h] = VARIED_COVER_SHAPES[hash(seed) % VARIED_COVER_SHAPES.length]!;
  return `https://picsum.photos/seed/comical-${seed}/${w}/${h}`;
}

/** Deterministic pseudo-random so a given id always yields the same entry. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Whether mock mode is active — mirrored from `data/source`'s mock toggle via `setMockActive` (called
// wherever that toggle changes). Every bit of simulated latency in this module gates on it, so a
// caller in a REAL screen can never inject fake delay even if it forgets to check mock mode itself.
// Default false = real; production (real mode) leaves it false forever.
let mockActive = false;

/** Set by `data/source` whenever the mock toggle / demo flag changes. */
export function setMockActive(active: boolean): void {
  mockActive = active;
}

/**
 * Simulated network latency for a cover, in ms. Deterministic per id so a card
 * always behaves the same. Most covers are instant; ~40% load "slowly" (so the
 * skeleton is visible) — a stand-in for real bridge image latency.
 *
 * **Mock-mode only.** In real mode this always returns 0: real images carry real network latency, so
 * simulating more just slows them (and, worse, a changing delay key could strand a tile on its
 * skeleton). This is the single choke point — no caller needs to gate on mock mode itself.
 */
export function coverDelayMs(id: string): number {
  if (!mockActive) return 0;
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

/** Simulated latency (ms) for opening a series detail (the fast info payload). */
export const SERIES_OPEN_DELAY_MS = 900;
/** Simulated latency (ms) for the deferred chapter list / page-thumbnail grid —
 *  the ~200ms part real bridges stream in after the detail (see `getSeriesList`),
 *  modelled here so the mock exercises the same skeleton-then-list flow. */
export const SERIES_LIST_DELAY_MS = 900;
/** Simulated latency (ms) for loading the next infinite-scroll grid page. */
export const PAGE_LOAD_DELAY_MS = 900;
/** Simulated latency (ms) for a tracker link / unlink / sync action. */
export const TRACKER_ACTION_DELAY_MS = 500;
/** Page count for a mock direct (chapterless) series' preview grid. */
const MOCK_DIRECT_PAGE_COUNT = 60;

/** Available tracker services a series can be linked to. Mirrors the
 *  reference's `/trackers` registry (each bridge-agnostic, configured once in
 *  Settings and reused across every series). */
export const TRACKER_SERVICES: TrackerService[] = [
  { id: 'anilist', name: 'AniList' },
  { id: 'mal', name: 'MyAnimeList' },
  { id: 'kitsu', name: 'Kitsu' },
];

function entry(
  seed: string,
  i: number,
  opts: { badges?: boolean; unread?: boolean; sub?: boolean; bridgeId?: string } = {},
): SeriesEntry {
  const h = hash(seed);
  const e: SeriesEntry = {
    id: seed,
    title: TITLES[(h + i) % TITLES.length],
    cover: coverForBridge(seed, opts.bridgeId),
  };
  if (opts.sub) e.sub = SUBS[(h + i) % SUBS.length];
  if (opts.badges && i % 3 === 0)
    e.badges = [{ text: 'NEW', position: 'top-left', tone: 'info' }];
  if (opts.badges && i % 4 === 1)
    e.badges = [{ text: 'HOT', position: 'top-left', tone: 'warn' }];
  if (opts.unread && i % 3 === 1) e.unread = 1 + (h % 9);
  return e;
}

function items(
  prefix: string,
  n: number,
  opts?: { badges?: boolean; unread?: boolean; sub?: boolean; bridgeId?: string },
): SeriesEntry[] {
  return Array.from({ length: n }, (_, i) => entry(`${prefix}-${i}`, i, opts));
}

/**
 * A page's stack of rails (hero / ranked / regular). Every top-level page
 * (home, popular, favorites, …) is its own full page, so the seed is salted
 * with the page name to give each one distinct cards while sharing the layout.
 * `bridgeId` is only meaningful for `VARIED_ASPECT_BRIDGE` (see `coverForBridge`).
 */
export function mockHomeSections(page = 'home', bridgeId?: string): RailSection[] {
  const p = page === 'home' ? '' : `${page}-`;
  const featured = items(`${p}hero`, 6, { sub: true, bridgeId });
  // On home, force the lead featured card to carry the very long title (and a
  // stable id whose detail page also gets the "ton of tags" treatment) so the
  // clamp/peek and tag-wrapping can be checked from a known card.
  if (page === 'home') {
    featured[0] = { ...featured[0], id: 'featured-long', title: LONG_TITLE };
  }
  return [
    { id: `${p}featured`, title: 'Featured', kind: 'hero', items: featured },
    { id: `${p}trending`, title: 'Trending now', kind: 'ranked', items: items(`${p}rank`, 10, { sub: true, bridgeId }) },
    { id: `${p}updates`, title: 'Latest updates', kind: 'regular', items: items(`${p}upd`, 14, { badges: true, unread: true, sub: true, bridgeId }) },
    { id: `${p}popular`, title: 'Popular this season', kind: 'regular', items: items(`${p}pop`, 14, { badges: true, bridgeId }) },
    { id: `${p}newish`, title: 'Newly added', kind: 'regular', items: items(`${p}new`, 14, { badges: true, bridgeId }) },
  ];
}

/** Flat grid of results (search / "See all" / non-home page). */
export function mockGrid(prefix = 'grid', n = 30, bridgeId?: string): SeriesEntry[] {
  return items(prefix, n, { badges: true, unread: true, sub: true, bridgeId });
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
  const chapters: Chapter[] = [];
  // Newest first; the first ~40% are unread. Each chapter carries a numeric `number`
  // (the source of truth for ordering) so the grouping logic is exercised without a
  // live bridge. Every 3rd chapter also gets a second scanlation-group version of the
  // same number — the case multi-scanlator grouping must collapse — deliberately
  // inserted OUT of reading order so index-based ordering would get it wrong.
  const readCut = Math.floor(count * 0.4);
  for (let i = 0; i < count; i++) {
    const num = count - i;
    const read = i >= readCut;
    chapters.push({
      id: `${seed}-ch-${num}`,
      name: `Chapter ${num}`,
      number: num,
      languageCode: 'en',
      group: 'Scanline',
      date: now - i * DAY * (1 + (h % 3)),
      pageCount: 12 + (num % 8),
      read,
    });
    if (num % 3 === 0) {
      chapters.push({
        id: `${seed}-ch-${num}-alt`,
        name: `Chapter ${num}`,
        number: num,
        languageCode: 'en',
        group: 'MangaDweebs',
        // A day fresher than the primary version, so it becomes the group's default.
        date: now - i * DAY * (1 + (h % 3)) + DAY,
        pageCount: 11 + (num % 8),
        read,
      });
    }
  }
  // A decimal bonus chapter (10.5) to prove numeric ordering slots it between 10 and 11,
  // and a numberless "extra" that must sort last and stay its own row.
  if (count >= 11) {
    chapters.push({
      id: `${seed}-ch-10-5`,
      name: 'Chapter 10.5 — Omake',
      number: 10.5,
      languageCode: 'en',
      group: 'Scanline',
      date: now - 5 * DAY,
      pageCount: 6,
      read: false,
    });
    chapters.push({
      id: `${seed}-ch-extra`,
      name: 'Extra — Character Guide',
      languageCode: 'en',
      group: 'Scanline',
      date: now - 2 * DAY,
      pageCount: 4,
      read: false,
    });
  }
  return chapters;
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

// ─── Sprite-thumbnail fixtures ────────────────────────────────────────────────
// A direct series' `pageThumbs` mixes all three shapes a real bridge can hand back, so the page
// grid exercises every renderer without a live sprite-capable bridge: pages 0–19 are cut from one
// shared uniform-grid sheet, 20–39 from one shared variable-aspect strip, and 40+ are plain
// per-page images. The two sheets are generated as inline numbered-cell SVGs (a data URI — no
// network round trip), the same technique the `comical` repo's `test-sprites` bridge + host-server
// route use to make sprite-crop rendering independently verifiable: 40 distinct numbered tiles
// prove each one is cut from the right spot, and the 20–39 range should each keep its own shape.
const SPRITE_UNIFORM_COLS = 5;
const SPRITE_UNIFORM_ROWS = 4;
const SPRITE_TILE_W = 150;
const SPRITE_TILE_H = 225;
const SPRITE_VAR_COUNT = 20;
const SPRITE_VAR_SHEET_H = 225;
const spriteVarTileW = (i: number) => 90 + (i % 5) * 30;
const spriteVarTileH = (i: number) => SPRITE_VAR_SHEET_H - (i % 4) * 40;

const svgDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const spriteCell = (x: number, y: number, w: number, h: number, n: number) => {
  const hue = (n * 47) % 360;
  const fontSize = Math.round(Math.min(w, h) * 0.4);
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="hsl(${hue},70%,55%)"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.35}" font-size="${fontSize}" ` +
    `text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold">${n}</text>`
  );
};

function mockPageThumbs(seed: string, count: number): PageThumbSource[] {
  const uniformSheetW = SPRITE_UNIFORM_COLS * SPRITE_TILE_W;
  const uniformSheetH = SPRITE_UNIFORM_ROWS * SPRITE_TILE_H;
  const uniformCount = SPRITE_UNIFORM_COLS * SPRITE_UNIFORM_ROWS;
  const uniformCells = Array.from({ length: uniformCount }, (_, i) =>
    spriteCell((i % SPRITE_UNIFORM_COLS) * SPRITE_TILE_W, Math.floor(i / SPRITE_UNIFORM_COLS) * SPRITE_TILE_H, SPRITE_TILE_W, SPRITE_TILE_H, i + 1),
  ).join('');
  const uniformSheet = svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${uniformSheetW}" height="${uniformSheetH}">${uniformCells}</svg>`,
  );

  let varX = 0;
  const varTiles = Array.from({ length: SPRITE_VAR_COUNT }, (_, i) => {
    const tile = { x: varX, w: spriteVarTileW(i), h: spriteVarTileH(i) };
    varX += tile.w;
    return tile;
  });
  const varCells = varTiles.map((t, i) => spriteCell(t.x, 0, t.w, t.h, uniformCount + i + 1)).join('');
  const varSheet = svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${varX}" height="${SPRITE_VAR_SHEET_H}">${varCells}</svg>`);

  return Array.from({ length: count }, (_, i): PageThumbSource => {
    if (i < uniformCount) {
      const col = i % SPRITE_UNIFORM_COLS;
      const row = Math.floor(i / SPRITE_UNIFORM_COLS);
      return {
        kind: 'sprite',
        sheetUrl: uniformSheet,
        x: col * SPRITE_TILE_W,
        y: row * SPRITE_TILE_H,
        w: SPRITE_TILE_W,
        h: SPRITE_TILE_H,
        sheetWidth: uniformSheetW,
        sheetHeight: uniformSheetH,
      };
    }
    const vi = i - uniformCount;
    if (vi < SPRITE_VAR_COUNT) {
      const t = varTiles[vi];
      return { kind: 'sprite', sheetUrl: varSheet, x: t.x, y: 0, w: t.w, h: t.h, sheetWidth: varX, sheetHeight: SPRITE_VAR_SHEET_H };
    }
    return { kind: 'image', url: cover(`${seed}-p${i}`) };
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
    description: DESCRIPTION,
    meta: META,
    // Mirror real bridges (source.ts `getSeriesDetail`): the detail is the fast info
    // payload; the chapter list / page-thumbnail grid — the slow part — streams in via
    // `getSeriesList` (see `mockGetSeriesList`), so both data sources share one shape.
    listDeferred: true,
  };

  if (direct) {
    // Static/known-from-info parts render right away; the grid streams in later
    // (matches real, which sets these inline for a direct series and defers pageThumbs).
    base.readLabel = '▶  Read';
    base.chapterCount = MOCK_DIRECT_PAGE_COUNT;
  }
  // Chaptered: readLabel/chapterCount aren't known until the list loads — getSeriesList fills them.

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
// Mock-mode only, like coverDelayMs: resolve immediately in real mode so even a stray call to a mock
// data function outside mock mode can't add fake latency to a real page load (infinite scroll, series
// detail, etc.). In practice these run only via mockDataSource (mock mode), but this makes it airtight.
const delay = (ms: number): Promise<void> =>
  mockActive ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

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
  bridgeId: string,
): Promise<{ sections: RailSection[]; gridSections: HomeGridSection[] }> {
  // Simulate bridge-switch latency so the Browse screen's loading skeleton
  // (shown while this is in flight) is actually observable in mock/demo mode.
  await delay(PAGE_LOAD_DELAY_MS);
  // Two grid sections so the non-terminal "Load more" / terminal infinite-scroll
  // split (see types.ts's HomeGridSection doc) is exercisable in mock mode too.
  return {
    sections: mockHomeSections('home', bridgeId),
    gridSections: [
      { id: 'staff-picks', title: 'Staff Picks', items: mockGrid('staff-picks', 12, bridgeId), hasNextPage: true },
      { id: 'home', title: 'Browse all', items: mockGrid('home', 24, bridgeId), hasNextPage: true },
    ],
  };
}

/** Infinite mock grid: always reports another page so infinite-scroll stays exercisable. Also
 *  delays the first page so sub-page switches (and "See all") show their loading skeleton. */
export async function mockGetGridPage(bridgeId: string, listId: string, page: number): Promise<GridPage> {
  await delay(PAGE_LOAD_DELAY_MS);
  return { items: mockGrid(`${listId}-p${page}`, 24, bridgeId), hasNextPage: true };
}

/** Finite mock search results (3 pages), so the "end of results" case is reachable too. */
export async function mockSearch(bridgeId: string, query: string, page: number): Promise<GridPage> {
  await delay(PAGE_LOAD_DELAY_MS);
  return { items: mockGrid(`${query || 'search'}-p${page}`, 24, bridgeId), hasNextPage: page < 3 };
}

export async function mockGetSeriesDetail(
  _bridgeId: string,
  seriesId: string,
  opts: { direct?: boolean; bridgeName?: string; title?: string } = {},
): Promise<SeriesDetail> {
  await delay(SERIES_OPEN_DELAY_MS);
  return mockSeries(seriesId, opts.title, opts.bridgeName ?? 'Library', { direct: opts.direct });
}

/** The deferred list part of a series (mirrors real `getSeriesList`): chapters +
 *  count/label for a chaptered series, or the page-thumbnail grid for a direct one.
 *  `mockGetSeriesDetail` flags `listDeferred`, so the series screen fetches this
 *  separately — same single code path as real bridges. */
export async function mockGetSeriesList(
  _bridgeId: string,
  seriesId: string,
  direct: boolean,
): Promise<SeriesListResult> {
  await delay(SERIES_LIST_DELAY_MS);
  const seed = seriesId || 'series';
  if (direct || seed.includes('direct')) {
    return {
      pageThumbs: mockPageThumbs(seed, MOCK_DIRECT_PAGE_COUNT),
      chapterCount: MOCK_DIRECT_PAGE_COUNT,
      readLabel: '▶  Read',
    };
  }
  const chapterCount = 40 + (hash(seed) % 160);
  const chapters = mockChapters(seed, chapterCount);
  const first = firstChapterInReadingOrder(chapters);
  return {
    chapters,
    chapterCount: chapters.length,
    readLabel: first ? `▶  ${first.name}` : undefined,
  };
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

// ─── Local library / history / activity (in-memory, dev/demo only) ────────────
// A tiny mutable in-memory library so the demo build's Library/History/Activity tabs render real
// content and add/remove/read actions actually stick within a session. Keyed by `bridgeId:seriesId`.

type MockLibEntry = { bridgeId: string; seriesId: string; title: string; thumbnailUrl: string; author?: string; unread: number };
type MockHist = { bridgeId: string; seriesId: string; title: string; thumbnailUrl: string; chapterId?: string; chapterName?: string; lastPage?: number; pageCount?: number; lastReadAt: number };
type MockActivity = { bridgeId: string; seriesId: string; chapterId: string; title: string; thumbnailUrl: string; chapterName?: string; number?: number; detectedAt: number; read: boolean };

const libKey = (bridgeId: string, seriesId: string) => `${bridgeId}:${seriesId}`;
const MOCK_LIB_BRIDGES = MOCK_BRIDGE_NAMES.map(slugify);

function seedLibrary(): Map<string, MockLibEntry> {
  const m = new Map<string, MockLibEntry>();
  // Eight entries spread across the mock bridges, each a distinct title/cover, some with unread.
  for (let i = 0; i < 8; i++) {
    const bridgeId = MOCK_LIB_BRIDGES[i % MOCK_LIB_BRIDGES.length]!;
    const seriesId = `lib-${i}`;
    const h = hash(seriesId);
    m.set(libKey(bridgeId, seriesId), {
      bridgeId,
      seriesId,
      title: TITLES[i % TITLES.length]!,
      thumbnailUrl: cover(seriesId),
      unread: h % 3 === 0 ? 1 + (h % 12) : 0,
    });
  }
  return m;
}

const mockLibrary = seedLibrary();

const mockHistory = new Map<string, MockHist>(
  [0, 3, 5].map((i) => {
    const bridgeId = MOCK_LIB_BRIDGES[i % MOCK_LIB_BRIDGES.length]!;
    const seriesId = `lib-${i}`;
    const pageCount = 18 + (hash(seriesId) % 20);
    return [
      libKey(bridgeId, seriesId),
      {
        bridgeId,
        seriesId,
        title: TITLES[i % TITLES.length]!,
        thumbnailUrl: cover(seriesId),
        chapterId: `${seriesId}-ch-3`,
        chapterName: `Chapter ${3 + (i % 5)}`,
        lastPage: 4 + (i % 6),
        pageCount,
        lastReadAt: Date.now() - (i + 1) * 3600_000,
      },
    ] as const;
  }),
);

let mockActivity: MockActivity[] = [1, 2, 4, 6].map((i) => {
  const bridgeId = MOCK_LIB_BRIDGES[i % MOCK_LIB_BRIDGES.length]!;
  const seriesId = `lib-${i}`;
  return {
    bridgeId,
    seriesId,
    chapterId: `${seriesId}-ch-new-${i}`,
    title: TITLES[i % TITLES.length]!,
    thumbnailUrl: cover(seriesId),
    chapterName: `Chapter ${20 + i}`,
    number: 20 + i,
    detectedAt: Date.now() - i * 5400_000,
    read: false,
  };
});

export async function mockGetLibrary(opts: { q?: string; sort?: string } = {}): Promise<MockLibEntry[]> {
  let items = [...mockLibrary.values()];
  const q = opts.q?.trim().toLowerCase();
  if (q) items = items.filter((e) => e.title.toLowerCase().includes(q));
  const dir = 1;
  switch (opts.sort) {
    case 'title': items.sort((a, b) => a.title.localeCompare(b.title) * dir); break;
    case 'unread': items.sort((a, b) => (b.unread - a.unread) * dir); break;
    // 'added'/'lastRead'/default: keep insertion order (seed order stands in for "recently added").
    default: break;
  }
  return items;
}

export async function mockIsInLibrary(bridgeId: string, seriesId: string): Promise<boolean> {
  return mockLibrary.has(libKey(bridgeId, seriesId));
}

export async function mockAddToLibrary(
  bridgeId: string,
  seriesId: string,
  snap: { title?: string; thumbnailUrl?: string; author?: string },
): Promise<void> {
  const key = libKey(bridgeId, seriesId);
  if (mockLibrary.has(key)) return;
  mockLibrary.set(key, {
    bridgeId,
    seriesId,
    title: snap.title ?? mockSeries(seriesId).title,
    thumbnailUrl: snap.thumbnailUrl ?? cover(seriesId),
    ...(snap.author !== undefined && { author: snap.author }),
    unread: 0,
  });
}

export async function mockRemoveFromLibrary(bridgeId: string, seriesId: string): Promise<void> {
  mockLibrary.delete(libKey(bridgeId, seriesId));
}

/** Upsert a history row (used by both a library progress write and a non-library read log). */
function upsertMockHistory(h: MockHist): void {
  mockHistory.set(libKey(h.bridgeId, h.seriesId), h);
}

export async function mockRecordChapterProgress(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  update: { lastPage?: number; pageCount?: number; chapterName?: string },
): Promise<void> {
  const lib = mockLibrary.get(libKey(bridgeId, seriesId));
  upsertMockHistory({
    bridgeId,
    seriesId,
    title: lib?.title ?? mockSeries(seriesId).title,
    thumbnailUrl: lib?.thumbnailUrl ?? cover(seriesId),
    chapterId,
    ...(update.chapterName !== undefined && { chapterName: update.chapterName }),
    ...(update.lastPage !== undefined && { lastPage: update.lastPage }),
    ...(update.pageCount !== undefined && { pageCount: update.pageCount }),
    lastReadAt: Date.now(),
  });
}

export async function mockRecordReadingHistory(entry: {
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  chapterId?: string;
  chapterName?: string;
  lastPage?: number;
  pageCount?: number;
}): Promise<void> {
  upsertMockHistory({
    bridgeId: entry.bridgeId,
    seriesId: entry.seriesId,
    title: entry.title,
    thumbnailUrl: entry.thumbnailUrl ?? cover(entry.seriesId),
    ...(entry.chapterId !== undefined && { chapterId: entry.chapterId }),
    ...(entry.chapterName !== undefined && { chapterName: entry.chapterName }),
    ...(entry.lastPage !== undefined && { lastPage: entry.lastPage }),
    ...(entry.pageCount !== undefined && { pageCount: entry.pageCount }),
    lastReadAt: Date.now(),
  });
}

export async function mockGetHistory(): Promise<MockHist[]> {
  return [...mockHistory.values()].sort((a, b) => b.lastReadAt - a.lastReadAt);
}

export async function mockRemoveHistoryEntry(bridgeId: string, seriesId: string): Promise<void> {
  mockHistory.delete(libKey(bridgeId, seriesId));
}

export async function mockGetActivity(): Promise<MockActivity[]> {
  return [...mockActivity].sort((a, b) => b.detectedAt - a.detectedAt);
}

export async function mockGetActivityCount(): Promise<number> {
  return mockActivity.filter((a) => !a.read).length;
}

export async function mockCheckForUpdates(): Promise<void> {
  // Synthesize one fresh "new chapter" so the button visibly does something in the demo.
  const i = mockActivity.length;
  const bridgeId = MOCK_LIB_BRIDGES[i % MOCK_LIB_BRIDGES.length]!;
  const seriesId = `lib-${i % 8}`;
  mockActivity = [
    {
      bridgeId,
      seriesId,
      chapterId: `${seriesId}-ch-fresh-${i}`,
      title: TITLES[i % TITLES.length]!,
      thumbnailUrl: cover(seriesId),
      chapterName: `Chapter ${30 + i}`,
      number: 30 + i,
      detectedAt: Date.now(),
      read: false,
    },
    ...mockActivity,
  ];
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
