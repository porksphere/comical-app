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
import { useWindowDimensions } from 'react-native';

import { Spacing, TopLevelGutter, topLevelCenterInset } from '@/constants/theme';
import { useHydrated } from '@/hooks/use-responsive';

// The reference's mobile grid uses a tighter inter-card gap than its row gap; Spacing.two (8px) is
// the closest token. Shared so every card grid keeps the same column gap.
export const GRID_COLUMN_GAP = Spacing.two;

export type GridLayout = {
  numColumns: number;
  /** Symmetric horizontal padding that centres content within MaxTopLevelWidth. */
  sidePad: number;
  /** Hydration-safe viewport width for rails (mobile fallback before mount). */
  railViewport: number;
  /** EXACT width of one card, not a hint — `SeriesGrid` pins its cells to this. It's the whole reason
   *  a short final row can just end: an elastic cell would stretch to fill the row instead. */
  cardWidth: number;
  hydrated: boolean;
  width: number;
};

export function useGridLayout(): GridLayout {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();

  const numColumns = !hydrated || width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));
  // Center content within MaxTopLevelWidth (web only — see topLevelCenterInset) plus the edge gutter;
  // header/footer blocks bleed TopLevelGutter of this back out (see the Browse list). On native this is
  // just the gutter, so the grid spans the full device width.
  const sidePad = topLevelCenterInset(width) + TopLevelGutter;
  const railViewport = hydrated ? width : 390;
  // Not returned: it exists only to derive `cardWidth`, and nothing outside this hook ever wanted it.
  const gridContentWidth = width - sidePad * 2;
  const cardWidth = (gridContentWidth - (numColumns - 1) * GRID_COLUMN_GAP) / numColumns;

  return { numColumns, sidePad, railViewport, cardWidth, hydrated, width };
}
