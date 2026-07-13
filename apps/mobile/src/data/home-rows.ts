/**
 * Flat, typed row model for the composed-Home surface, so the whole Home (rails + non-terminal grid
 * blocks + the terminal "Browse all" grid) can render as the `data` of ONE vertical LegendList and be
 * virtualized — off-screen rails actually unmount, instead of every rail being mounted at once inside a
 * never-virtualized `ListHeaderComponent` (the old shape). See `components/home-feed.tsx`.
 *
 * The order below mirrors exactly what the old `listHeader` rendered top-to-bottom:
 *   rails → non-terminal grid blocks → terminal section head → terminal grid rows
 * (or, while loading, their skeleton equivalents derived from the bridge's `lists` metadata).
 */
import type { BridgeList, HomeGridSection, RailSection, SeriesEntry } from '@/data/types';

export type HomeRow =
  // Shared heading row for EVERY section (rail, non-terminal grid block, terminal grid). Carries the
  // "See all" target when the section can be drilled into (rails can; grid blocks / terminal can't).
  | { type: 'sectionHead'; key: string; title: string; seeAll?: { listId: string; title: string } }
  // A rail (hero/ranked/regular) — strip only; its heading is the preceding `sectionHead` row.
  | { type: 'rail'; key: string; section: RailSection }
  // Loading placeholder for a rail — SELF-headed (keeps its own real/skeleton title inline).
  | { type: 'railSkeleton'; key: string; title?: string }
  // A non-terminal grid section BODY (own "Load more") — heading is the preceding `sectionHead` row.
  | { type: 'gridBlock'; key: string; section: HomeGridSection }
  // Loading placeholder for a non-terminal grid block — self-headed.
  | { type: 'gridBlockSkeleton'; key: string; title: string; rows: number }
  // One row of up to `numColumns` terminal-grid cards (the infinite-scroll body).
  | { type: 'gridRow'; key: string; items: SeriesEntry[] };

/** LegendList row-type tag, so recycled views are pooled per kind (a rail never recycles into a grid
 *  row). Every heading — rail, block, terminal — now shares ONE `sectionHead` pool. Skeleton variants
 *  stay self-headed and share their real body's pool (same shape, brief lifetime). */
export function homeRowType(row: HomeRow): string {
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
 * Build the flat `HomeRow[]` for the composed Home. Called with either the loaded data or (while
 * `loading`) the `lists`-derived previews — mirroring `getHomeSections`'s own rail/grid partition so
 * the skeleton shape matches the real one. The terminal-grid loading skeleton stays a list FOOTER
 * (like `SeriesGrid`), so it isn't produced here.
 */
export function buildHomeRows(args: {
  loading: boolean;
  numColumns: number;
  // Loaded data
  sections: RailSection[];
  nonTerminalGridSections: HomeGridSection[];
  terminalGridSection: HomeGridSection | null;
  gridItems: SeriesEntry[];
  // Loading previews (from the bridge's `lists`, which resolve before the Home content fetch)
  railListsPreview: BridgeList[];
  nonTerminalGridListsPreview: BridgeList[];
  terminalGridPreview: BridgeList | null;
}): HomeRow[] {
  const {
    loading,
    numColumns,
    sections,
    nonTerminalGridSections,
    terminalGridSection,
    gridItems,
    railListsPreview,
    nonTerminalGridListsPreview,
    terminalGridPreview,
  } = args;

  const rows: HomeRow[] = [];

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
    rows.push({ type: 'sectionHead', key: `head:${s.id}`, title: s.title, seeAll: { listId: s.id, title: s.title } });
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
