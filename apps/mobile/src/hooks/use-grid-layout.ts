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

import { RegularWidthBreakpoint } from '@/constants/size-class';
import { Spacing, TopLevelGutter, topLevelCenterInset } from '@/constants/theme';
import { useBookCoversEnabled } from '@/hooks/use-book-covers';
import { type SideInsets, useContentWidth, useSideInsets } from '@/hooks/use-content-width';
import { sizeClassFor, useHydrated } from '@/hooks/use-responsive';
import { useScrollbarGutter } from '@/lib/scrollbar-gutter';

/**
 * The space between two cards side by side, in a grid or a rail. `wide` is a desktop-sized card: 8pt
 * between covers that size reads as one strip of artwork.
 *
 * Flat tiles sit at the reference's tight 8pt on a phone (16 was tried there and reverted — it cost
 * card width without reading better). Books don't: each one carries a spine edge, a rim and a shadow,
 * and at 8pt a shelf of them reads as packed, so book covers buy the room back — about the tenth of a
 * cover's width Apple Books leaves between its own.
 */
export function cardGap(books: boolean, wide: boolean): number {
  if (books) return wide ? Spacing.four : Spacing.two + Spacing.one;
  return wide ? Spacing.three : Spacing.two;
}

/** The space between rows of cards. Flat, it's tight, because a card's own title block already
 *  separates one row from the next; a shelf of books takes its column gap, so the next row's covers
 *  don't sit on the last row's longest title. */
function rowGap(books: boolean, wide: boolean): number {
  return books ? cardGap(true, wide) : Spacing.one;
}

/** How a row spends its gap around its cards. Split, not all below: LegendList's web row container is
 *  `contain: paint`, which clips a card's hover-lift if the card is flush to the row's top edge. Every
 *  grid takes its padding from here, so one grid's first row never starts higher than another's. */
export function rowPad(gap: number): { paddingTop: number; paddingBottom: number } {
  return { paddingTop: gap / 2, paddingBottom: gap / 2 };
}

// The width a column is counted by. A touch screen holds a smaller card than a desktop window does:
// 150 keeps the Duo's cards about one size open, at five columns in landscape and four in portrait.
const GRID_MIN_CARD = Platform.OS === 'web' ? 200 : 150;

/** Cards across a content width on the WEB: the grid's columns. It takes the width alone, not the
 *  size class. A phone-sized window counts to fewer than 3, so it stays at 3. (A device's grid has a
 *  card width of its own — see `gridGeometry`.) */
export function gridColumnsFor(width: number): number {
  return Math.min(6, Math.max(3, Math.floor(width / GRID_MIN_CARD)));
}

/**
 * A device's grid card width: fixed, as a strip's is (see `rail.tsx`). A wider window shows more
 * columns of the same cards, the spare width going to the gaps, rather than wider cards: by the
 * window's width, an iPhone Duo folding or opening resized every card a render after the system had
 * resized the layout. This size fits three across the folded Duo beside its side column and six
 * across the open one — about the old phone grid's card, so a phone looks as it did.
 */
const DEVICE_GRID_CARD = 104;
/** The most columns a device's grid lays out: past this a wide tablet grows its gaps. */
const DEVICE_GRID_MAX_COLUMNS = 8;

/**
 * Where a grid cell's card sits in its column — every card grid's cells, the virtualized grid's and
 * the feed's hand-laid rows alike. Natively by flex: the cell takes its column's share of the row (a
 * LegendList column band is already that share: `inBand`), less a padding each side that depends only
 * on the column, so the card comes out `cardWidth` wide at exactly `k·(cardWidth+gap)` without being
 * told the width. A window that changes size (an iPhone Duo folding or opening) then has its cards at
 * their new width in the frame it resizes in, laid out natively, rather than at the old one until JS
 * has rendered again. The web takes the measured width, its scrollbar's gutter being out of the
 * shares' reckoning; a hand-laid row there keeps its `gap` (`rowColumnGap`).
 */
export function columnPlacement(column: number, columns: number, gap: number, cardWidth: number, inBand = false) {
  if (Platform.OS === 'web') return inBand ? { width: cardWidth, marginLeft: column * (gap / columns) } : { width: cardWidth };
  return {
    width: inBand ? ('100%' as const) : (`${100 / columns}%` as const),
    paddingLeft: column * (gap / columns),
    paddingRight: (columns - 1 - column) * (gap / columns),
  };
}

/** The `gap` a hand-laid row of cells takes: natively none, the cells' own padding being the gap
 *  (`columnPlacement`). */
export function rowColumnGap(gap: number): number {
  return Platform.OS === 'web' ? gap : 0;
}

export type GridLayout = {
  numColumns: number;
  /** Symmetric horizontal padding that centres content within MaxTopLevelWidth. */
  sidePad: number;
  /** Hydration-safe viewport width for rails (mobile fallback before mount). */
  railViewport: number;
  /** EXACT width of one card, not a hint — each grid holds its card to this, centred in its column's
   *  band. On a device it is fixed (`DEVICE_GRID_CARD`) whatever the window, the spare width going to
   *  the gaps; it's also why a short final row can just end rather than stretch across the row. */
  cardWidth: number;
  /** A column's band less its share of the gaps — the box a card is centred in (`columnPlacement`).
   *  `cardWidth` where the cards fill the row. */
  cellWidth: number;
  /** The space between two cards in a row. Every card grid lays out with this one, so a card sits
   *  at the same x whichever grid drew it. */
  columnGap: number;
  /** The space between two rows of cards — see `rowPad` for how a row spends it. */
  rowGap: number;
  /** Whether cards are drawn as books, which is what these gaps were chosen for — for a caller that
   *  hands the geometry on (a rail's own strip), and for a list's layout key, since the gaps change
   *  with it while the width doesn't. */
  books: boolean;
  hydrated: boolean;
  /** The CONTENT width this geometry was derived from — the window minus the sidebar, inside the
   *  tabs; the window itself everywhere else; minus the safe area's sides either way. Not
   *  `useWindowDimensions().width`. */
  width: number;
  /** The safe area's sides, which `RecyclerList` pads by on top of `sidePad` — for a background that
   *  runs under them, `width` and all. */
  insets: SideInsets;
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
  books: boolean,
): Pick<GridLayout, 'numColumns' | 'sidePad' | 'cardWidth' | 'cellWidth' | 'columnGap' | 'rowGap'> {
  const large = hydrated && sizeClassFor(width) === 'regular';
  // Web only: a tablet is at this width too, and keeps the phone's spacing.
  const wide = large && Platform.OS === 'web';
  const columnGap = cardGap(books, wide);
  // Center content within MaxTopLevelWidth (web only — see topLevelCenterInset) plus the edge gutter;
  // header/footer blocks bleed TopLevelGutter of this back out (see the Browse list). On native this is
  // just the gutter, so the grid spans the full device width.
  const sidePad = topLevelCenterInset(width) + TopLevelGutter;
  // Not returned: it exists only to derive `cardWidth`, and nothing outside this hook ever wanted it.
  const gridContentWidth = width - gutter - sidePad * 2;
  const fill = (columns: number) => (gridContentWidth - (columns - 1) * columnGap) / columns;
  if (Platform.OS === 'web') {
    const numColumns = hydrated ? gridColumnsFor(width) : 3;
    return { numColumns, sidePad, cardWidth: fill(numColumns), cellWidth: fill(numColumns), columnGap, rowGap: rowGap(books, wide) };
  }
  // As many fixed cards as fit, never fewer than three (a narrow phone shrinks them to fit three), and
  // at a regular width an even count, so a foldable's fold — the iPhone Duo's open display — runs
  // between two columns rather than through a card.
  let numColumns = Math.min(
    DEVICE_GRID_MAX_COLUMNS,
    Math.max(3, Math.floor((gridContentWidth + columnGap) / (DEVICE_GRID_CARD + columnGap))),
  );
  if (width >= RegularWidthBreakpoint && numColumns % 2 === 1 && numColumns > 3) numColumns -= 1;
  const cardWidth = Math.min(DEVICE_GRID_CARD, fill(numColumns));
  return { numColumns, sidePad, cardWidth, cellWidth: fill(numColumns), columnGap, rowGap: rowGap(books, wide) };
}

export function useGridLayout(): GridLayout {
  // The content column, NOT the window: the sidebar is reserved by a paddingLeft on the tab slot, and
  // dividing the window's width into columns inside that padding lays out a grid wider than the space
  // it was given — the rail's width of the last column ends up past the right edge.
  // And not under the safe area's sides, which the list pads past (see `RecyclerList`).
  const insets = useSideInsets();
  const width = useContentWidth() - insets.left - insets.right;
  const hydrated = useHydrated();
  const gutter = useScrollbarGutter();
  const books = useBookCoversEnabled();
  const railViewport = hydrated ? width : 390;
  return { ...gridGeometry(width, hydrated, gutter, books), railViewport, hydrated, width, gutter, insets, books };
}
