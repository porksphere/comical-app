/**
 * Flat, typed row model for the composed-Home surface, so the whole Home (rails + non-terminal grid
 * blocks + the terminal "Browse all" grid) can render as the `data` of ONE vertical LegendList and be
 * virtualized — off-screen rails actually unmount, instead of every rail being mounted at once inside a
 * never-virtualized `ListHeaderComponent` (the old shape). See `components/content-feed.tsx`.
 *
 * The order below mirrors exactly what the old `listHeader` rendered top-to-bottom:
 *   rails → non-terminal grid blocks → terminal section head → terminal grid rows
 * (or, while loading, their skeleton equivalents derived from the bridge's `lists` metadata).
 */
import type { BridgeList, HomeGridSection, RailSection, SeriesEntry } from '@/data/types';

/**
 * Optional per-row/-card bridge identity. A single-bridge feed (Browse's home) omits these and the
 * ContentFeed-level `bridge`/`bridgeId`/`direct` props apply to everything; a cross-bridge feed (e.g. a
 * future Library, whose cards come from many bridges) carries its own here. Same "own value wins when
 * present, else fall back to the feed-level prop" rule as SeriesGrid's `SeriesGridItem`.
 */
export type BridgeScope = { bridge?: string; bridgeId?: string; direct?: boolean };

/** A terminal-grid card that may override the feed-level bridge identity (cross-bridge grids carry
 *  their own bridge per card). A plain `SeriesEntry` is assignable, so single-bridge builders are
 *  unchanged. */
export type FeedCardEntry = SeriesEntry & BridgeScope;

/**
 * Where a rail's "See all" drills to — a pushed `/results` page scoped to ONE bridge. Either a LIST
 * drill (`listId`, a home rail → infinite-scroll that list) or a SEARCH drill (`query`, a cross-bridge
 * search rail → infinite-scroll that bridge's search). Carries the bridge identity so the pushed page
 * fetches + navigates against the right real bridge even from the aggregate "Comical" feed.
 */
export type SeeAllTarget = {
  title: string;
  bridgeId: string;
  bridge?: string;
  direct?: boolean;
  listId?: string;
  query?: string;
};

export type ContentRow =
  // Shared heading row for EVERY section (rail, non-terminal grid block, terminal grid). Carries the
  // "See all" target when the section can be drilled into (rails can; grid blocks / terminal can't).
  | { type: 'sectionHead'; key: string; title: string; seeAll?: SeeAllTarget }
  // A rail (hero/ranked/regular) — strip only; its heading is the preceding `sectionHead` row. A whole
  // rail belongs to one bridge, so its override (if any) is section-level.
  | ({ type: 'rail'; key: string; section: RailSection } & BridgeScope)
  // Loading placeholder for a rail — SELF-headed (keeps its own real/skeleton title inline).
  | { type: 'railSkeleton'; key: string; title?: string }
  // A rail whose fetch FAILED — a shared RetryBlock in the rail's slot (below its sectionHead), so one
  // bridge erroring in a cross-bridge feed shows an inline retry instead of silently vanishing.
  | { type: 'railError'; key: string; message: string; onRetry: () => void }
  // A non-terminal grid section BODY (own "Load more") — heading is the preceding `sectionHead` row.
  | ({ type: 'gridBlock'; key: string; section: HomeGridSection } & BridgeScope)
  // Loading placeholder for a non-terminal grid block — self-headed.
  | { type: 'gridBlockSkeleton'; key: string; title: string; rows: number }
  // One row of up to `numColumns` terminal-grid cards (the infinite-scroll body). Each card may carry
  // its own bridge (cross-bridge grid).
  | { type: 'gridRow'; key: string; items: FeedCardEntry[] };

/** LegendList row-type tag, so recycled views are pooled per kind (a rail never recycles into a grid
 *  row). Every heading — rail, block, terminal — now shares ONE `sectionHead` pool. Skeleton variants
 *  stay self-headed and share their real body's pool (same shape, brief lifetime). */
export function contentRowType(row: ContentRow): string {
  switch (row.type) {
    case 'railSkeleton':
      return 'rail';
    case 'gridBlockSkeleton':
      return 'gridBlock';
    default:
      return row.type;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build the flat `ContentRow[]` for the composed Home. Called with either the loaded data or (while
 * `loading`) the `lists`-derived previews — mirroring `getHomeSections`'s own rail/grid partition so
 * the skeleton shape matches the real one. The terminal-grid loading skeleton stays a list FOOTER
 * (like `SeriesGrid`), so it isn't produced here.
 */
export function buildHomeRows(args: {
  loading: boolean;
  numColumns: number;
  // Bridge identity for the rails' "See all" targets (the pushed /results page is per-bridge).
  bridgeId: string;
  bridge?: string;
  direct?: boolean;
  // Loaded data
  sections: RailSection[];
  nonTerminalGridSections: HomeGridSection[];
  terminalGridSection: HomeGridSection | null;
  gridItems: SeriesEntry[];
  // Loading previews (from the bridge's `lists`, which resolve before the Home content fetch)
  railListsPreview: BridgeList[];
  nonTerminalGridListsPreview: BridgeList[];
  terminalGridPreview: BridgeList | null;
}): ContentRow[] {
  const {
    loading,
    numColumns,
    bridgeId,
    bridge,
    direct,
    sections,
    nonTerminalGridSections,
    terminalGridSection,
    gridItems,
    railListsPreview,
    nonTerminalGridListsPreview,
    terminalGridPreview,
  } = args;

  const rows: ContentRow[] = [];

  if (loading) {
    // Rails: one skeleton per known rail list (real title, unknown cards), falling back to a generic
    // pair only if `lists` produced NO home sections at all (no rails and no grid lists) — matches the
    // old header skeleton, which keyed off rail+grid list presence.
    const hasKnownLists =
      railListsPreview.length > 0 || nonTerminalGridListsPreview.length > 0 || !!terminalGridPreview;
    if (hasKnownLists) {
      for (const l of railListsPreview) rows.push({ type: 'railSkeleton', key: `railsk:${l.id}`, title: l.name });
    } else {
      rows.push({ type: 'railSkeleton', key: 'railsk:0' });
      rows.push({ type: 'railSkeleton', key: 'railsk:1' });
    }
    for (const l of nonTerminalGridListsPreview) {
      rows.push({ type: 'gridBlockSkeleton', key: `blocksk:${l.id}`, title: l.name, rows: 2 });
    }
    if (terminalGridPreview) {
      rows.push({ type: 'sectionHead', key: 'head:terminal', title: terminalGridPreview.name });
    }
    return rows;
  }

  // Loaded: a shared `sectionHead` row precedes every section's (headless) body.
  for (const s of sections) {
    rows.push({
      type: 'sectionHead',
      key: `head:${s.id}`,
      title: s.title,
      seeAll: { title: s.title, bridgeId, bridge, direct, listId: s.id },
    });
    rows.push({ type: 'rail', key: `rail:${s.id}`, section: s });
  }
  for (const gs of nonTerminalGridSections) {
    rows.push({ type: 'sectionHead', key: `head:${gs.id}`, title: gs.title });
    rows.push({ type: 'gridBlock', key: `block:${gs.id}`, section: gs });
  }
  if (terminalGridSection) {
    rows.push({ type: 'sectionHead', key: 'head:terminal', title: terminalGridSection.title });
    chunk(gridItems, numColumns).forEach((items, i) => rows.push({ type: 'gridRow', key: `grow:${i}`, items }));
  }
  return rows;
}

/** One bridge's contribution to a cross-bridge feed (the "Comical" home or a cross-bridge search):
 *  a rail titled with the bridge name, once loaded. `loading` → a skeleton row; a null/empty
 *  `section` → the bridge is skipped (contributed nothing). `drill` is the rail's "See all" target
 *  discriminator — a home rail drills into `listId`, a search rail into `query`. */
export type CrossBridgeRailInput = {
  bridgeId: string;
  bridgeName: string;
  direct: boolean;
  loading: boolean;
  /** The bridge's query failed — render a retry in its slot instead of a rail. */
  error: boolean;
  /** Refetch just this bridge's query (the railError's Retry). */
  onRetry: () => void;
  section: RailSection | null;
  drill: { listId?: string; query?: string };
};

/**
 * Build `ContentRow[]` for a cross-bridge feed — one rail per bridge, in the given order. Each bridge
 * yields `[sectionHead(title = bridge name, seeAll), rail(section, per-rail BridgeScope)]` once loaded,
 * a `railSkeleton` while loading, or nothing when it has no results. The rail's `BridgeScope`
 * (bridgeId/bridge/direct) is what makes its cards open the correct real bridge from the aggregate feed.
 */
export function buildCrossBridgeRows(inputs: CrossBridgeRailInput[]): ContentRow[] {
  const rows: ContentRow[] = [];
  for (const b of inputs) {
    if (b.loading) {
      rows.push({ type: 'railSkeleton', key: `railsk:${b.bridgeId}`, title: b.bridgeName });
      continue;
    }
    if (b.error) {
      rows.push({ type: 'sectionHead', key: `head:${b.bridgeId}`, title: b.bridgeName });
      rows.push({
        type: 'railError',
        key: `railerr:${b.bridgeId}`,
        message: `Couldn't load ${b.bridgeName}.`,
        onRetry: b.onRetry,
      });
      continue;
    }
    if (!b.section || b.section.items.length === 0) continue;
    rows.push({
      type: 'sectionHead',
      key: `head:${b.bridgeId}`,
      title: b.bridgeName,
      seeAll: {
        // The results page shows "{bridge} › {title}", so `title` is the section label — the search
        // query for a search rail, else the featured list's name for a home rail.
        title: b.drill.query ?? b.section?.title ?? b.bridgeName,
        bridgeId: b.bridgeId,
        bridge: b.bridgeName,
        direct: b.direct,
        listId: b.drill.listId,
        query: b.drill.query,
      },
    });
    rows.push({
      type: 'rail',
      key: `rail:${b.bridgeId}`,
      section: b.section,
      bridgeId: b.bridgeId,
      bridge: b.bridgeName,
      direct: b.direct,
    });
  }
  return rows;
}
