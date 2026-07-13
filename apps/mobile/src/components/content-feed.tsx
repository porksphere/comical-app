import type { LegendListRef } from '@legendapp/list/react-native';
import { useRouter } from 'expo-router';
import type { ReactElement, RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type Animated from 'react-native-reanimated';
import { type SharedValue } from 'react-native-reanimated';

import { HomeGridBlock } from '@/components/home-grid-block';
import { SkeletonCard } from '@/components/grid-skeleton';
import { Rail, RailSkeleton, SECTION_HEAD_HEIGHT, SectionHead, railRowHeight, railStripHeight } from '@/components/rail';
import { RecyclerList } from '@/components/recycler-list';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { contentRowType, type ContentRow, type SeeAllTarget } from '@/data/content-rows';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useIsLargeScreen } from '@/hooks/use-responsive';

// Terminal-grid cell inter-row spacing — mirrors series-grid.tsx's CELL_PAD_TOP/BOTTOM so a home
// terminal row reads at the exact same height as a results-grid cell (and matches the fixed cellHeight).
const CELL_PAD_TOP = Spacing.one;
const CELL_PAD_BOTTOM = Spacing.three - Spacing.one;
const CELL_ROW_GAP = CELL_PAD_TOP + CELL_PAD_BOTTOM;
// The two knobs for the vertical rhythm now that EVERY heading is a shared standalone `sectionHead`
// row: SECTION_GAP separates one section from the previous (the head's top pad), HEADING_GAP is the gap
// from a heading to its own body (the head's bottom pad). Tune here in one place.
const SECTION_GAP = Spacing.two;
const HEADING_GAP = Spacing.two;
const SECTION_HEAD_ROW_HEIGHT = SECTION_HEAD_HEIGHT + SECTION_GAP + HEADING_GAP;

/** A rail's See-all target → `/results` route params (expo-router params are strings). Omits absent
 *  fields; `direct` becomes '1' only when true; `listId` (home rail) or `query` (search rail) picks
 *  the drill kind on the results page. */
function seeAllParams(t: SeeAllTarget): Record<string, string> {
  const p: Record<string, string> = { title: t.title, bridgeId: t.bridgeId };
  if (t.bridge) p.bridge = t.bridge;
  if (t.direct) p.direct = '1';
  if (t.listId) p.listId = t.listId;
  if (t.query != null) p.query = t.query;
  return p;
}

/**
 * THE heterogeneous content feed: rails, non-terminal grid blocks, section headings, and the terminal
 * infinite-scroll grid rows all live as typed `ContentRow` items in ONE virtualized list, so off-screen
 * rails actually UNMOUNT (vs. every rail being live at once in a never-virtualized header). It's the
 * `getItemType`/mixed-height skin over `RecyclerList`; the uniform card grid is the OTHER skin,
 * `SeriesGrid`. Both share `RecyclerList`'s single copy of the LegendList config.
 *
 * Currently Browse's composed Home is the only caller (it supplies `ContentRow[]` via `buildHomeRows`),
 * but the component itself is surface-agnostic — any screen that needs mixed rails+grids in one list
 * can build its own `ContentRow[]` and render it here. `numColumns` is 1: the terminal grid is
 * flattened into full-width `gridRow` items so rails and grid cells share one vertical axis; card
 * layout still comes from `useGridLayout`, so terminal cards read identically to the results grid.
 */
export function ContentFeed({
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
  sharedValues,
  onScroll,
  onEndReached,
  onScrollEndDrag,
  wrapperStyle,
}: {
  rows: ContentRow[];
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
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
}) {
  const { numColumns, cardWidth, railViewport, width } = useGridLayout();
  const wide = useIsLargeScreen();
  const router = useRouter();

  const cellHeight = estimatedCardHeight(cardWidth) + CELL_ROW_GAP;

  // Centre content to MaxTopLevelWidth. Unlike SeriesGrid (whose `sidePad` = centering + Spacing.four,
  // with grid cells sitting directly in it), every ContentFeed row self-pads Spacing.four (rails via
  // STRIP_PAD, heads/blocks via their own paddingHorizontal, and the terminal `gridRow` via
  // `styles.row`). So the container carries ONLY the centering inset, and each row's own Spacing.four
  // lands its content at the same x as a results-grid cell.
  const centerPad = Math.max(0, (width - MaxTopLevelWidth) / 2);

  // Row-type sizing. gridRow is EXACT (cellHeight), so the many uniform terminal rows never re-measure.
  // Headings and rails are fixed upper-bound heights; non-terminal grid BLOCKS are variable (arbitrary
  // "Load more" pages) so they return undefined and get measured.
  const getFixedItemSize = (row: ContentRow): number | undefined => {
    switch (row.type) {
      case 'gridRow':
        return cellHeight;
      case 'sectionHead':
        return SECTION_HEAD_ROW_HEIGHT;
      case 'rail':
        // Strip only — the heading is its own preceding `sectionHead` row now.
        return railStripHeight(row.section.kind, railViewport, wide);
      case 'railSkeleton':
        // Self-headed (still renders its own title), so it's the whole head+strip height.
        return railRowHeight('regular', railViewport, wide);
      default:
        return undefined; // gridBlock / gridBlockSkeleton — measured
    }
  };

  // Terminal-grid first-load skeleton — rows self-pad Spacing.four (via styles.row), matching the real
  // gridRow's inset (ContentFeed's container is centering-only, unlike GridSkeleton's SeriesGrid shape).
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
    <RecyclerList
      data={rows}
      scopeKey={scopeKey}
      listRef={listRef}
      keyExtractor={(row) => row.key}
      // Pool recycled views per row-type so a rail never recycles into a grid row (and vice versa).
      getItemType={(row) => contentRowType(row)}
      getFixedItemSize={getFixedItemSize}
      estimatedItemSize={cellHeight}
      numColumns={1}
      header={header}
      footer={footer}
      paddingTop={paddingTop}
      paddingBottom={paddingBottom ?? BottomTabInset + Spacing.five}
      sidePad={centerPad}
      sharedValues={sharedValues}
      onScroll={onScroll}
      onEndReached={onEndReached}
      onScrollEndDrag={onScrollEndDrag}
      wrapperStyle={wrapperStyle}
      renderItem={({ item }) => {
        switch (item.type) {
          case 'sectionHead':
            return (
              <View style={styles.sectionHead}>
                <SectionHead
                  title={item.title}
                  // Every rail's "See all" pushes the shared /results page for that one bridge (a list
                  // drill or a search drill — see SeeAllTarget). Back returns here cleanly.
                  onSeeAll={
                    item.seeAll
                      ? () => router.push({ pathname: '/results', params: seeAllParams(item.seeAll!) })
                      : undefined
                  }
                />
              </View>
            );
          case 'rail':
            return (
              <Rail
                key={item.section.id}
                section={item.section}
                viewportWidth={railViewport}
                headless
                bridge={item.bridge ?? bridge}
                bridgeId={item.bridgeId ?? bridgeId}
                direct={item.direct ?? direct}
              />
            );
          case 'railSkeleton':
            return <RailSkeleton viewportWidth={railViewport} title={item.title} />;
          case 'gridBlock':
            return (
              <HomeGridBlock
                bridgeId={item.bridgeId ?? bridgeId}
                section={item.section}
                bridge={item.bridge ?? bridge}
                direct={!!(item.direct ?? direct)}
                numColumns={numColumns}
                headless
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
          case 'gridRow':
            return (
              <View style={[styles.row, styles.gridRow]}>
                {item.items.map((entry) => (
                  // Both dims fixed — cardWidth (from useGridLayout) + cellHeight — so a short final row
                  // just ends, matching series-grid.tsx's cell exactly. Bridge-scope the key (like
                  // SeriesGrid's keyExtractor) so a cross-bridge row can't collide on a shared seriesId.
                  <View
                    key={entry.bridgeId ? `${entry.bridgeId}:${entry.id}` : entry.id}
                    style={[styles.cell, { width: cardWidth, height: cellHeight }]}>

                    <SeriesCard
                      entry={entry}
                      bridge={entry.bridge ?? bridge}
                      bridgeId={entry.bridgeId ?? bridgeId}
                      direct={entry.direct ?? direct}
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
    />
  );
}

const styles = StyleSheet.create({
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
  // Shared standalone heading row for every section — SECTION_GAP above, HEADING_GAP below.
  sectionHead: {
    paddingTop: SECTION_GAP,
    paddingBottom: HEADING_GAP,
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
