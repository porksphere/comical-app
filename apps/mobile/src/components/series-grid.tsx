import type { LegendListRef } from '@legendapp/list/react-native';
import { useMemo, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ComposedGesture } from 'react-native-gesture-handler';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { GroupedGrid } from '@/components/grouped-grid';
import { RecyclerList } from '@/components/recycler-list';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { buildGroupedRows } from '@/data/grouped-rows';
import type { SeriesEntry } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';

// A cell reserves the inter-row space itself (LegendList ignores vertical `gap` — items are absolutely
// positioned). Split top/bottom rather than all-bottom because LegendList's web row container is
// `contain: paint`, which would clip a card's hover-lift if it were flush to the row's top edge. These
// feed both `styles.cell`'s padding AND the fixed `cellHeight` below, so the two never drift.
// Deliberately TIGHT (4px total, down from the original 16): the cards' own title/author block
// already gives each row visual separation, so the old gap read as dead air. Split evenly — the
// top half doubles as the web hover-lift clip guard (see above).
const CELL_PAD_TOP = Spacing.half;
const CELL_PAD_BOTTOM = Spacing.half;
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
  hasSub,
  crossfading,
  groupOf,
  stickyHeaderTop,
  sharedValues,
  onScroll,
  onEndReached,
  onScrollEndDrag,
  wrapperStyle,
  scrollGesture,
  scrollEnabled,
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
  /** Whether this grid's entries carry a card sub line, which sets the fixed cell height. Omit to
   *  resolve from `bridgeId`'s `cardSubtitles` flag; pass explicitly when the SCREEN makes the subs
   *  itself (the Library's bridge-name line → `true`). */
  hasSub?: boolean;
  /** Suppresses per-card entrance work while a full-surface crossfade owns the transition. */
  crossfading?: boolean;
  /** GROUPED mode: which section each item belongs to (see `buildGroupedRows` — buckets in
   *  first-appearance order, so grouping composes with the sort instead of replacing it). When set,
   *  the grid renders through `GroupedGrid` (section headers + the sticky). Grouped mode supports
   *  the subset of props the Library uses; it does not carry `onEndReached`/`footer`/pull wiring —
   *  the library list is not paged. */
  groupOf?: (item: SeriesGridItem) => { key: string; label: string };
  /** Where the sticky section header pins (the top bar's bottom edge) — grouped mode only. */
  stickyHeaderTop?: number;
  /** Feeds a `useSlidingBar`'s UI-thread scroll offset. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  /** From `usePullToRefresh` — iOS releases past the pull threshold fire the refresh. */
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Animated styles for the list wrapper — e.g. the pull-to-refresh content shift and the dim. */
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
  /** Passed through to `RecyclerList` — see the doc there (an over-the-list back-swipe's iOS interop). */
  scrollGesture?: ComposedGesture;
  /** Passed through to `RecyclerList` — false while a back-swipe is dragging this surface away. */
  scrollEnabled?: boolean;
}) {
  const { numColumns, sidePad, cardWidth } = useGridLayout();
  const { subOf } = useBridgeMap();

  // FIXED row height — every cell is forced to the SAME height (worst-case card content via
  // `estimatedCardHeight`, plus the cell's own vertical padding). With every row identical AND matching
  // `estimatedItemSize`, LegendList never re-measures a row on scroll (the release-profile #1 fix).
  // The sub line is reserved only when this surface's entries actually carry one (see `hasSub`).
  const cellHeight = estimatedCardHeight(cardWidth, hasSub ?? subOf(bridgeId)) + CELL_ROW_GAP;

  // A series is identified by its BRIDGE plus its id, never its id alone — the Library is a
  // cross-bridge grid, and two bridges can hand out the same seriesId. Single-bridge grids leave
  // bridgeId unset, so their keys are unchanged.
  const keyOf = (item: SeriesGridItem) => (item.bridgeId ? `${item.bridgeId}:${item.id}` : String(item.id));

  // ── GROUPED mode: pre-chunked rows + section headers through GroupedGrid ──
  // Hooks run unconditionally (the memo is cheap when ungrouped); the render forks below.
  const groupedRows = useMemo(
    () => (groupOf ? buildGroupedRows(items, numColumns, keyOf, groupOf) : []),
    [items, numColumns, groupOf],
  );
  if (groupOf) {
    return (
      <GroupedGrid
        rows={groupedRows}
        rowHeight={cellHeight}
        scopeKey={scopeKey}
        listRef={listRef}
        header={header}
        paddingTop={paddingTop}
        paddingBottom={paddingBottom ?? BottomTabInset + Spacing.five}
        sidePad={sidePad}
        stickyHeaderTop={stickyHeaderTop}
        sharedValues={sharedValues}
        onScroll={onScroll}
        renderRow={(rowItems) => (
          // Manual rows lay out with a real flex gap (LegendList's column slots can't gap — see the
          // marginLeft note below), which lands cards at the same `cardWidth + GRID_COLUMN_GAP`
          // rhythm as the ungrouped grid; fixed widths keep a short final row left-aligned.
          <View style={styles.groupedRow}>
            {rowItems.map((item) => (
              <View key={keyOf(item)} style={[styles.cell, { width: cardWidth, height: cellHeight }]}>
                <SeriesCard
                  entry={item}
                  bridge={item.bridge ?? bridge}
                  bridgeId={item.bridgeId ?? bridgeId}
                  direct={item.direct ?? direct}
                  cohort={scopeKey}
                  crossfading={crossfading}
                />
              </View>
            ))}
          </View>
        )}
      />
    );
  }

  return (
    <RecyclerList
      data={items}
      scopeKey={scopeKey}
      listRef={listRef}
      keyExtractor={keyOf}
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
      scrollGesture={scrollGesture}
      scrollEnabled={scrollEnabled}
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
  groupedRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
});
