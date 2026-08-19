import type { LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { ComposedGesture } from 'react-native-gesture-handler';
import type Animated from 'react-native-reanimated';
import { type SharedValue } from 'react-native-reanimated';

import { HomeGridBlock } from '@/components/home-grid-block';
import { SkeletonCard } from '@/components/grid-skeleton';
import {
  Rail,
  RailSkeleton,
  SECTION_HEAD_HEIGHT,
  SectionHead,
  sectionHeadHeight,
  railRowHeight,
  railStripHeight,
} from '@/components/rail';
import { RecyclerList } from '@/components/recycler-list';
import { RetryBlock } from '@/components/retry-block';
import { estimatedCardHeight, SeriesCard } from '@/components/series-card';
import { StickySectionHeader, type StickySection } from '@/components/sticky-section-header';
import { useBridgeMap } from '@/hooks/use-bridges';
import { BottomTabInset, Spacing, TopLevelGutter, topLevelCenterInset } from '@/constants/theme';
import { contentRowType, type ContentRow, type SeeAllTarget } from '@/data/content-rows';
import { GRID_COLUMN_GAP, useGridLayout } from '@/hooks/use-grid-layout';
import { useIsCompact, useIsLargeScreen } from '@/hooks/use-responsive';
import { useRouter } from '@/lib/nav';

// Terminal-grid cell inter-row spacing — mirrors series-grid.tsx's CELL_PAD_TOP/BOTTOM so a home
// terminal row reads at the exact same height as a results-grid cell (and matches the fixed cellHeight).
const CELL_PAD_TOP = Spacing.half;
const CELL_PAD_BOTTOM = Spacing.half;
const CELL_ROW_GAP = CELL_PAD_TOP + CELL_PAD_BOTTOM;
// The two knobs for the vertical rhythm now that EVERY heading is a shared standalone `sectionHead`
// row: SECTION_GAP separates one section from the previous (the head's top pad), HEADING_GAP is the gap
// from a heading to its own body (the head's bottom pad). Tune here in one place.
// SECTION_GAP is deliberately tighter than HEADING_GAP: rail-to-rail spacing accumulates in the
// many-rail aggregate/Comical home, where a larger gap read as too airy — so sections sit closer
// together while each heading keeps its full breathing room above its own cards. 1px — a quarter
// of the base unit; even Spacing.half read as too much air, and no Spacing token goes this small.
const SECTION_GAP = 1;
const HEADING_GAP = Spacing.two;
const SECTION_HEAD_ROW_HEIGHT = SECTION_HEAD_HEIGHT + SECTION_GAP + HEADING_GAP;

/** A rail's See-all target → `/results` route params (expo-router params are strings). Omits absent
 *  fields; `direct` becomes '1' only when true; `listId` (home rail), `query` (search rail), or
 *  `favorites` ('1', the consolidated Favorites page) picks the drill kind on the results page. */
function seeAllParams(t: SeeAllTarget): Record<string, string> {
  const p: Record<string, string> = { title: t.title, bridgeId: t.bridgeId };
  if (t.bridge) p.bridge = t.bridge;
  if (t.direct) p.direct = '1';
  if (t.listId) p.listId = t.listId;
  if (t.query != null) p.query = t.query;
  if (t.favorites) p.favorites = '1';
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
  crossfading,
  stickyHeaderTop,
  stickyBarOffset,
  sharedValues,
  onScroll,
  onEndReached,
  onScrollEndDrag,
  wrapperStyle,
  scrollGesture,
  scrollEnabled,
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
  crossfading?: boolean;
  /** Screen-relative y where the sticky section heading pins — the top bar's bottom edge AT REST.
   *  Omit to disable the sticky (headings then simply scroll away inline). */
  stickyHeaderTop?: number;
  /** The top bar's slide (useSlidingBar's `offset`, 0 → −barHeight) — the sticky rides it, so the
   *  pinned heading stays glued to the bar's bottom edge as the bar hides and returns. */
  stickyBarOffset?: SharedValue<number>;
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached?: () => void;
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
  /** Passed through to `RecyclerList` — see the doc there (an over-the-list back-swipe's iOS interop). */
  scrollGesture?: ComposedGesture;
  /** Passed through to `RecyclerList` — false while a back-swipe is dragging this surface away. */
  scrollEnabled?: boolean;
}) {
  const { numColumns, cardWidth, railViewport, width } = useGridLayout();
  const wide = useIsLargeScreen();
  // The breakpoint `SectionHead` itself reads — the sticky sizes its band from the head's real
  // height. A DIFFERENT breakpoint from `wide` above.
  const compact = useIsCompact();
  const router = useRouter();
  // Per-bridge `cardSubtitles` flags: each rail reserves the sub line only if ITS bridge sends one
  // (aggregate rails mix bridges), and the terminal grid follows the feed's own bridge.
  const { subOf } = useBridgeMap();

  const cellHeight = estimatedCardHeight(cardWidth, subOf(bridgeId)) + CELL_ROW_GAP;

  // Centre content to MaxTopLevelWidth. Unlike SeriesGrid (whose `sidePad` = centering +
  // TopLevelGutter, with grid cells sitting directly in it), every ContentFeed row self-pads
  // TopLevelGutter (rails via STRIP_PAD, heads/blocks via their own paddingHorizontal, and the
  // terminal `gridRow` via `styles.row`). So the container carries ONLY the centering inset, and
  // each row's own gutter lands its content at the same x as a results-grid cell.
  const centerPad = topLevelCenterInset(width);

  // Row-type sizing. gridRow is EXACT (cellHeight), so the many uniform terminal rows never re-measure.
  // Headings and rails are fixed upper-bound heights; non-terminal grid BLOCKS are variable (arbitrary
  // "Load more" pages) so they return undefined and get measured.
  const getFixedItemSize = useCallback(
    (row: ContentRow): number | undefined => {
      switch (row.type) {
        case 'gridRow':
          return cellHeight;
        case 'sectionHead':
          return SECTION_HEAD_ROW_HEIGHT;
        case 'rail':
          // Strip only — the heading is its own preceding `sectionHead` row now. The rail's own
          // bridge (aggregate rails carry an override) decides whether the sub line is reserved.
          return railStripHeight(row.section.kind, railViewport, wide, subOf(row.bridgeId ?? bridgeId));
        case 'railSkeleton':
          // Self-headed (still renders its own title), so it's the whole head+strip height.
          return railRowHeight('regular', railViewport, wide, subOf(bridgeId));
        default:
          return undefined; // gridBlock / gridBlockSkeleton — measured
      }
    },
    [cellHeight, railViewport, wide, subOf, bridgeId],
  );

  // ── The sticky heading's offsets ────────────────────────────────────────────
  // Most rows have KNOWN heights (getFixedItemSize), so section-heading offsets are mostly pure
  // arithmetic — but grid BLOCKS are measured. Each mounted block reports its height here (the same
  // number LegendList measures off the same view), and the offset walk below uses it. Sections past
  // a block that hasn't measured yet are simply omitted: an unmounted block is at least a
  // drawDistance below the viewport, so its sections were nowhere near the pin line anyway.
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const onRowMeasured = useCallback((key: string, h: number) => {
    setMeasuredHeights((m) => (Math.abs((m[key] ?? -1) - h) < 0.5 ? m : { ...m, [key]: h }));
  }, []);
  type FeedSection = StickySection & { seeAll?: SeeAllTarget };
  const sections = useMemo<FeedSection[]>(() => {
    if (stickyHeaderTop === undefined) return [];
    // A list header (the error-retry block) sits above the rows and shifts every offset by its
    // unmeasured height — no sticky while one is up; a pinned heading matters least mid-error.
    if (header) return [];
    const out: FeedSection[] = [];
    let y = paddingTop;
    for (const row of rows) {
      // The HEAD's top (past the row's own top gap): the pinned copy is that head, so pinning it
      // there superimposes the two exactly at the hand-off — the band's padding is the band's, not
      // the row's. The row key rides along so that heading can hide itself while the pinned copy is
      // up, and the See-all target so the pinned chevron stays live.
      if (row.type === 'sectionHead') {
        out.push({
          key: row.key,
          label: row.title,
          top: y + SECTION_GAP,
          ...(row.seeAll ? { seeAll: row.seeAll } : {}),
        });
      }
      const h = getFixedItemSize(row) ?? measuredHeights[row.key];
      if (h === undefined) break;
      y += h;
    }
    return out;
  }, [rows, header, stickyHeaderTop, paddingTop, getFixedItemSize, measuredHeights]);

  // The heading the pinned copy is currently standing in for — that row keeps its space but drops
  // its content, so one heading is never drawn twice.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const onActiveChange = useCallback((key: string | null) => setPinnedKey(key), []);

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
    <View style={styles.fill}>
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
      // Rails eagerly load their cover images the moment they mount, so keep a tighter mount window
      // than the default 250 — fewer off-screen rails alive at once = fewer simultaneous image loads.
      drawDistance={120}
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
      scrollGesture={scrollGesture}
      scrollEnabled={scrollEnabled}
      renderItem={({ item }) => {
        switch (item.type) {
          case 'sectionHead':
            return (
              // Hidden — space kept — while the pinned copy stands in for this heading: at the pin
              // line the two are exactly superimposed, so one heading is never drawn twice.
              <View
                style={[styles.sectionHead, item.key === pinnedKey && styles.headHidden]}
                pointerEvents={item.key === pinnedKey ? 'none' : 'auto'}>
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
          case 'railError':
            // Shared error element (self-pads horizontally), shown in a failed rail's slot below its
            // sectionHead — so one bridge erroring in the aggregate feed offers a retry, not a gap.
            return <RetryBlock message={item.message} onRetry={item.onRetry} />;
          case 'gridBlock':
            return (
              // The one variable-height row — its measured height feeds the sticky heading's
              // offset walk (see onRowMeasured above).
              <View onLayout={(e) => onRowMeasured(item.key, e.nativeEvent.layout.height)}>
                <HomeGridBlock
                  bridgeId={item.bridgeId ?? bridgeId}
                  section={item.section}
                  bridge={item.bridge ?? bridge}
                  direct={!!(item.direct ?? direct)}
                  numColumns={numColumns}
                  headless
                />
              </View>
            );
          case 'gridBlockSkeleton':
            return (
              <View
                style={styles.homeGridBlock}
                onLayout={(e) => onRowMeasured(item.key, e.nativeEvent.layout.height)}>
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
    {stickyHeaderTop !== undefined && sharedValues && (
      <StickySectionHeader
        sections={sections}
        stickyTop={stickyHeaderTop}
        contentHeight={sectionHeadHeight(compact)}
        // The feed's inline heading rows are deliberately lopsided (SECTION_GAP above,
        // HEADING_GAP below); the BAND pads evenly instead — see StickySectionHeader.
        bandPadding={HEADING_GAP}
        // The overlay carries only the centering inset, like the list container: the row's own
        // `SectionHead` self-pads the gutter, exactly as it does inline.
        sidePad={centerPad}
        resetKey={scopeKey}
        scrollOffset={sharedValues.scrollOffset}
        barOffset={stickyBarOffset}
        onActiveChange={onActiveChange}
        // The SAME row the list renders inline, drill chevron and all — see StickySectionHeader.
        renderHeader={(s) => {
          const seeAll = s.seeAll;
          return (
            <SectionHead
              title={s.label}
              {...(seeAll ? { onSeeAll: () => router.push({ pathname: '/results', params: seeAllParams(seeAll) }) } : {})}
            />
          );
        }}
      />
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    paddingHorizontal: TopLevelGutter,
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
  // Space preserved, content dropped, while the pinned copy stands in for this heading.
  headHidden: {
    opacity: 0,
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
