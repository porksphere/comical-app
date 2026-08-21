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
  ChapterProgress,
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
import { resolveDefaultCollection } from './default-collection';
import type {
  ApiBridgeInfo,
  ApiFilter,
  ApiSortOption,
  BridgePrefs,
  BridgeSummary,
  BridgeSettingsInfo,
  ContentRating,
  FavoritesImportItem,
  FavoritesImportPreview,
  FavoritesImportResult,
  TrackerSummary,
  TrackerSettingsInfo,
  TrackerLinkSyncResult,
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

// CI-speed override: zeroes every simulated mock latency below (see `delay` and `coverDelayMs`).
// A sibling flag to `source.ts`'s IS_DEMO_MODE, not piggybacked onto the mockActive toggle above,
// since local dev demo mode should keep its realistic feel — only e2e.yml sets this.
const IS_DEMO_FAST = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST === '1';

/** Set by `data/source` whenever the mock toggle / demo flag changes. */
export function setMockActive(active: boolean): void {
  mockActive = active;
}

/** Non-React read for background work (auto-check, chapter-check task) that must skip real API
 *  calls while the demo/mock source is active. */
export function isMockActive(): boolean {
  return mockActive;
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
  if (!mockActive || IS_DEMO_FAST) return 0;
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
      return { externalId: String(10000 + (h % 90000)), title, thumbnailUrl: cover(`tracker-${h}`) };
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
    // Genres are the leading `kind: "genre"` group; `tagIds` mirror the mock genre filter's option
    // values (the genre names) so a tapped genre chip drives that filter — see mockGetFilters.
    const genreGroup: TagGroup = { kind: 'genre', label: 'Genres', tags: GENRES, tagIds: GENRES };
    // The long-title series doubles as the "ton of tags" case.
    base.tagGroups = seed.includes('long')
      ? [genreGroup, ...TAG_GROUPS, { label: 'Tags', tags: MANY_TAGS }]
      : [genreGroup, ...TAG_GROUPS];
    base.hasSources = h % 2 === 0;
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
// Bridges whose backend supports account "favorites" (the capability real bridges advertise). A subset,
// so the app exercises both favorites-capable and non-capable bridges.
const MOCK_FAVORITES_BRIDGES = new Set(['Panelfox', 'Inkwell', 'Coldspine']);
// Favorites-capable bridges the user hasn't logged into (a required secret still missing) — their star
// greys out and they drop from the consolidated Favorites page, demonstrating the credential gate.
const MOCK_LOGGED_OUT_BRIDGES = new Set(['Inkwell']);
const slugify = (name: string) => name.toLowerCase();
// Mock-mode only, like coverDelayMs: resolve immediately in real mode so even a stray call to a mock
// data function outside mock mode can't add fake latency to a real page load (infinite scroll, series
// detail, etc.). In practice these run only via mockDataSource (mock mode), but this makes it airtight.
const delay = (ms: number): Promise<void> =>
  mockActive && !IS_DEMO_FAST ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

// Perf spike fixture: a synthetic bridge whose composed Home has a LOT of rails, so the
// rail-virtualization work (ContentFeed) can be stress-profiled on demand — a real bridge home is only
// ~3–5 rails, which may not lag at all. Reachable via the __DEV__ "Use mock data" toggle. See
// `RAIL_STRESS_COUNT` / `mockGetHomeSections`.
export const RAIL_STRESS_BRIDGE_ID = 'rail-stress';
const RAIL_STRESS_COUNT = 18;

export async function mockGetBridges(): Promise<Bridge[]> {
  const bridges: Bridge[] = MOCK_BRIDGE_NAMES.map((name) => ({
    id: slugify(name),
    name,
    nsfw: false,
    capabilities: [
      'lists',
      'search',
      'filters',
      'sort',
      ...(MOCK_DIRECT_BRIDGES.has(name) ? ['direct'] : []),
      ...(MOCK_FAVORITES_BRIDGES.has(name) ? ['favorites'] : []),
    ],
    // Mock entries carry "Ch. 176 · 2h ago" subs (see `entry`'s `sub` option), so the mock bridges
    // declare the flag — the grids reserve the sub line for them, exactly like a real sub-ful bridge.
    cardSubtitles: true,
    thumbnail: `https://picsum.photos/seed/bridge-${slugify(name)}/100/100`,
  }));
  bridges.push({
    id: RAIL_STRESS_BRIDGE_ID,
    name: 'Rail Stress (Demo)',
    nsfw: false,
    capabilities: ['lists', 'search', 'filters', 'sort'],
    cardSubtitles: true,
    thumbnail: `https://picsum.photos/seed/bridge-rail-stress/100/100`,
  });
  return bridges;
}

export async function mockGetBridgeLists(_bridgeId: string): Promise<BridgeList[]> {
  return [
    // A `featured` rail-layout list so the synthetic "Comical" aggregate home has one representative
    // rail per mock bridge to pull (via getBridgeFeaturedRail). Home-composition still comes from
    // mockGetHomeSections, so this doesn't change the normal single-bridge mock home.
    { id: 'featured', name: 'Featured', page: false, layout: 'carousel', featured: true },
    { id: 'home', name: 'Home', page: false },
    { id: 'popular', name: 'Popular', page: true },
    // NB: no 'favorites' list — favorites is a CAPABILITY (see mockGetBridges), not a browse list, so
    // it surfaces via pageOptions/the consolidated page exactly like a real bridge's account favorites.
  ];
}

/** Perf spike: a composed Home with `RAIL_STRESS_COUNT` rails (cycling the three kinds with distinct
 *  ids/titles), so the many-rails-at-once mount cost — and whether ContentFeed's virtualization actually
 *  helps — is measurable. Keeps the usual terminal grid so infinite scroll past the rails is exercised. */
function mockRailStressSections(bridgeId: string): RailSection[] {
  const kinds: RailSection['kind'][] = ['hero', 'ranked', 'regular'];
  return Array.from({ length: RAIL_STRESS_COUNT }, (_, i) => {
    const kind = kinds[i % kinds.length];
    return {
      id: `stress-${i}`,
      title: `Stress rail ${i + 1}`,
      kind,
      items: items(`stress-${i}`, 20, { badges: true, unread: true, sub: true, bridgeId }),
    };
  });
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
    sections:
      bridgeId === RAIL_STRESS_BRIDGE_ID ? mockRailStressSections(bridgeId) : mockHomeSections('home', bridgeId),
    gridSections: [
      { id: 'staff-picks', title: 'Staff Picks', items: mockGrid('staff-picks', 12, bridgeId), nextCursor: mockCursor(2) },
      { id: 'home', title: 'Browse all', items: mockGrid('home', 24, bridgeId), nextCursor: mockCursor(2) },
    ],
  };
}

/**
 * The mock's own cursor format. A cursor is opaque to everything outside the source that issues it,
 * and the mock is a stand-in *source*, not a client — so it picks whatever identifies its next page,
 * here just the page number its item generator is seeded from. Absent or unreadable reads as the
 * first page rather than throwing, matching how the SDK's real helpers degrade for a stale cursor.
 */
const mockCursor = (page: number): string => `p${page}`;
const mockPage = (cursor: string | undefined): number => {
  const n = Number(cursor?.replace(/^p/, ''));
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

/** Infinite mock grid: always hands back another cursor so infinite-scroll stays exercisable. Also
 *  delays the first page so sub-page switches (and "See all") show their loading skeleton. */
export async function mockGetGridPage(bridgeId: string, listId: string, cursor?: string): Promise<GridPage> {
  await delay(PAGE_LOAD_DELAY_MS);
  const page = mockPage(cursor);
  return { items: mockGrid(`${listId}-p${page}`, 24, bridgeId), nextCursor: mockCursor(page + 1) };
}

/** Finite mock search results (3 pages), so the "end of results" case is reachable too — the third
 *  page comes back with no cursor, which is the only way this source says "that's all". */
export async function mockSearch(bridgeId: string, query: string, cursor?: string): Promise<GridPage> {
  await delay(PAGE_LOAD_DELAY_MS);
  const page = mockPage(cursor);
  return {
    items: mockGrid(`${query || 'search'}-p${page}`, 24, bridgeId),
    ...(page < 3 ? { nextCursor: mockCursor(page + 1) } : {}),
  };
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
    // A `number` filter, so `NumberFilterRow` is reachable at all in mock/demo mode — same reason the
    // toggle above is here. Its inline text field is the only filter control with an edit/commit
    // cycle (focus, type, blur, external clear), and without an instance in the mock set there was no
    // way to exercise that in the browser or in a flow. Long label on purpose: it's also the case the
    // filter bar has to shrink rather than push the value out of its slot.
    { type: 'number', key: 'minChapters', label: 'Minimum chapters', min: 0, max: 999 },
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

// Seeded with a handful of series so the demo's favorites surfaces (the per-bridge Favorites page and
// the consolidated Comical Favorites page) have content out of the box, not an empty grid.
const mockFavorites = new Set<string>(['fav-1', 'fav-2', 'fav-3', 'fav-4', 'fav-5', 'fav-6']);

/** One page, no cursor — and with no cursor to hand back there is no second read to guard against,
 *  which is why this no longer needs the "page > 1 → empty" branch it used to carry. */
export async function mockGetFavorites(): Promise<GridPage> {
  return { items: [...mockFavorites].map((id) => entry(id, hash(id))) };
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

// The APP's `LibraryItem` shape, not the wire shape — the mock source hands these straight to the
// UI without going through `toLibraryItem`. `collectedAt` is required for the same reason it is on
// the real series item: a collected series always has one.
type MockLibEntry = { bridgeId: string; seriesId: string; title: string; thumbnailUrl: string; author?: string; unread: number; collectedAt: number; lastReadAt?: number };
type MockCollection = { id: string; name: string; order: number };
type MockHist = { bridgeId: string; seriesId: string; title: string; thumbnailUrl: string; chapterId?: string; chapterName?: string; lastPage?: number; pageCount?: number; lastReadAt: number };
type MockActivity = { bridgeId: string; seriesId: string; chapterId: string; title: string; thumbnailUrl: string; chapterName?: string; number?: number; detectedAt: number; read: boolean };

const libKey = (bridgeId: string, seriesId: string) => `${bridgeId}:${seriesId}`;
const MOCK_LIB_BRIDGES = MOCK_BRIDGE_NAMES.map(slugify);

// A couple of seeded collections so the demo build shows the selector populated. Series are filed
// into them by `mockSeriesCollections` below.
let mockCollections: MockCollection[] = [
  { id: 'coll-reading', name: 'Reading', order: 0 },
  { id: 'coll-favorites', name: 'Favorites', order: 1 },
];

// Series → collection memberships. A SEPARATE map, not a field on the library entry: memberships
// live on a series FAVORITE item now, so a series can be filed without being in the library at all
// (and can sit in the library while filed nowhere). Keyed the same `bridgeId:seriesId`.
const mockSeriesCollections = new Map<string, string[]>();

function seedLibrary(): Map<string, MockLibEntry> {
  const m = new Map<string, MockLibEntry>();
  // Eight entries spread across the mock bridges, each a distinct title/cover, some with unread.
  for (let i = 0; i < 8; i++) {
    const bridgeId = MOCK_LIB_BRIDGES[i % MOCK_LIB_BRIDGES.length]!;
    const seriesId = `lib-${i}`;
    const h = hash(seriesId);
    // Spread a few series across the seeded collections (some in both, some in neither →
    // "Uncollected").
    const collectionIds: string[] = [];
    if (i % 2 === 0) collectionIds.push('coll-reading');
    if (i % 3 === 0) collectionIds.push('coll-favorites');
    if (collectionIds.length > 0) mockSeriesCollections.set(libKey(bridgeId, seriesId), collectionIds);
    m.set(libKey(bridgeId, seriesId), {
      bridgeId,
      seriesId,
      title: TITLES[i % TITLES.length]!,
      thumbnailUrl: cover(seriesId),
      unread: h % 3 === 0 ? 1 + (h % 12) : 0,
      // Spread over distinct days so the library's date groupings have real buckets to show, and
      // fixed timestamps so the demo/e2e render deterministically. Every third series has never
      // been read — the "Not read yet" bucket.
      collectedAt: 1_760_000_000_000 - i * 129_600_000,
      ...(i % 3 !== 0 && { lastReadAt: 1_760_000_000_000 - ((i * 7) % 5) * 86_400_000 - i * 3_600_000 }),
    });
  }
  // Two extra entries that overlap the favorites set (`mockFavorites` above), so the favorites-import
  // dialog has something to classify as other than "new": `fav-1` is already here from panelfox
  // itself, and `fav-2`'s title is already here under a DIFFERENT id on another bridge — the
  // cross-bridge duplicate case. Without these the mock preview would be an undifferentiated list.
  const alreadyHere = entry('fav-1', hash('fav-1'));
  m.set(libKey('panelfox', 'fav-1'), {
    bridgeId: 'panelfox',
    seriesId: 'fav-1',
    title: alreadyHere.title,
    thumbnailUrl: alreadyHere.cover,
    unread: 0,
    collectedAt: 1_759_000_000_000,
  });
  const otherSource = entry('fav-2', hash('fav-2'));
  m.set(libKey('nightshelf', 'ns-771'), {
    bridgeId: 'nightshelf',
    seriesId: 'ns-771',
    title: otherSource.title,
    thumbnailUrl: cover('ns-771'),
    unread: 0,
    collectedAt: 1_758_000_000_000,
  });
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

let mockActivity: MockActivity[] = [1, 2, 4, 6].flatMap((i) => {
  const bridgeId = MOCK_LIB_BRIDGES[i % MOCK_LIB_BRIDGES.length]!;
  const seriesId = `lib-${i}`;
  const base = {
    bridgeId,
    seriesId,
    title: TITLES[i % TITLES.length]!,
    thumbnailUrl: cover(seriesId),
    read: false,
  };
  // lib-2 drops three chapters at once, so the feed can demonstrate coalescing (one row, "3 new
  // chapters"); the others get a single new chapter each.
  const count = i === 2 ? 3 : 1;
  return Array.from({ length: count }, (_, k) => ({
    ...base,
    chapterId: `${seriesId}-ch-new-${i}-${k}`,
    chapterName: `Chapter ${20 + i + k}`,
    number: 20 + i + k,
    detectedAt: Date.now() - i * 5400_000 - k * 600_000,
  }));
});

export async function mockGetLibrary(
  opts: { q?: string; sort?: string; collectionId?: string; uncollected?: boolean } = {},
): Promise<MockLibEntry[]> {
  let items = [...mockLibrary.values()];
  // Membership is a join through `mockSeriesCollections`, mirroring the host doing it server-side.
  const memberships = (e: MockLibEntry) => mockSeriesCollections.get(libKey(e.bridgeId, e.seriesId)) ?? [];
  if (opts.uncollected) items = items.filter((e) => memberships(e).length === 0);
  else if (opts.collectionId) items = items.filter((e) => memberships(e).includes(opts.collectionId!));
  const q = opts.q?.trim().toLowerCase();
  if (q) items = items.filter((e) => e.title.toLowerCase().includes(q));
  const dir = 1;
  switch (opts.sort) {
    case 'title': items.sort((a, b) => a.title.localeCompare(b.title) * dir); break;
    case 'unread': items.sort((a, b) => (b.unread - a.unread) * dir); break;
    case 'lastRead': items.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)); break;
    case 'added': items.sort((a, b) => b.collectedAt - a.collectedAt); break;
    // default: keep insertion order.
    default: break;
  }
  return items;
}

export async function mockIsInLibrary(bridgeId: string, seriesId: string): Promise<boolean> {
  return mockLibrary.has(libKey(bridgeId, seriesId));
}

/** Collect a series INTO a collection — under the dissolution there is no add-to-library separate
 *  from filing, so the caller resolves the default collection and passes its id. Idempotent on the
 *  entry, but it always files: re-adding a series that lost its memberships puts it back. */
export async function mockAddToLibrary(
  bridgeId: string,
  seriesId: string,
  snap: { seriesTitle?: string; thumbnailUrl?: string; author?: string },
  collectionId: string,
): Promise<void> {
  const key = libKey(bridgeId, seriesId);
  const already = mockSeriesCollections.get(key) ?? [];
  if (!already.includes(collectionId)) mockSeriesCollections.set(key, [...already, collectionId]);
  if (mockLibrary.has(key)) return;
  mockLibrary.set(key, {
    bridgeId,
    seriesId,
    title: snap.seriesTitle ?? mockSeries(seriesId).title,
    thumbnailUrl: snap.thumbnailUrl ?? cover(seriesId),
    ...(snap.author !== undefined && { author: snap.author }),
    unread: 0,
    collectedAt: Date.now(),
  });
}

/** Uncollect: out of the library AND every collection, since a series item exists only as a member.
 *  Read progress (`mockProgress`) deliberately survives, exactly as the runtime's cascade does. */
export async function mockRemoveFromLibrary(bridgeId: string, seriesId: string): Promise<void> {
  const key = libKey(bridgeId, seriesId);
  mockLibrary.delete(key);
  mockSeriesCollections.delete(key);
}

/** The only thing that destroys read state — and it works whether or not the series is collected,
 *  which is how progress orphaned by an uncollect gets reclaimed. */
export async function mockResetReadProgress(bridgeId: string, seriesId: string): Promise<void> {
  const key = libKey(bridgeId, seriesId);
  mockProgress.delete(key);
  // …and the resume point that hangs off the series item, which is what `lastReadAt` is here.
  const entry = mockLibrary.get(key);
  if (entry) {
    const { lastReadAt: _drop, ...rest } = entry;
    mockLibrary.set(key, rest);
  }
}

// ─── Importing a bridge's favorites into the library ─────────────────────────
// Mirrors what the host's runtime does (`previewBridgeFavoritesImport`): walk the favorites, classify
// each against the library. The title fold below is the mock's own small copy of the host's
// `normalizeTitle` — enough for ASCII mock titles, and kept here so mock.ts stays dependency-free.

const foldTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function mockGetFavoritesImportPreview(bridgeId: string): Promise<FavoritesImportPreview> {
  await delay(400);
  const byTitle = new Map<string, MockLibEntry[]>();
  for (const e of mockLibrary.values()) {
    const k = foldTitle(e.title);
    if (!k) continue;
    const bucket = byTitle.get(k);
    if (bucket) bucket.push(e);
    else byTitle.set(k, [e]);
  }

  const items = [...mockFavorites].map((id) => {
    const fav = entry(id, hash(id));
    if (mockLibrary.has(libKey(bridgeId, id))) {
      return { seriesId: id, title: fav.title, thumbnailUrl: fav.cover, status: 'in-library' as const };
    }
    // Only other bridges count: a same-bridge title twin is a different series, not another source.
    const matches = (byTitle.get(foldTitle(fav.title)) ?? []).filter((e) => e.bridgeId !== bridgeId);
    return {
      seriesId: id,
      title: fav.title,
      thumbnailUrl: fav.cover,
      status: matches.length > 0 ? ('duplicate' as const) : ('new' as const),
      ...(matches.length > 0 && {
        matches: matches.map((e) => ({
          key: libKey(e.bridgeId, e.seriesId),
          bridgeId: e.bridgeId,
          seriesId: e.seriesId,
          title: e.title,
        })),
      }),
    };
  });
  return { items, truncated: false };
}

export async function mockImportBridgeFavorites(
  bridgeId: string,
  items?: FavoritesImportItem[],
): Promise<FavoritesImportResult> {
  await delay(500);
  const selection: FavoritesImportItem[] =
    items ?? [...mockFavorites].map((id) => ({ seriesId: id, title: entry(id, hash(id)).title }));

  let imported = 0;
  let skipped = 0;
  let linked = 0;
  for (const item of selection) {
    if (mockLibrary.has(libKey(bridgeId, item.seriesId))) {
      skipped++;
      continue;
    }
    await mockAddToLibrary(
      bridgeId,
      item.seriesId,
      { seriesTitle: item.title, ...(item.thumbnailUrl !== undefined && { thumbnailUrl: item.thumbnailUrl }) },
      await mockDefaultCollectionId(),
    );
    imported++;
    // The mock library has no series-group model, so a confirmed link is only counted, not stored.
    if (item.linkTo && mockLibrary.has(item.linkTo)) linked++;
  }
  return { imported, skipped, linked };
}

// ─── Collections (in-memory, dev/demo only) ──────────────────────────────────

/** The default collection's id, created on first use — the same lazily-created-by-name rule the
 *  real source applies (see `data/default-collection.ts`). */
export async function mockDefaultCollectionId(): Promise<string> {
  return resolveDefaultCollection(mockGetCollections, mockCreateCollection);
}

export async function mockGetCollections(): Promise<MockCollection[]> {
  return [...mockCollections].sort((a, b) => a.order - b.order);
}

export async function mockCreateCollection(name: string): Promise<MockCollection> {
  const order = mockCollections.reduce((max, c) => Math.max(max, c.order + 1), 0);
  const collection: MockCollection = {
    id: `coll-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    name,
    order,
  };
  mockCollections.push(collection);
  return collection;
}

export async function mockRenameCollection(id: string, name: string): Promise<void> {
  const collection = mockCollections.find((c) => c.id === id);
  if (collection) collection.name = name;
}

export async function mockReorderCollections(orderedIds: string[]): Promise<void> {
  orderedIds.forEach((id, i) => {
    const collection = mockCollections.find((c) => c.id === id);
    if (collection) collection.order = i;
  });
}

export async function mockDeleteCollection(id: string): Promise<void> {
  mockCollections = mockCollections.filter((c) => c.id !== id);
  // Strip the id from every series' memberships, and PRUNE any left with none — the host does
  // exactly this for series/chapter favorites, which only ever existed as collection members.
  for (const [key, ids] of mockSeriesCollections) {
    const next = ids.filter((x) => x !== id);
    if (next.length === 0) mockSeriesCollections.delete(key);
    else mockSeriesCollections.set(key, next);
  }
}

export async function mockSetSeriesCollections(
  bridgeId: string,
  seriesId: string,
  collectionIds: string[],
): Promise<void> {
  const key = libKey(bridgeId, seriesId);
  // Empty means the series item is GONE — it exists only as a member, so un-filing the last
  // collection uncollects it outright (the runtime's cascade). Read progress survives.
  if (collectionIds.length === 0) {
    mockSeriesCollections.delete(key);
    mockLibrary.delete(key);
  } else mockSeriesCollections.set(key, [...collectionIds]);
}

// ─── Collected page items (in-memory, dev/demo only) ─────────────────────────
// Keyed by the same coordinate tuple the real ids encode. Memberships live on the record, and an
// empty membership array removes it — pure collections, same as the runtime.

type MockPageItem = {
  type: 'page';
  /** Same derived, prefixed shape the runtime mints (`page:b:s:c:i`, each part URL-encoded).
   *  Internal — nothing addresses an item by id, since a reconcile re-keys it. */
  id: string;
  bridgeId: string;
  seriesId: string;
  chapterId: string;
  pageIndex: number;
  collectedAt: number;
  collectionIds: string[];
  seriesTitle: string;
  chapterName?: string;
  pageCount?: number;
  sourceUrl?: string;
  contentHash?: string;
  stale?: boolean;
};

const pageItemKey = (b: string, s: string, c: string, i: number) => `${b}:${s}:${c}:${i}`;
const pageItemId = (b: string, s: string, c: string, i: number) =>
  ['page', b, s, c, String(i)].map(encodeURIComponent).join(':');
const mockPageItems = new Map<string, MockPageItem>();
let mockCollectedAt = 1_760_000_000_000;

export async function mockGetCollectedItems(query: {
  type?: string;
  sort?: string;
  dir?: string;
  collection?: string;
  series?: string;
  q?: string;
} = {}): Promise<(MockPageItem | MockChapterItem | MockSeriesItem)[]> {
  // Omitting `type` returns the MIXED union, exactly as the real route does — a caller that
  // wants only pages has to say so, and one that forgets gets series and chapters too.
  let items: (MockPageItem | MockChapterItem | MockSeriesItem)[] = [
    ...(query.type === undefined || query.type === 'page' ? mockPageItems.values() : []),
    ...(query.type === undefined || query.type === 'chapter' ? mockChapterItems.values() : []),
    ...(query.type === undefined || query.type === 'series' ? seriesItems() : []),
  ];
  if (query.collection) items = items.filter((i) => i.collectionIds.includes(query.collection!));
  if (query.series) items = items.filter((i) => `${i.bridgeId}:${i.seriesId}` === query.series);
  const q = query.q?.trim().toLowerCase();
  if (q) {
    items = items.filter(
      (i) =>
        i.seriesTitle.toLowerCase().includes(q) ||
        ('chapterName' in i ? (i.chapterName ?? '') : '').toLowerCase().includes(q),
    );
  }
  const pos = (i: MockPageItem | MockChapterItem | MockSeriesItem) =>
    // Within one series, the runtime interleaves so a series leads its chapters and a chapter
    // leads its pages. Rank by type, then by the item's own position.
    i.type === 'series' ? [0, 0] : i.type === 'chapter' ? [1, i.number ?? 0] : [2, i.pageIndex];
  const cmp = (a: typeof items[number], b: typeof items[number]) => {
    if (query.sort === 'series' || query.sort === 'chapter') {
      const byTitle = a.seriesTitle.localeCompare(b.seriesTitle);
      if (byTitle !== 0) return byTitle;
      const [ar, av] = pos(a);
      const [br, bv] = pos(b);
      return ar! - br! || av! - bv!;
    }
    return a.collectedAt - b.collectedAt;
  };
  items.sort(cmp);
  // 'added' defaults to newest-first, the others to ascending — matching the runtime.
  const desc = query.dir ? query.dir === 'desc' : (query.sort ?? 'added') === 'added';
  if (desc) items.reverse();
  return items;
}

/** Series items are synthesized from the memberships map plus the library entry's display fields —
 *  the mock stores memberships rather than whole records for series (see `mockSeriesCollections`). */
// The full `CollectionSeriesItem` wire shape — a tracked series IS this now, so the mixed
// `/library/collected` union carries the same record the library grid is built from.
type MockSeriesItem = {
  type: 'series';
  id: string;
  bridgeId: string;
  seriesId: string;
  collectedAt: number;
  updatedAt: number;
  collectionIds: string[];
  seriesTitle: string;
  thumbnailUrl?: string;
  /** The unread baseline. Empty in the mock: nothing here derives unread counts from it. */
  knownChapters: { id: string; number?: number; languageCode?: string }[];
  stale?: boolean;
};

function seriesItems(): MockSeriesItem[] {
  const out: MockSeriesItem[] = [];
  // Driven by the LIBRARY, not by the membership map: every collected series is a series item,
  // including one transiently filed nowhere (legal, and what `?uncollected=true` lists).
  for (const [key, entry] of mockLibrary) {
    const [bridgeId = '', seriesId = ''] = key.split(':');
    out.push({
      type: 'series',
      id: ['series', bridgeId, seriesId].map(encodeURIComponent).join(':'),
      bridgeId,
      seriesId,
      collectedAt: entry.collectedAt,
      updatedAt: entry.collectedAt,
      collectionIds: [...(mockSeriesCollections.get(key) ?? [])],
      knownChapters: [],
      seriesTitle: entry.title,
      ...(entry.thumbnailUrl !== undefined && { thumbnailUrl: entry.thumbnailUrl }),
    });
  }
  return out;
}

export async function mockGetChapterPageIndices(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
): Promise<number[]> {
  return [...mockPageItems.values()]
    .filter((i) => i.bridgeId === bridgeId && i.seriesId === seriesId && i.chapterId === chapterId && !i.stale)
    .map((i) => i.pageIndex)
    .sort((a, b) => a - b);
}

export async function mockReconcileChapterPages(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pages: { url?: string; contentHash?: string }[],
): Promise<{ indices: number[]; repaired: number; stale: number }> {
  // The mock never rewrites URLs, so nothing ever drifts here — report the stored indices as-is,
  // with the same shape the real route returns.
  void pages;
  return { indices: await mockGetChapterPageIndices(bridgeId, seriesId, chapterId), repaired: 0, stale: 0 };
}

export async function mockCollectPage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
  snapshot: {
    seriesTitle: string;
    chapterName?: string;
    pageCount?: number;
    sourceUrl?: string;
    contentHash?: string;
  },
): Promise<void> {
  const key = pageItemKey(bridgeId, seriesId, chapterId, pageIndex);
  const existing = mockPageItems.get(key);
  // MERGE, don't rebuild: a supplied field wins as fresher, an omitted one is preserved. The
  // two-PUT hash flow depends on this — a follow-up carrying only `contentHash` must not wipe
  // `pageCount`, which is reconcile's fallback signal.
  mockPageItems.set(key, {
    type: 'page',
    id: pageItemId(bridgeId, seriesId, chapterId, pageIndex),
    bridgeId,
    seriesId,
    chapterId,
    pageIndex,
    collectedAt: existing?.collectedAt ?? mockCollectedAt++,
    collectionIds: existing?.collectionIds ?? [],
    seriesTitle: snapshot.seriesTitle,
    ...((snapshot.chapterName ?? existing?.chapterName) !== undefined && {
      chapterName: snapshot.chapterName ?? existing?.chapterName,
    }),
    ...((snapshot.pageCount ?? existing?.pageCount) !== undefined && {
      pageCount: snapshot.pageCount ?? existing?.pageCount,
    }),
    ...((snapshot.sourceUrl ?? existing?.sourceUrl) !== undefined && {
      sourceUrl: snapshot.sourceUrl ?? existing?.sourceUrl,
    }),
    ...((snapshot.contentHash ?? existing?.contentHash) !== undefined && {
      contentHash: snapshot.contentHash ?? existing?.contentHash,
    }),
  });
}

export async function mockUncollectPage(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
): Promise<void> {
  mockPageItems.delete(pageItemKey(bridgeId, seriesId, chapterId, pageIndex));
}

export async function mockSetPageCollections(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  pageIndex: number,
  collectionIds: string[],
): Promise<void> {
  const key = pageItemKey(bridgeId, seriesId, chapterId, pageIndex);
  const item = mockPageItems.get(key);
  if (!item) return;
  // Empty memberships removes the item, exactly as the real route does.
  if (collectionIds.length === 0) mockPageItems.delete(key);
  else mockPageItems.set(key, { ...item, collectionIds: [...collectionIds] });
}

// Chapter items. Same store shape as pages, minus the page index — and the same rule that an item
// with no memberships doesn't exist.

type MockChapterItem = {
  type: 'chapter';
  id: string;
  bridgeId: string;
  seriesId: string;
  chapterId: string;
  collectedAt: number;
  collectionIds: string[];
  seriesTitle: string;
  chapterName?: string;
  number?: number;
  languageCode?: string;
  stale?: boolean;
};

const chapterItemKey = (b: string, s: string, c: string) => `${b}:${s}:${c}`;
const chapterItemId = (b: string, s: string, c: string) =>
  ['chapter', b, s, c].map(encodeURIComponent).join(':');
const mockChapterItems = new Map<string, MockChapterItem>();

export async function mockCollectChapter(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  snapshot: { seriesTitle: string; chapterName?: string; number?: number; languageCode?: string },
): Promise<void> {
  const key = chapterItemKey(bridgeId, seriesId, chapterId);
  const existing = mockChapterItems.get(key);
  // MERGE, as the real route does — a partial re-collect must not drop the re-anchor identity.
  mockChapterItems.set(key, {
    type: 'chapter',
    id: chapterItemId(bridgeId, seriesId, chapterId),
    bridgeId,
    seriesId,
    chapterId,
    collectedAt: existing?.collectedAt ?? mockCollectedAt++,
    collectionIds: existing?.collectionIds ?? [],
    seriesTitle: snapshot.seriesTitle,
    ...((snapshot.chapterName ?? existing?.chapterName) !== undefined && {
      chapterName: snapshot.chapterName ?? existing?.chapterName,
    }),
    ...((snapshot.number ?? existing?.number) !== undefined && {
      number: snapshot.number ?? existing?.number,
    }),
    ...((snapshot.languageCode ?? existing?.languageCode) !== undefined && {
      languageCode: snapshot.languageCode ?? existing?.languageCode,
    }),
  });
}

export async function mockUncollectChapter(bridgeId: string, seriesId: string, chapterId: string): Promise<void> {
  mockChapterItems.delete(chapterItemKey(bridgeId, seriesId, chapterId));
}

export async function mockSetChapterCollections(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  collectionIds: string[],
): Promise<void> {
  const key = chapterItemKey(bridgeId, seriesId, chapterId);
  const item = mockChapterItems.get(key);
  if (!item) return;
  if (collectionIds.length === 0) mockChapterItems.delete(key);
  else mockChapterItems.set(key, { ...item, collectionIds: [...collectionIds] });
}

export async function mockGetSeriesCollections(bridgeId: string, seriesId: string): Promise<string[]> {
  return [...(mockSeriesCollections.get(libKey(bridgeId, seriesId)) ?? [])];
}

/** Upsert a history row (used by both a library progress write and a non-library read log). */
function upsertMockHistory(h: MockHist): void {
  mockHistory.set(libKey(h.bridgeId, h.seriesId), h);
}

/**
 * Read-state OVERRIDES, keyed `bridge:series` → chapter id → read. Only what the user changed in
 * this session lives here: a mock series' chapters are generated with deterministic `read` flags
 * (see `mockChapters`), and this map layers on top of them rather than replacing them — so the
 * demo still opens with a plausible half-read series, and marking a chapter read/unread visibly
 * sticks. Mirrors what the real backend persists per library entry.
 */
const mockProgress = new Map<string, Map<string, ChapterProgress>>();

function mockProgressFor(bridgeId: string, seriesId: string): Map<string, ChapterProgress> {
  const key = libKey(bridgeId, seriesId);
  let m = mockProgress.get(key);
  if (!m) mockProgress.set(key, (m = new Map()));
  return m;
}

export async function mockGetChapterProgress(bridgeId: string, seriesId: string): Promise<ChapterProgress[]> {
  return [...mockProgressFor(bridgeId, seriesId).values()].map((p) => ({ ...p }));
}

export async function mockSetChaptersRead(
  bridgeId: string,
  seriesId: string,
  chapters: Chapter[],
  read: boolean,
): Promise<void> {
  const m = mockProgressFor(bridgeId, seriesId);
  for (const c of chapters) {
    m.set(c.id, {
      chapterId: c.id,
      read,
      ...(c.number !== undefined && { number: c.number }),
      ...(c.languageCode !== undefined && { languageCode: c.languageCode }),
    });
  }
}

/** Same rule as `@comical/library`'s `markReadUpTo`: everything at or below the target's chapter
 *  number, within the target's language only, across every scanlation group. Falls back to the
 *  supplied order for chapters with no number (which never sort reliably by date). */
export async function mockMarkReadUpTo(
  bridgeId: string,
  seriesId: string,
  chapters: Chapter[],
  chapterId: string,
): Promise<void> {
  const ordered = [...chapters].sort((a, b) => {
    if (a.number !== undefined && b.number !== undefined) return a.number - b.number;
    if (a.number !== undefined) return -1;
    if (b.number !== undefined) return 1;
    return 0;
  });
  const cut = ordered.findIndex((c) => c.id === chapterId);
  if (cut === -1) return;
  const target = ordered[cut]!;
  const within = ordered.filter((c, i) => {
    if (c.languageCode !== target.languageCode) return false;
    return target.number !== undefined && c.number !== undefined ? c.number <= target.number : i <= cut;
  });
  await mockSetChaptersRead(bridgeId, seriesId, within, true);
}

export async function mockRecordChapterProgress(
  bridgeId: string,
  seriesId: string,
  chapterId: string,
  update: { lastPage?: number; pageCount?: number; chapterName?: string },
): Promise<void> {
  // Reaching the last page marks the chapter read, exactly as the host's `setProgress` does — so a
  // chapter finished in the demo reader also shows up read in the chapter list.
  const { lastPage, pageCount } = update;
  if (lastPage !== undefined && pageCount !== undefined && pageCount > 0 && lastPage >= pageCount - 1) {
    const existing = mockProgressFor(bridgeId, seriesId).get(chapterId);
    mockProgressFor(bridgeId, seriesId).set(chapterId, { ...existing, chapterId, read: true });
  }
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

export async function mockMarkActivityRead(bridgeId: string, seriesId: string): Promise<void> {
  mockActivity = mockActivity.map((a) =>
    a.bridgeId === bridgeId && a.seriesId === seriesId ? { ...a, read: true } : a,
  );
}

export async function mockClearActivity(): Promise<void> {
  mockActivity = [];
}

export async function mockClearActivityForEntry(bridgeId: string, seriesId: string): Promise<void> {
  mockActivity = mockActivity.filter((a) => !(a.bridgeId === bridgeId && a.seriesId === seriesId));
}

export async function mockCheckForUpdates(): Promise<{ newChapters: number; partial: boolean }> {
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
  return { newChapters: 1, partial: false };
}

// ─── Settings + registries ────────────────────────────────────────────────────
// Minimal, non-throwing stand-ins — Settings isn't a screen mock-data users will heavily
// exercise, so no fake registry catalog or bridge settings forms, just empty/no-op shapes.

export async function mockGetBridgeSummaries(): Promise<BridgeSummary[]> {
  const bridges = await mockGetBridges();
  return bridges.map((b) => {
    // A favorites-capable bridge the user hasn't logged into still has its required credential missing
    // — so `missingRequired` is non-empty and the favorites gate (see useFavoritesAvailability) treats
    // it as unavailable, greying its star and dropping it from the consolidated Favorites page.
    const loggedOut = MOCK_LOGGED_OUT_BRIDGES.has(b.name);
    return {
      info: b,
      configured: !loggedOut,
      missingRequired: loggedOut ? ['apiKey'] : [],
      source: 'local' as const,
    };
  });
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
    settings: [
      { type: 'string', key: 'apiKey', label: 'API key', description: 'Your personal access token.', required: true, secret: true },
      { type: 'string', key: 'username', label: 'Username', placeholder: 'you@example.com' },
      { type: 'boolean', key: 'hd', label: 'High quality', description: 'Load full-resolution images.', default: true },
      { type: 'number', key: 'perPage', label: 'Items per page', min: 10, max: 100, default: 20 },
      { type: 'enum', key: 'lang', label: 'Language', options: [{ value: 'en', label: 'English' }, { value: 'ja', label: 'Japanese' }] },
      { type: 'enum', key: 'tags', label: 'Default tags', multiple: true, options: [{ value: 'a', label: 'Action' }, { value: 'r', label: 'Romance' }, { value: 'c', label: 'Comedy' }] },
    ],
    values: { username: 'demo', hd: true, perPage: 20, lang: 'en', tags: ['a'] },
    secretsSet: ['apiKey'],
    missingRequired: ['apiKey'],
    configured: false,
    excludedTags: [],
    excludedTagLabels: {},
    maxContentRating: null,
  };
}

export async function mockPutBridgeSettings(_bridgeId: string, _values: Record<string, SettingValue>): Promise<void> {}
export async function mockUpdateBridge(_bridgeId: string): Promise<void> {}
export async function mockUninstallBridge(_bridgeId: string): Promise<void> {}
export async function mockPutExcludedTags(_bridgeId: string, _tags: { id: string; label: string }[]): Promise<void> {}
export async function mockPutMaxContentRating(_bridgeId: string, _rating: ContentRating | null): Promise<void> {}
export async function mockGetBridgePrefs(bridgeId: string): Promise<BridgePrefs> {
  return { bridgeId, trackersDisabled: false, historyDisabled: false };
}
export async function mockPutBridgePrefs(
  _bridgeId: string,
  _update: { trackersDisabled?: boolean; historyDisabled?: boolean },
): Promise<void> {}

export async function mockGetTrackers(): Promise<TrackerSummary[]> {
  return TRACKER_SERVICES.map((s) => ({
    info: { id: s.id, name: s.name, capabilities: ['library-sync', 'search'] },
    configured: true,
    missingRequired: [],
    source: 'registry' as const,
  }));
}

export async function mockGetTrackerSettings(trackerId: string): Promise<TrackerSettingsInfo> {
  return { info: { id: trackerId, name: trackerId, capabilities: [] }, settings: [], values: {}, secretsSet: [] };
}

export async function mockPutTrackerSettings(_trackerId: string, _values: Record<string, SettingValue>): Promise<void> {}
export async function mockUpdateTracker(_trackerId: string): Promise<void> {}
export async function mockUninstallTracker(_trackerId: string): Promise<void> {}

// ─── Tracker links (per-series, in-memory) ────────────────────────────────────

const mockTrackerLinksByEntry = new Map<string, TrackerLink[]>();

/** Seeds a series' links deterministically the first time its tracker panel is opened, so mock
 *  mode still shows a couple of pre-linked trackers out of the box — the same seeding `mockSeries`
 *  used to do inline, now keyed per bridgeId+seriesId (via `libKey`) instead of just the series id,
 *  since a real link is scoped to one library entry. */
function seedMockTrackerLinks(bridgeId: string, seriesId: string): TrackerLink[] {
  const key = libKey(bridgeId, seriesId);
  let links = mockTrackerLinksByEntry.get(key);
  if (!links) {
    const h = hash(seriesId);
    links = mockTrackerLinks(seriesId, 40 + (h % 160));
    mockTrackerLinksByEntry.set(key, links);
  }
  return links;
}

export async function mockGetTrackerLinks(bridgeId: string, seriesId: string): Promise<TrackerLink[]> {
  return [...seedMockTrackerLinks(bridgeId, seriesId)];
}

export async function mockLinkTracker(bridgeId: string, seriesId: string, trackerId: string, externalId: string): Promise<void> {
  await delay(TRACKER_ACTION_DELAY_MS);
  const links = seedMockTrackerLinks(bridgeId, seriesId).filter((l) => l.trackerId !== trackerId);
  links.push({ trackerId, externalId, chaptersRead: 0 });
  mockTrackerLinksByEntry.set(libKey(bridgeId, seriesId), links);
}

export async function mockUnlinkTracker(bridgeId: string, seriesId: string, trackerId: string): Promise<void> {
  await delay(TRACKER_ACTION_DELAY_MS);
  const links = seedMockTrackerLinks(bridgeId, seriesId).filter((l) => l.trackerId !== trackerId);
  mockTrackerLinksByEntry.set(libKey(bridgeId, seriesId), links);
}

/** Simulates a real two-way sync: bumps the link's progress + `lastSyncAt`, mirroring the old fake
 *  local-state bump that used to live directly in the (now-deleted) mock stub panel. Always reports
 *  the pull side — the mock has no local read-state to be ahead of the tracker with. */
export async function mockSyncTrackerLink(
  bridgeId: string,
  seriesId: string,
  trackerId: string,
): Promise<TrackerLinkSyncResult> {
  await delay(TRACKER_ACTION_DELAY_MS);
  const link = seedMockTrackerLinks(bridgeId, seriesId).find((l) => l.trackerId === trackerId);
  if (!link) return { updated: false, readSynced: 0, pushed: false, chaptersRead: 0 };
  link.chaptersRead = (link.chaptersRead ?? 0) + 1;
  link.lastSyncAt = Date.now();
  return { updated: true, readSynced: 1, pushed: false, chaptersRead: link.chaptersRead };
}

const mockRegistries: SavedRegistry[] = [];

export async function mockGetRegistries(): Promise<SavedRegistry[]> {
  // A COPY, not the live array: add/remove mutate `mockRegistries` in place, so returning the same
  // reference every fetch makes react-query (and React) see "unchanged" data — the Registries
  // screen never re-rendered after an add.
  return [...mockRegistries];
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
