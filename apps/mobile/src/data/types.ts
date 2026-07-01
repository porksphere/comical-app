/**
 * Shared UI-facing data shapes for the Browse/Series/Reader screens. These
 * intentionally mirror the eventual `@porksphere/core` bridge contract: a
 * `SeriesEntry` with mostly OPTIONAL sections, since not every bridge supplies
 * every section (genres, tag groups, stats, related rail, page thumbnails, …).
 * Components render each section only when its field is present/non-empty —
 * so both the real API adapter (`api.ts`) and the mock generator (`mock.ts`)
 * target these same types.
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
  /** Matched the user's persistent tag/genre exclusions — render as a redacted,
   *  non-interactive "Hidden" placeholder instead of the real cover/title. */
  excluded?: boolean;
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

/** A trackable progress service (AniList, MyAnimeList, …) a series can be linked to. */
export type TrackerService = { id: string; name: string };

/** A series-to-tracker link, mirroring the reference's tracker-link rows
 *  (name + external id + read progress + last sync time). */
export type TrackerLink = {
  trackerId: string;
  externalId: string;
  externalTitle: string;
  chaptersRead?: number;
  lastSyncAt?: number;
};

/** One row from a tracker's catalog search, used by the "+ Link tracker" form. */
export type TrackerSearchResult = { externalId: string; title: string; thumbnail: string };

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
  /** Trackers currently linked to this series (empty array = none linked yet). */
  trackers?: TrackerLink[];
  /** "N new" badge in the actions column. */
  newCount?: number;
  /** Related-series rails, each independently labeled (sequels, similar, …) — a
   *  bridge may surface any number of these; absent for many bridges. */
  relatedGroups?: { label: string; items: SeriesEntry[] }[];
};

export type RailKind = 'hero' | 'ranked' | 'regular';
export type RailSection = {
  id: string;
  title: string;
  kind: RailKind;
  items: SeriesEntry[];
};

/** A page of grid results, with enough info to drive infinite scroll. */
export type GridPage = {
  items: SeriesEntry[];
  hasNextPage: boolean;
};

/**
 * A grid-layout home section. Home can stack more than one of these (e.g. a
 * bridge's "Completed" and "Latest" lists); only the LAST one in the stack is
 * the infinite-scroll terminal section — every earlier one paginates via an
 * explicit "Load more" affordance, mirroring comical-web's `attachInfinite`
 * being wired only to the final grid list.
 */
export type HomeGridSection = {
  id: string;
  title: string;
  items: SeriesEntry[];
  hasNextPage: boolean;
};

/** An installed bridge, as surfaced by the bridge selector. */
export type Bridge = { id: string; name: string; nsfw: boolean; capabilities: string[]; thumbnail?: string };
/** One of a bridge's browsable lists (home section or standalone page). */
export type BridgeList = {
  id: string;
  name: string;
  page: boolean;
  /** Presentation hint for home sections; absent lists render as a 'regular' rail. */
  layout?: 'carousel' | 'grid' | 'ranked' | 'hero';
  /** Whether a query can be scoped to this list (routes search through it instead of `/search`). */
  searchable?: boolean;
};
