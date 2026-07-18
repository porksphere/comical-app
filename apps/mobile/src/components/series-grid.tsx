import type { LegendListRef } from '@legendapp/list/react-native';
import type { ReactElement, RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { RecyclerList } from '@/components/recycler-list';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';

// A cell reserves the inter-row space itself (LegendList ignores vertical `gap` — items are absolutely
// positioned). Split top/bottom rather than all-bottom because LegendList's web row container is
// `contain: paint`, which would clip a card's hover-lift if it were flush to the row's top edge. These
// feed both `styles.cell`'s padding AND the fixed `cellHeight` below, so the two never drift.
// Deliberately TIGHT (2px total, down from the original 16): the cards' own title/author block
// already gives each row visual separation, so the old gap read as dead air. The remaining 2px all
// sit on TOP (the web hover-lift clip guard — see above); the bottom pad is gone entirely.
const CELL_PAD_TOP = Spacing.half;
const CELL_PAD_BOTTOM = 0;
const CELL_ROW_GAP = CELL_PAD_TOP + CELL_PAD_BOTTOM;

/**
 * A cell in a series grid. Every item is a REAL series — the grid never injects placeholder entries.
 *
 * The bridge fields are per-item OVERRIDES of the grid-level `bridge`/`bridgeId`/`direct` props: a
 * single-bridge grid (Browse, Search) leaves them unset and passes the grid-level ones, while a
 * cross-bridge grid (the Library) carries them on each item. One rule — item wins if present.
 */
export type SeriesGridItem = SeriesEntry & {
  bridge?: string;
  bridgeId?: string;
  direct?: boolean;
};

/**
 * THE uniform series-card grid. Every screen that shows a plain grid of series cards (Browse results,
 * Search, Library, History, Activity) renders this. It's a thin, grid-shaped skin over `RecyclerList`
 * (which owns all the LegendList config now) — one item type, `numColumns` columns, fixed-height cells.
 * The heterogeneous rails-and-grids home surface uses `ContentFeed`, the OTHER `RecyclerList` skin.
 *
 * Layout (columns, side padding, card width) comes from `useGridLayout`, so every grid is laid out
 * identically and hydration-safely.
 */
export function SeriesGrid({
  items,
  scopeKey,
  listRef,
  header,
  footer,
  paddingTop,
  paddingBottom,
  bridge,
  bridgeId,
  direct,
  originPage,
  crossfading,
  sharedValues,
  onScroll,
  onEndReached,
  onScrollEndDrag,
  wrapperStyle,
}: {
  /** The series to show. Exactly what gets rendered — the grid adds nothing to it. */
  items: SeriesGridItem[];
  /** Identifies the current scope; feeds the list `key` and the cards' recycle `cohort`. */
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  /** Space above the first row — typically the top bar's resting height (content scrolls behind it). */
  paddingTop: number;
  /** Space below the last row. Defaults to clearing the tab bar + the safe area. */
  paddingBottom?: number;
  /** Grid-level bridge identity, used for every item that doesn't carry its own (see SeriesGridItem). */
  bridge?: string;
  bridgeId?: string;
  direct?: boolean;
  /** Browse only: the sub-page a card was opened from, so the series screen can return to it. */
  originPage?: string;
  /** Suppresses per-card entrance work while a full-surface crossfade owns the transition. */
  crossfading?: boolean;
  /** Feeds a `useSlidingBar`'s UI-thread scroll offset. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  /** From `usePullToRefresh` — iOS releases past the pull threshold fire the refresh. */
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Animated styles for the list wrapper — e.g. the pull-to-refresh content shift and the dim. */
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
}) {
  const { numColumns, sidePad, cardWidth } = useGridLayout();

  // FIXED row height — every cell is forced to the SAME height (worst-case card content via
  // `estimatedCardHeight`, plus the cell's own vertical padding). With every row identical AND matching
  // `estimatedItemSize`, LegendList never re-measures a row on scroll (the release-profile #1 fix).
  const cellHeight = estimatedCardHeight(cardWidth) + CELL_ROW_GAP;

  return (
    <RecyclerList
      data={items}
      scopeKey={scopeKey}
      listRef={listRef}
      // A series is identified by its BRIDGE plus its id, never its id alone — the Library is a
      // cross-bridge grid, and two bridges can hand out the same seriesId. Single-bridge grids leave
      // bridgeId unset, so their keys are unchanged.
      keyExtractor={(item) => (item.bridgeId ? `${item.bridgeId}:${item.id}` : String(item.id))}
      // EXACT, not a hint: every cell is pinned to `cellHeight` below, so this matches every measured row.
      estimatedItemSize={cellHeight}
      numColumns={numColumns}
      header={header}
      footer={footer}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom ?? BottomTabInset + Spacing.five}
      sidePad={sidePad}
      sharedValues={sharedValues}
      onScroll={onScroll}
      onEndReached={onEndReached}
      onScrollEndDrag={onScrollEndDrag}
      wrapperStyle={wrapperStyle}
      renderItem={({ item, index }) => (
        // Both dimensions are FIXED — cellHeight above, and cardWidth (from useGridLayout). The width is
        // what lets a short final row simply end instead of stretching its cards across the row.
        //
        // The marginLeft is the COLUMN-GAP correction. LegendList slots each column into a plain
        // `contentWidth / n` band and left-aligns the cell in it (a `columnWrapperStyle` gap is inert
        // — the old prop did nothing), which squeezed the visual gap to `gap·(n−1)/n` (~5.3px) and
        // dumped the remainder as slack on the row's right edge — the Library read tighter than the
        // Browse feed's hand-laid rows. Column k sits `k·gap/n` right of its slot start, which lands
        // every card at exactly `k·(cardWidth+gap)`: true `GRID_COLUMN_GAP` gaps, flush right edge,
        // identical to ContentFeed's terminal grid.
        <View
          style={[
            styles.cell,
            { width: cardWidth, height: cellHeight, marginLeft: (index % numColumns) * (GRID_COLUMN_GAP / numColumns) },
          ]}>
          <SeriesCard
            entry={item}
            bridge={item.bridge ?? bridge}
            bridgeId={item.bridgeId ?? bridgeId}
            direct={item.direct ?? direct}
            originPage={originPage}
            cohort={scopeKey}
            crossfading={crossfading}
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  cell: {
    // NO `flex: 1` — pinned to `cardWidth` at the call site so a short last row ends rather than
    // stretching. `justifyContent: flex-start` so a card shorter than the fixed cell top-aligns.
    justifyContent: 'flex-start',
    paddingTop: CELL_PAD_TOP,
    paddingBottom: CELL_PAD_BOTTOM,
  },
});
