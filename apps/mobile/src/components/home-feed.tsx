import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import type { ReactElement, RefObject } from 'react';
import { Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

import { HomeGridBlock } from '@/components/home-grid-block';
import { SkeletonCard } from '@/components/grid-skeleton';
import { Rail, RailSkeleton, SECTION_HEAD_HEIGHT, SectionHead, railRowHeight } from '@/components/rail';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { homeRowType, type HomeRow } from '@/data/home-rows';
import type { RailSection } from '@/data/types';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useIsLargeScreen } from '@/hooks/use-responsive';

// Terminal-grid cell inter-row spacing — mirrors series-grid.tsx's CELL_PAD_TOP/BOTTOM so a home
// terminal row reads at the exact same height as a results-grid cell (and matches the fixed cellHeight).
const CELL_PAD_TOP = Spacing.one;
const CELL_PAD_BOTTOM = Spacing.three - Spacing.one;
const CELL_ROW_GAP = CELL_PAD_TOP + CELL_PAD_BOTTOM;
// The terminal section head's own vertical padding (was styles.browseAllHead in index.tsx).
const TERMINAL_HEAD_HEIGHT = SECTION_HEAD_HEIGHT + Spacing.two * 2;

/**
 * THE composed-Home surface as ONE virtualized vertical list. Every rail, non-terminal grid block, the
 * terminal section head, and the terminal grid rows are `data` items (`HomeRow`), so LegendList
 * virtualizes them — off-screen rails actually UNMOUNT, instead of every rail being live at once inside
 * a never-virtualized `ListHeaderComponent` (the old shape, still used by `SeriesGrid` for the flat
 * results/favorites/page grids, which have no rails to virtualize).
 *
 * `numColumns` is 1: the multi-column terminal grid is flattened into full-width row items (`gridRow`)
 * so rails (full-width) and grid cells can share one vertical virtualization axis. Card layout still
 * comes from `useGridLayout`, so terminal cards read identically to the results grid.
 *
 * Carries the same hard-won list config as `series-grid.tsx` — see the comments there; each prop below
 * fixes a specific bug (web scroll throttle, fling jitter, recycling safety, Android overscroll glow).
 */
export function HomeFeed({
  rows,
  scopeKey,
  listRef,
  header,
  terminalLoading,
  paddingTop,
  paddingBottom,
  bridge,
  bridgeId,
  direct,
  originPage,
  crossfading,
  onSeeAll,
  sharedValues,
  onScroll,
  onEndReached,
  onScrollEndDrag,
  wrapperStyle,
}: {
  rows: HomeRow[];
  /** Feeds the list `key` and the terminal cards' recycle `cohort` (reset on scope change). */
  scopeKey: string;
  listRef?: RefObject<LegendListRef | null>;
  /** Above the first row — the error-retry block (the back banner never shows on composed Home). */
  header?: ReactElement | null;
  /** Render the terminal-grid first-load skeleton as the list footer (rows padded to match cells). */
  terminalLoading?: boolean;
  paddingTop: number;
  paddingBottom?: number;
  bridge?: string;
  bridgeId?: string;
  direct?: boolean;
  originPage?: string;
  crossfading?: boolean;
  onSeeAll?: (section: RailSection) => void;
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
}) {
  const { numColumns, cardWidth, railViewport, width } = useGridLayout();
  const wide = useIsLargeScreen();

  // Exact terminal-row height (matches series-grid.tsx's cellHeight), and the list-wide fallback used
  // for the measured block rows before they're laid out.
  const cellHeight = estimatedCardHeight(cardWidth) + CELL_ROW_GAP;

  // Centre content to MaxTopLevelWidth. Unlike SeriesGrid (whose contentContainer padding is
  // `sidePad` = centering + Spacing.four, with grid cells sitting directly in it), every HomeFeed row
  // self-pads Spacing.four (rails via STRIP_PAD, heads/blocks via their own paddingHorizontal, and the
  // terminal `gridRow` via `styles.row`). So the container carries ONLY the centering inset here, and
  // each row's own Spacing.four lands its content at the same x as a results-grid cell.
  const centerPad = Math.max(0, (width - MaxTopLevelWidth) / 2);

  // Row-type sizing. gridRow is EXACT (cellHeight), so LegendList never re-measures the many uniform
  // terminal rows — the same release-profile re-measure fix series-grid.tsx relies on. Rails and the
  // terminal head are declared as fixed upper-bound heights (railRowHeight already assumes a worst-case
  // 3-line title, so fixing it only ever leaves a little slack — never overlaps). Non-terminal grid
  // BLOCKS are variable (arbitrary "Load more" pages) so they return undefined and get measured.
  const getFixedItemSize = (row: HomeRow): number | undefined => {
    switch (row.type) {
      case 'gridRow':
        return cellHeight;
      case 'terminalHead':
        return TERMINAL_HEAD_HEIGHT;
      case 'rail':
        return railRowHeight(row.section.kind, railViewport, wide);
      case 'railSkeleton':
        return railRowHeight('regular', railViewport, wide);
      default:
        return undefined; // gridBlock / gridBlockSkeleton — measured
    }
  };

  // Fold the empty↔populated boundary + column count into the key, same as SeriesGrid (LegendList's web
  // build can crash on an empty→populated data swap mid-render; a key change makes it a fresh mount).
  const listKey = `${numColumns}|${scopeKey}|${rows.length > 0 ? 'full' : 'empty'}`;

  // Terminal-grid first-load skeleton — rows self-pad Spacing.four (via styles.row), matching the real
  // gridRow's inset, rather than GridSkeleton's SeriesGrid-shaped bleed which assumes the container
  // carries the extra Spacing.four (HomeFeed's contentContainer is centering-only).
  const footer = terminalLoading ? (
    <View style={styles.skelFooter}>
      {Array.from({ length: 2 }).map((_, r) => (
        <View key={r} style={[styles.row, styles.gridRow]}>
          {Array.from({ length: numColumns }).map((_, c) => (
            <SkeletonCard key={c} />
          ))}
        </View>
      ))}
    </View>
  ) : null;

  return (
    <Animated.View style={[styles.list, wrapperStyle]}>
      <AnimatedLegendList
        ref={listRef}
        key={listKey}
        style={styles.list}
        data={rows}
        keyExtractor={(row) => row.key}
        // Pool recycled views per row-type so a rail never recycles into a grid row (and vice versa).
        getItemType={(row) => homeRowType(row)}
        getFixedItemSize={getFixedItemSize}
        estimatedItemSize={cellHeight}
        // Rows are fixed/measured with correct sizes, so don't retro-correct offsets from measurement.
        maintainVisibleContentPosition={{ data: false, size: false }}
        // Terminal grid cards recycle (heavy, many); rails are keyed by section.id in renderItem so a
        // recycled slot gets a fresh Rail per section rather than bleeding peek/scroll state across.
        recycleItems
        sharedValues={sharedValues}
        // WEB ONLY — forces scrollEventThrottle:1 through the reanimated scroll bridge so onScroll /
        // recycling / onEndReached update during a drag, not only on release. See series-grid.tsx.
        renderScrollComponent={
          Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined
        }
        onScroll={onScroll}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop,
          paddingBottom: paddingBottom ?? BottomTabInset + Spacing.five,
          paddingLeft: centerPad,
          paddingRight: centerPad,
        }}
        renderItem={({ item }) => {
          switch (item.type) {
            case 'rail':
              return (
                <Rail
                  key={item.section.id}
                  section={item.section}
                  viewportWidth={railViewport}
                  onSeeAll={onSeeAll}
                  bridge={bridge}
                  bridgeId={bridgeId}
                  direct={direct}
                />
              );
            case 'railSkeleton':
              return <RailSkeleton viewportWidth={railViewport} title={item.title} />;
            case 'gridBlock':
              return (
                <HomeGridBlock
                  bridgeId={bridgeId}
                  section={item.section}
                  bridge={bridge}
                  direct={!!direct}
                  numColumns={numColumns}
                />
              );
            case 'gridBlockSkeleton':
              return (
                <View style={styles.homeGridBlock}>
                  <SectionHead title={item.title} />
                  <View style={styles.homeGridRows}>
                    {Array.from({ length: item.rows }).map((_, r) => (
                      <View key={r} style={[styles.row, styles.gridRow]}>
                        {Array.from({ length: numColumns }).map((_, c) => (
                          <SkeletonCard key={c} />
                        ))}
                      </View>
                    ))}
                  </View>
                </View>
              );
            case 'terminalHead':
              return (
                <View style={styles.terminalHead}>
                  <SectionHead title={item.title} />
                </View>
              );
            case 'gridRow':
              return (
                <View style={[styles.row, styles.gridRow]}>
                  {item.items.map((entry) => (
                    // Both dims fixed — cardWidth (from useGridLayout) + cellHeight — so a short final
                    // row just ends, matching series-grid.tsx's cell exactly.
                    <View key={entry.id} style={[styles.cell, { width: cardWidth, height: cellHeight }]}>
                      <SeriesCard
                        entry={entry}
                        bridge={bridge}
                        bridgeId={bridgeId}
                        direct={direct}
                        originPage={originPage}
                        cohort={scopeKey}
                        crossfading={crossfading}
                      />
                    </View>
                  ))}
                </View>
              );
          }
        }}
        onEndReachedThreshold={0.6}
        onEndReached={onEndReached}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
        onScrollEndDrag={onScrollEndDrag}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  row: {
    paddingHorizontal: Spacing.four,
  },
  // Terminal grid row: full-width, cards laid out horizontally with the shared column gap. Matches
  // series-grid.tsx's columnWrapper gap + cell width so home terminal cards align with results cells.
  gridRow: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
  // NO flex: 1 — pinned to cardWidth at the call site so a short last row ends rather than stretching.
  cell: {
    justifyContent: 'flex-start',
    paddingTop: CELL_PAD_TOP,
    paddingBottom: CELL_PAD_BOTTOM,
  },
  terminalHead: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  // Non-terminal grid skeleton block (mirrors HomeGridBlock's own layout).
  homeGridBlock: {
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  homeGridRows: {
    gap: Spacing.three,
  },
  skelFooter: {
    gap: Spacing.three,
  },
});
