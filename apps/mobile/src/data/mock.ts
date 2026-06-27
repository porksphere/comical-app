/**
 * Mock data for the Browse and Series screens.
 *
 * These types intentionally mirror the eventual `@porksphere/core` bridge
 * contract: a `SeriesEntry` with mostly OPTIONAL sections, since not every
 * bridge supplies every section (genres, tag groups, stats, related rail,
 * page thumbnails, …). The UI renders each section only when its field is
 * present/non-empty — so wiring real bridge data later means replacing the
 * generators below, not the components that read them.
 */

export type BadgePosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type BadgeTone = 'info' | 'warn' | 'success' | 'neutral';

export type CardBadge = {
  text: string;
  position?: BadgePosition;
  tone?: BadgeTone;
};

/** A series as it appears on a card (grid or rail). */
export type SeriesEntry = {
  id: string;
  title: string;
  /** Secondary line under the title (e.g. latest chapter, author). */
  sub?: string;
  cover: string;
  /** Bridge-defined overlay badges. */
  badges?: CardBadge[];
  /** Unread-count pill (top-right). */
  unread?: number;
};

export type TagGroup = { label: string; tags: string[] };
export type MetaCell = { label: string; value: string };

export type Chapter = {
  id: string;
  /** Display name, e.g. "Chapter 176 — The Spirit Zone". */
  name: string;
  /** Epoch ms the chapter was published. */
  date: number;
  read?: boolean;
};

/** Full series detail. Optional fields are per-bridge dynamic. */
export type SeriesDetail = SeriesEntry & {
  bridge: string;
  chapterCount?: number;
  /** Primary read affordance label (e.g. "▶ Chapter 1 — …"). */
  readLabel?: string;
  genres?: string[];
  tagGroups?: TagGroup[];
  meta?: MetaCell[];
  description?: string;
  /** Chaptered series. Mutually exclusive with `pageThumbs` (direct series). */
  chapters?: Chapter[];
  /** Direct series: page-preview thumbnails instead of a chapter list. */
  pageThumbs?: string[];
  /** Whether the bridge exposes external sources / trackers actions. */
  hasSources?: boolean;
  hasTrackers?: boolean;
  /** "N new" badge in the actions column. */
  newCount?: number;
  /** Related rail — absent for many bridges. */
  related?: SeriesEntry[];
};

export type RailKind = 'hero' | 'ranked' | 'regular';
export type RailSection = {
  id: string;
  title: string;
  kind: RailKind;
  items: SeriesEntry[];
};

/**
 * An intentionally very long title — used to exercise the card's clamp +
 * full-title peek (the title truncates with "…" and reveals on hover/hold).
 * Length is in the spirit of real bridge titles (e.g. light-novel adaptations).
 */
export const LONG_TITLE =
  'I Got a Cheat Skill in Another World and Became Unrivaled in the Real World, Too: The Saga of the Reincarnated Cartographer';

const TITLES = [
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

/** Home page: a vertical stack of rails (hero / ranked / regular). */
export function mockHomeSections(): RailSection[] {
  const featured = items('hero', 6, { sub: true });
  // Force the lead featured card to carry the very long title (and a stable id
  // whose detail page also gets the "ton of tags" treatment) so the clamp/peek
  // and tag-wrapping can be checked from a known card.
  featured[0] = { ...featured[0], id: 'featured-long', title: LONG_TITLE };
  return [
    { id: 'featured', title: 'Featured', kind: 'hero', items: featured },
    { id: 'trending', title: 'Trending now', kind: 'ranked', items: items('rank', 10, { sub: true }) },
    { id: 'updates', title: 'Latest updates', kind: 'regular', items: items('upd', 14, { badges: true, unread: true, sub: true }) },
    { id: 'popular', title: 'Popular this season', kind: 'regular', items: items('pop', 14, { badges: true }) },
    { id: 'newish', title: 'Newly added', kind: 'regular', items: items('new', 14, { badges: true }) },
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

/**
 * Build a series detail. `id` seeds deterministic content; a couple of seeds
 * exercise the per-bridge-dynamic branches so the UI can be checked with and
 * without optional sections:
 *  - id containing "direct" → direct series (page thumbnails, no chapters)
 *  - id containing "bare"   → minimal bridge (no genres/tags/stats/related)
 */
export function mockSeries(id: string, title?: string, bridge = 'Library'): SeriesDetail {
  const seed = id || title || 'series';
  const direct = seed.includes('direct');
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
    base.pageThumbs = Array.from({ length: 24 }, (_, i) => cover(`${seed}-p${i}`));
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
    base.newCount = h % 5 === 0 ? 3 : undefined;
    base.related = items(`${seed}-rel`, 12, { sub: true });
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
