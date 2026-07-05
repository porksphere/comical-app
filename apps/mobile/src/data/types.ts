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

export type TagGroup = {
  label: string;
  tags: string[];
  /** Bridge-internal tag ids parallel to `tags` (same index). Present when the
   *  bridge's tags are a filterable id set — tapping a chip selects the bridge's
   *  tag-multiselect filter by that id. */
  tagIds?: string[];
  /** Ready-to-run free-text search string per tag, parallel to `tags` (same
   *  index). Present for backends whose tags aren't a filterable id set but whose
   *  search box accepts tag syntax (e.g. example-source) — tapping runs that search
   *  instead of selecting a filter. Mutually exclusive with `tagIds` per group in
   *  practice. */
  tagQueries?: string[];
};
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

/** A page-preview thumbnail source, mirroring the bridge contract's `PageThumbnail` union:
 *  - `image` — a ready-to-display URL, rendered with a normal image loader.
 *  - `sprite` — a tile inside a shared sprite sheet (some bridges, e.g. example-source's viewer, pack
 *    many thumbnails into one image to save requests). `sheetUrl` is shared across every tile cut
 *    from the same sheet, so fetching it once and cropping `{x,y,w,h}` out of it client-side (no
 *    server-side recompression) is cheap even for a full page grid. `sheetWidth`/`sheetHeight` are
 *    the full sheet's pixel dimensions, needed to scale the crop correctly for a given tile width.
 */
export type SpriteThumb = {
  kind: 'sprite';
  sheetUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sheetWidth: number;
  sheetHeight: number;
};
export type PageThumbSource = { kind: 'image'; url: string } | SpriteThumb;

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
  /** Direct series: page-preview thumbnails instead of a chapter list. One entry per page,
   *  index-aligned (array position === page index, since the reader's `start` param depends on
   *  it) — `null` means the bridge didn't supply this one inline and `PageThumbGrid` should
   *  lazy-fetch it. Never a full-size page image: if the bridge has no thumbnail data at all, the
   *  grid doesn't render rather than bulk-loading full pages as a preview. */
  pageThumbs?: (PageThumbSource | null)[];
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
  /** True when the bridge omitted `relatedGroups` from this response and a
   *  separate `getRelatedGroups` fetch is needed to find out whether it has
   *  any (e.g. nhentai's capability "related-series") — lets the series
   *  screen show a rail skeleton instead of treating "absent" as "none". */
  relatedGroupsDeferred?: boolean;
};

// ─── Local library / history / activity ──────────────────────────────────────
// The user's own cross-bridge collection + reading progress (see @comical/library). Each item
// carries its own `bridgeId` (unlike browse cards, which inherit one bridge for the whole grid).

/** One series in the library grid. Maps to a `SeriesCard` `entry` + its own bridge. */
export type LibraryItem = {
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  author?: string;
  /** Logical unread chapters — drives the card's unread pill. */
  unread: number;
};

/** Sentinel `chapterId` recorded for a direct (chapterless) series — its
 *  "chapter" is just the series itself, so there's no real chapter id to store. */
export const DIRECT_CHAPTER_ID = '__direct__';

/** One row in the reading-history list (a recently-read series, newest first). */
export type HistoryEntry = {
  bridgeId: string;
  seriesId: string;
  title: string;
  thumbnailUrl?: string;
  /** Last-read chapter (the resume target). `DIRECT_CHAPTER_ID` for a chapterless series. */
  chapterId?: string;
  chapterName?: string;
  /** Resume page (0-based) within `chapterId`, and that chapter's page count, for "page X / N". */
  lastPage?: number;
  pageCount?: number;
  lastReadAt: number;
};

/** One row in the activity feed (a newly-detected chapter across the library). */
export type ActivityEntry = {
  bridgeId: string;
  seriesId: string;
  chapterId: string;
  title: string;
  thumbnailUrl?: string;
  chapterName?: string;
  /** Decimal chapter number, when the bridge supplies it (fallback label source). */
  number?: number;
  /** When `syncChapters` first observed this chapter (epoch ms) — the feed sorts on this. */
  detectedAt: number;
  /** Derived: true once the user has read this chapter (clears it from the unread badge). */
  read: boolean;
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
