/**
 * Shared UI-facing data shapes for the Browse/Series/Reader screens. These
 * intentionally mirror the `@comical/*` bridge contract: a
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
  /** Semantic axis of the group (mirrors the contract's `TagKind`). The client only special-cases
   *  `'genre'`: it renders like any other group (colour + heading), but a tapped genre chip drives the
   *  bridge's *genre* filter (key "genre") rather than the tag-multiselect, and it gets a reserved
   *  palette slot. There is no separate flat `genres` field. */
  kind?: 'genre' | 'theme' | 'demographic' | 'format' | 'content-warning' | 'other';
  tags: string[];
  /** Bridge-internal tag ids parallel to `tags` (same index). Present when the
   *  bridge's tags are a filterable id set — tapping a chip selects the bridge's
   *  tag-multiselect filter by that id. */
  tagIds?: string[];
  /** Ready-to-run free-text search string per tag, parallel to `tags` (same
   *  index). Present for backends whose tags aren't a filterable id set but whose
   *  search box accepts tag syntax — tapping runs that search
   *  instead of selecting a filter. Mutually exclusive with `tagIds` per group in
   *  practice. */
  tagQueries?: string[];
};
export type MetaCell = { label: string; value: string };

export type Chapter = {
  id: string;
  /** Display name, e.g. "Chapter 176 — The Coast Road". */
  name: string;
  /** Epoch ms the chapter was published (mirrors the contract's `publishedAt`). */
  date: number;
  read?: boolean;
  /** Decimal chapter number when the bridge supplies it (e.g. 10.5). This — NOT the
   *  array order or `date` — is the source of truth for reading order and for
   *  collapsing multi-scanlator copies of the same chapter. See `@/lib/chapter-order`. */
  number?: number;
  /** The party that produced this version (scanlation team, publisher, …); disambiguates
   *  when a site carries multiple versions of the same chapter number. */
  group?: string;
  /** BCP-47-ish language code of this version; groups only collapse within one language. */
  languageCode?: string;
  /** Page count, when the backend exposes it without opening the chapter. */
  pageCount?: number;
};

/**
 * Persisted read-state for one chapter of a *library* series (`@comical/library`'s
 * `ChapterProgress`). Kept separate from `Chapter` on purpose: chapters come from the bridge and
 * are cached per series, read state is local library data that changes independently — so it gets
 * its own query and can be invalidated without re-fetching the chapter list over the network.
 * A series that isn't in the library simply has none.
 */
export type ChapterProgress = {
  chapterId: string;
  read: boolean;
  /** Mirrors `Chapter.number` — lets read state collapse by logical chapter, and lets the host
   *  compute the high-water mark trackers want as `chaptersRead`. */
  number?: number;
  /** Mirrors `Chapter.languageCode` — read state collapses within one language only. */
  languageCode?: string;
};

/** A trackable progress service (AniList, MyAnimeList, …) a series can be linked to. */
export type TrackerService = { id: string; name: string };

/** A series-to-tracker link, mirroring the reference's tracker-link rows
 *  (name + external id + read progress + last sync time). `externalTitle` is mock-only flavor —
 *  the real backend's `TrackerLink` (`@comical/library`) doesn't persist a catalog title, only the
 *  id + progress the tracker reports back, so it's optional and unused past the link step. */
export type TrackerLink = {
  trackerId: string;
  externalId: string;
  externalTitle?: string;
  chaptersRead?: number;
  lastSyncAt?: number;
};

/** One row from a tracker's catalog search, used by the "+ Link tracker" form. */
export type TrackerSearchResult = { externalId: string; title: string; thumbnailUrl?: string };

/** A page-preview thumbnail source, mirroring the bridge contract's `PageThumbnail` union:
 *  - `image` — a ready-to-display URL, rendered with a normal image loader.
 *  - `sprite` — a tile inside a shared sprite sheet (some bridges pack many thumbnails into one
 *    image to save requests). `sheetUrl` is shared across every tile cut
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
  /** All taxonomies as labeled groups; genres are the `kind: "genre"` group (no separate field). */
  tagGroups?: TagGroup[];
  meta?: MetaCell[];
  description?: string;
  /** Whether the bridge exposes external sources actions. */
  hasSources?: boolean;
  /** "N new" badge in the actions column. */
  newCount?: number;
  /** Related-series rails, each independently labeled (sequels, similar, …) — a
   *  bridge may surface any number of these; absent for many bridges. */
  relatedGroups?: { label: string; items: SeriesEntry[] }[];
  /** True when the bridge omitted `relatedGroups` from this response and a
   *  separate `getRelatedGroups` fetch is needed to find out whether it has
   *  any (a bridge with capability "related-series") — lets the series
   *  screen show a rail skeleton instead of treating "absent" as "none". */
  relatedGroupsDeferred?: boolean;
  /** True when `getSeriesDetail` returned only the fast info payload and left the
   *  chapter list / page-thumbnail grid to a separate `getSeriesList` fetch. The
   *  series screen paints the (info-based) hero/meta/description immediately and
   *  streams the list into its section with a skeleton — the chapter/page LIST
   *  request is the ~200ms bottleneck, so it must not block the body render. */
  listDeferred?: boolean;
  /** True when the host served this from the library's offline metadata cache (the bridge couldn't
   *  answer — device/server offline from the source, or the bridge uninstalled). The series page
   *  shows a "saved details" affordance and dims chapters that aren't downloaded. */
  cached?: boolean;
  /** When the cached detail was captured (epoch ms) — shown as "updated X ago". */
  cachedAt?: number;
};

/** Result of the deferred `getSeriesList` fetch: the chapter list (chaptered) OR
 *  the page-thumbnail grid (direct), plus the count/label those imply — merged
 *  into the already-rendered `SeriesDetail` once it arrives. */
export type SeriesListResult = {
  chapters?: Chapter[];
  pageThumbs?: (PageThumbSource | null)[];
  chapterCount?: number;
  readLabel?: string;
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
  /** When the series was collected — the "Date added" grouping axis. Always present: it is
   *  `collectedAt` on the series item, which every collected series has. */
  collectedAt: number;
  /** Last read moment, absent for a series never opened — the "Last read" grouping axis. */
  lastReadAt?: number;
};

/** A user-defined collection. Mirrors `@comical/library`'s `Collection`.
 *
 *  Collections replaced the library's custom lists: they group ITEMS (a series, a chapter or a
 *  page), not library entries, so an entry no longer carries its own memberships — a series is "in"
 *  a collection by way of a series item pointing at it. An item exists ONLY as a member; emptying
 *  its memberships removes it. See `docs/collections-client-plan.md`. */
export type Collection = {
  id: string;
  name: string;
  /** Sort position among collections (ascending). */
  order: number;
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

/**
 * A page of grid results, with enough info to drive infinite scroll: the bridge's opaque resume
 * token, or nothing at all when this was the last page. Present ⟺ there is more — so unlike the
 * `hasNextPage` boolean this replaced, the flag and the means of acting on it can't disagree (a
 * `true` with nowhere to go was an infinite spinner). Nothing on this side reads its contents.
 */
export type GridPage = {
  items: SeriesEntry[];
  nextCursor?: string;
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
  /** Resume token for the page after the seeded first one — see {@link GridPage.nextCursor}. */
  nextCursor?: string;
};

/** An installed bridge, as surfaced by the bridge selector. `cardSubtitles` mirrors the contract's
 *  flag: this bridge's entries may carry a `sub` line, so card grids reserve the sub-line height
 *  for its surfaces (and drop it — tighter rows — for bridges that never send one). */
export type Bridge = {
  id: string;
  name: string;
  nsfw: boolean;
  capabilities: string[];
  cardSubtitles?: boolean;
  thumbnail?: string;
};
/** One of a bridge's browsable lists (home section or standalone page). */
export type BridgeList = {
  id: string;
  name: string;
  page: boolean;
  /** Presentation hint for home sections; absent lists render as a 'regular' rail. */
  layout?: 'carousel' | 'grid' | 'ranked' | 'hero';
  /** Whether a query can be scoped to this list (routes search through it instead of `/search`). */
  searchable?: boolean;
  /** The bridge's own "surface this list prominently on a home screen" flag (contract's
   *  `SeriesList.featured`). The synthetic "Comical" aggregate home uses it to pick each bridge's one
   *  representative rail; falls back to the bridge's first rail when unset. On a `page` list it also
   *  makes that page the one Browse opens on for the bridge, instead of the Home tab. */
  featured?: boolean;
};
