/**
 * How many columns of ROWS a list lays out — the History and Activity feeds, whose rows are a
 * thumbnail, two or three short lines and a trailing control: ~400px of content however wide the
 * screen. On a phone that is the screen; on a desktop the content column is capped at
 * `MaxTopLevelWidth`, and one row per line left three quarters of it empty with the control
 * stranded at the far edge. Side by side, the same rows show twice as much of the feed above the fold.
 *
 * Desktop only (`useIsDesktop`: large AND web). A tablet is as wide and keeps the single column —
 * there a row is swiped, and a swipe that stops at a column boundary reads as a broken gesture;
 * on web the actions are hover lanes beside the row, which a column holds fine.
 *
 * Both feeds take their geometry from here so they split at the same width and the same gap.
 */
import { useMemo } from 'react';
import type { ViewStyle } from 'react-native';

import { Spacing, topLevelCenterInset } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';
import { useIsDesktop } from '@/hooks/use-responsive';
import { useScrollbarGutter } from '@/lib/scrollbar-gutter';

/** The narrowest a column may be. A row's text column is this minus the row's own gutters, the
 *  thumbnail and up to two action lanes — about 400px, which holds a title of ~50 characters on one
 *  line. (The capped 1200px content column splits in two at this and never in three.) */
export const ROW_COLUMN_MIN_WIDTH = 480;
/** Space between two columns, split evenly onto the cells on either side of it. */
export const ROW_COLUMN_GAP = Spacing.four;

/** The split for a content width — pure, so it can be tested. */
export function rowColumns(innerWidth: number, desktop: boolean): number {
  return desktop ? Math.max(1, Math.floor(innerWidth / ROW_COLUMN_MIN_WIDTH)) : 1;
}

export type RowColumns = {
  columns: number;
  /** Symmetric list padding that centres the rows within `MaxTopLevelWidth` (web; 0 on native). */
  sidePad: number;
  /** One column's share of the content, gap included — what LegendList gives each cell. */
  columnWidth: number;
  /** True in columns: every cell in a row must be the same height or the dividers fall on different
   *  lines across the gap, so each row holds to the thumbnail's height (HistoryRow's `uniform`). */
  uniform: boolean;
  /** The cell of the item at `index` in a list of `count`: its horizontal margins (half the gap on
   *  each side that faces another column, none on an outer edge, so the first and last columns stay
   *  flush with the list's own padding) and whether it sits in the LAST row — its divider is dropped
   *  like a single column's last row's (`useIsLastItem` knows only the very last item).
   *  `style` is undefined in a single column: the row goes in unwrapped, exactly as it always has. */
  cell: (index: number, count: number) => { style: ViewStyle | undefined; lastRow: boolean };
  /** The cell's offset across the content, by item index — `xAtIndex` for the zoom surface. */
  xAtIndex: (index: number) => number;
};

export function useRowColumns(): RowColumns {
  // The content column, not the window — the sidebar's inset is already out of it.
  const width = useContentWidth();
  const desktop = useIsDesktop();
  const gutter = useScrollbarGutter();
  const sidePad = topLevelCenterInset(width);
  const inner = width - gutter - sidePad * 2;
  const columns = rowColumns(inner, desktop);
  const columnWidth = inner / columns;
  // One object per geometry, not per render: `xAtIndex` is a dependency of the zoom surface's
  // locator, which would re-register on every render otherwise (see useZoomSurfaceList).
  return useMemo(() => {
    const half = ROW_COLUMN_GAP / 2;
    return {
      columns,
      sidePad,
      columnWidth,
      uniform: columns > 1,
      cell: (index, count) => {
        const col = index % columns;
        return {
          style:
            columns > 1
              ? { marginLeft: col > 0 ? half : 0, marginRight: col < columns - 1 ? half : 0 }
              : undefined,
          lastRow: index >= count - (((count - 1) % columns) + 1),
        };
      },
      xAtIndex: (index) => {
        const col = index % columns;
        return col * columnWidth + (col > 0 ? half : 0);
      },
    };
  }, [columns, sidePad, columnWidth]);
}
