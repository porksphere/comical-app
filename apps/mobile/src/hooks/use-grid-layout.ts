/**
 * Shared responsive grid geometry for the series-card grids (Browse + Search):
 * the column count, the symmetric side padding that centres content to
 * `MaxTopLevelWidth`, and the per-card width hint. Extracted from the Browse
 * screen so the Search page lays cards out identically.
 *
 * Hydration-safe: the static web export prerenders with no viewport (width 0),
 * so we hold the mobile column count until mount, then switch to the real
 * viewport width — matching `useIsCompact`/`useTopBarHeight` (see use-responsive).
 */
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { MaxTopLevelWidth, Spacing } from '@/constants/theme';

// The reference's mobile grid uses a tighter inter-card gap than its row gap; Spacing.two (8px) is
// the closest token. Shared so every card grid keeps the same column gap.
export const GRID_COLUMN_GAP = Spacing.two;

export type GridLayout = {
  numColumns: number;
  /** Symmetric horizontal padding that centres content within MaxTopLevelWidth. */
  sidePad: number;
  /** Hydration-safe viewport width for rails (mobile fallback before mount). */
  railViewport: number;
  gridContentWidth: number;
  cardWidth: number;
  hydrated: boolean;
  width: number;
};

export function useGridLayout(): GridLayout {
  const { width } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const numColumns = !hydrated || width < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(width / 200)));
  // Center content in a full-width scroller (scrollbar at the window edge) via symmetric side
  // padding; header/footer blocks bleed Spacing.four of this back out (see the Browse list).
  const sidePad = Math.max(0, (width - MaxTopLevelWidth) / 2) + Spacing.four;
  const railViewport = hydrated ? width : 390;
  const gridContentWidth = width - sidePad * 2;
  const cardWidth = (gridContentWidth - (numColumns - 1) * GRID_COLUMN_GAP) / numColumns;

  return { numColumns, sidePad, railViewport, gridContentWidth, cardWidth, hydrated, width };
}

/**
 * Pad a grid item list with invisible trailing spacers so a short last row
 * doesn't stretch its cards. `make` builds a spacer item from a unique id.
 */
export function padWithSpacers<T>(items: T[], numColumns: number, make: (id: string) => T): T[] {
  const remainder = items.length % numColumns;
  if (remainder === 0) return items;
  const spacers = Array.from({ length: numColumns - remainder }, (_, i) => make(`spacer-${i}`));
  return [...items, ...spacers];
}
