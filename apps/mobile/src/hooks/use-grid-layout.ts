/**
 * Shared responsive grid geometry for the series-card grids (Browse, Search, Library):
 * the column count, the symmetric side padding that centres content to
 * `MaxTopLevelWidth`, and the exact per-card width. Extracted from the Browse
 * screen so every grid lays cards out identically.
 *
 * Hydration-safe on WEB only (see `useHydrated`): the static export prerenders with
 * no viewport (width 0), so on web we hold the mobile column count / a 390px rail
 * viewport until mount, then switch to the real width. On NATIVE the real width is
 * known on the first render, so it's used immediately — deferring there would lay every
 * rail card out at the 390px fallback for one frame and then visibly snap them wider.
 */
import { Platform } from 'react-native';

import { Spacing, TopLevelGutter, topLevelCenterInset } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';
import { LARGE_SCREEN_BREAKPOINT, useHydrated } from '@/hooks/use-responsive';
import { useScrollbarGutter } from '@/lib/scrollbar-gutter';

// The reference's mobile grid uses a tighter inter-card gap than its row gap; Spacing.two (8px) is
// the closest token. (Spacing.three was tried there and reverted — the wider gap cost card width
// without reading better.)
const GRID_COLUMN_GAP = Spacing.two;
// A desktop card is much wider than a phone's, and 8px between covers that size reads as one strip
// of artwork. Web only: a tablet is at this width too, and keeps the phone's spacing.
const GRID_COLUMN_GAP_DESKTOP = Spacing.three;
/** The space between rows of cards — tight, because a card's own title/author block already
 *  separates one row from the next (see `series-grid.tsx`). */
export const GRID_ROW_GAP = Spacing.one;
/** How a row spends that gap around its cards. Split, not all below: LegendList's web row container
 *  is `contain: paint`, which clips a card's hover-lift if the card is flush to the row's top edge.
 *  Every grid takes its padding from these, so one grid's first row never starts higher than
 *  another's. */
export const GRID_ROW_PAD_TOP = GRID_ROW_GAP / 2;
export const GRID_ROW_PAD_BOTTOM = GRID_ROW_GAP - GRID_ROW_PAD_TOP;

export type GridLayout = {
  numColumns: number;
  /** Symmetric horizontal padding that centres content within MaxTopLevelWidth. */
  sidePad: number;
  /** Hydration-safe viewport width for rails (mobile fallback before mount). */
  railViewport: number;
  /** EXACT width of one card, not a hint — `SeriesGrid` pins its cells to this. It's the whole reason
   *  a short final row can just end: an elastic cell would stretch to fill the row instead. */
  cardWidth: number;
  /** The space between two cards in a row. Every card grid lays out with this one, so a card sits
   *  at the same x whichever grid drew it. */
  columnGap: number;
  hydrated: boolean;
  /** The CONTENT width this geometry was derived from — the window minus the sidebar, inside the
   *  tabs; the window itself everywhere else. Not `useWindowDimensions().width`. */
  width: number;
  /** What the scroller's scrollbar takes out of `width` (`useScrollbarGutter`) — for a caller that
   *  hands `railViewport` on to a rail's geometry. */
  gutter: number;
};

/**
 * The grid's geometry for a content width — `useGridLayout` without the hooks, for a caller that is
 * handed its width rather than reading it (a rail's wide grid, which has to be the same cards at the
 * same spacing as the "See all" grid behind it).
 *
 * The scrollbar's `gutter` comes out of the cards' width, not the padding: the left edge stays where
 * the bars above the scroller line up with it, and the row simply ends that much sooner.
 */
export function gridGeometry(
  width: number,
  hydrated: boolean,
  gutter: number,
): Pick<GridLayout, 'numColumns' | 'sidePad' | 'cardWidth' | 'columnGap'> {
  const large = hydrated && width >= LARGE_SCREEN_BREAKPOINT;
  const numColumns = large ? Math.min(6, Math.max(3, Math.floor(width / 200))) : 3;
  const columnGap = large && Platform.OS === 'web' ? GRID_COLUMN_GAP_DESKTOP : GRID_COLUMN_GAP;
  // Center content within MaxTopLevelWidth (web only — see topLevelCenterInset) plus the edge gutter;
  // header/footer blocks bleed TopLevelGutter of this back out (see the Browse list). On native this is
  // just the gutter, so the grid spans the full device width.
  const sidePad = topLevelCenterInset(width) + TopLevelGutter;
  // Not returned: it exists only to derive `cardWidth`, and nothing outside this hook ever wanted it.
  const gridContentWidth = width - gutter - sidePad * 2;
  const cardWidth = (gridContentWidth - (numColumns - 1) * columnGap) / numColumns;
  return { numColumns, sidePad, cardWidth, columnGap };
}

export function useGridLayout(): GridLayout {
  // The content column, NOT the window: the sidebar is reserved by a paddingLeft on the tab slot, and
  // dividing the window's width into columns inside that padding lays out a grid wider than the space
  // it was given — the rail's width of the last column ends up past the right edge.
  const width = useContentWidth();
  const hydrated = useHydrated();
  const gutter = useScrollbarGutter();
  const railViewport = hydrated ? width : 390;
  return { ...gridGeometry(width, hydrated, gutter), railViewport, hydrated, width, gutter };
}
