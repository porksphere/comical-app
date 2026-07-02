import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { SeriesCard, TitlePeek, type CardSize } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useIsCompact, useIsLargeScreen } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import type { RailSection, SeriesEntry } from '@/data/types';

// Card cover aspect is 2:3, so a card of width W has a cover of height W·3/2;
// the title sits a card-gap below it. Used to place the lifted peek popover.
const COVER_RATIO = 3 / 2;
const STRIP_PAD_V = Spacing.one;
// Must match the SeriesCard's cover→title gap so the lifted peek lands on the title.
const CARD_GAP = Spacing.two;

// A rail: section header (title + "See all") above its cards. Mobile/narrow
// desktop keeps a snap-scrolling horizontal strip (mirrors the reference's
// `.carousel`); wide desktop instead wraps the first two rows into a static
// 6-column grid (no horizontal scroll) — "See all" reaches the rest.

const CARD_SIZE: Record<RailSection['kind'], CardSize> = {
  hero: 'hero',
  ranked: 'ranked',
  regular: 'rail',
};

// Desktop grid layout: two rows of six columns, capped — matches the main
// browse grid's max column count at wide viewports.
const GRID_COLUMNS = 6;
const GRID_ROWS = 2;
const GRID_ITEMS = GRID_COLUMNS * GRID_ROWS;

// Strip left/right inset — matches the reference's body padding (1.5rem = 24px
// = Spacing.four) on every width, so a rail's first card lines up with the
// section heading and the grid below it.
const STRIP_PAD = Spacing.four;

/** Reference: carousel gap is 1rem desktop / 0.5rem mobile (`@media max-width:
 *  560px`). 768px matches this file's other mobile/desktop split. */
function stripGapFor(viewport: number): number {
  return viewport < 768 ? Spacing.two : Spacing.three;
}

/**
 * Responsive card width per rail kind, given the current viewport width (passed
 * in from the screen so there's a single, hydration-safe dimensions source). On
 * mobile we size so that N full cards plus a ⅓ peek of the next fit the
 * viewport: with left pad P and gap G,
 *   P + N·c + N·G + c/3 = viewport  ⇒  c = (viewport − P − N·G) / (N + ⅓).
 * Regular/ranked carousels show 3 full + ⅓ (the reference's mobile CSS collapses
 * both to the same width); hero cards are larger, showing 2 full + ⅓. This
 * converges to nearly the same card width the reference's raw `flex-basis: 30%`
 * computes once its own padding is netted out — deriving it from the "N + ⅓
 * cards visible" constraint directly is more robust than porting the percentage
 * literally, which (having tried it) overshoots because comical-app's strip
 * doesn't share the reference's full-bleed padding cancellation. On wide
 * layouts we use comfortable fixed sizes.
 */
function peekWidth(viewport: number, fullCards: number, gap: number): number {
  return Math.round((viewport - STRIP_PAD - fullCards * gap) / (fullCards + 1 / 3));
}

function cardWidthFor(kind: RailSection['kind'], viewport: number): number {
  if (viewport >= 768) {
    return kind === 'hero' ? 210 : kind === 'ranked' ? 160 : 150;
  }
  const gap = stripGapFor(viewport);
  if (kind === 'hero') return peekWidth(viewport, 2, gap);
  return peekWidth(viewport, 3, gap);
}

/** Card width for the wide-desktop 6-column grid: fills the (capped) content
 *  width evenly across `GRID_COLUMNS`, same width for every rail kind so a row
 *  of six cards lines up regardless of the section's card size. */
function gridCardWidth(viewport: number, gap: number): number {
  const containerWidth = Math.min(viewport, MaxTopLevelWidth) - STRIP_PAD * 2;
  return Math.floor((containerWidth - (GRID_COLUMNS - 1) * gap) / GRID_COLUMNS);
}

export function Rail({
  section,
  viewportWidth,
  onSeeAll,
  bridge,
  bridgeId,
  direct,
}: {
  section: RailSection;
  /** Current viewport width, threaded from the screen. */
  viewportWidth: number;
  onSeeAll?: (section: RailSection) => void;
  /** Originating bridge name + whether it serves direct series — passed to each
   *  card so the series detail opens with the right header / page-grid view. */
  bridge?: string;
  /** Originating bridge's stable id, passed to each card for real API calls. */
  bridgeId?: string;
  direct?: boolean;
}) {
  const size = CARD_SIZE[section.kind];
  const wide = useIsLargeScreen();
  const stripGap = stripGapFor(viewportWidth);
  const cardWidth = wide ? gridCardWidth(viewportWidth, stripGap) : cardWidthFor(section.kind, viewportWidth);
  const ranked = section.kind === 'ranked';

  // The full-title peek lives here (not in the card) so it can float ABOVE the
  // horizontal scroller / grid, which would otherwise clip the card's own
  // popover. We position it from pure geometry — index, gap, scroll offset (or
  // measured row top, on the wide grid) — no DOM measurement of the card itself.
  const [peekIndex, setPeekIndex] = useState<number | null>(null);
  const [stripTop, setStripTop] = useState(0);
  const [rowTops, setRowTops] = useState<number[]>([]);
  const onPeekChange = useCallback((show: boolean, index: number) => {
    setPeekIndex((prev) => (show ? index : prev === index ? null : prev));
  }, []);

  // Track the strip's horizontal offset on the UI thread. The peek's left edge
  // used to be derived from a `scrollX` React state set in onScroll, so every
  // frame went JS-state → re-render → reposition and the popover visibly lagged
  // a few frames behind the natively-scrolling cards. Driving it from a shared
  // value + transform keeps it glued to its card without any JS round-trip.
  const scrollX = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  // Static (scroll-independent) base position of the peeked card; only changes
  // when a different card is peeked, not per scroll frame. On the wide grid the
  // peeked card sits in one of GRID_ROWS rows instead of a single scrolling row.
  const peekCol = peekIndex == null ? 0 : wide ? peekIndex % GRID_COLUMNS : peekIndex;
  const peekRow = peekIndex == null ? 0 : wide ? Math.floor(peekIndex / GRID_COLUMNS) : 0;
  const peekBase = peekIndex == null ? 0 : STRIP_PAD + peekCol * (cardWidth + stripGap);
  const rowTop = wide ? (rowTops[peekRow] ?? 0) : stripTop;
  const titleTop = rowTop + STRIP_PAD_V + cardWidth * COVER_RATIO + CARD_GAP;

  // The only per-frame update: slide the peek with the strip on the UI thread.
  // The wide grid doesn't scroll, so its peek stays put.
  const peekStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wide ? 0 : -scrollX.value }],
  }));

  const gridItems = section.items.slice(0, GRID_ITEMS);
  const gridRows: SeriesEntry[][] = [];
  for (let i = 0; i < gridItems.length; i += GRID_COLUMNS) gridRows.push(gridItems.slice(i, i + GRID_COLUMNS));

  return (
    <View style={[styles.section, peekIndex != null && styles.sectionPeeking]}>
      <SectionHead title={section.title} onSeeAll={onSeeAll ? () => onSeeAll(section) : undefined} />
      {wide ? (
        <View style={[styles.grid, { paddingHorizontal: STRIP_PAD, gap: stripGap }]}>
          {gridRows.map((row, r) => (
            <View
              key={r}
              style={[styles.gridRow, { gap: stripGap }]}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                setRowTops((prev) => (prev[r] === y ? prev : [...prev.slice(0, r), y, ...prev.slice(r + 1)]));
              }}>
              {row.map((item, c) => {
                const index = r * GRID_COLUMNS + c;
                return (
                  <SeriesCard
                    key={item.id}
                    entry={item}
                    size={size}
                    width={cardWidth}
                    rank={ranked ? index + 1 : undefined}
                    index={index}
                    onPeekChange={onPeekChange}
                    bridge={bridge}
                    bridgeId={bridgeId}
                    direct={direct}
                  />
                );
              })}
            </View>
          ))}
        </View>
      ) : (
        <Animated.FlatList
          horizontal
          data={section.items}
          keyExtractor={(it: SeriesEntry) => it.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.strip, { gap: stripGap }]}
          onLayout={(e) => setStripTop(e.nativeEvent.layout.y)}
          onScroll={scrollHandler}
          // Fire every scroll frame (not throttled to ~16ms): the lifted peek is
          // repositioned from these events, and on web react-native-web honors
          // this throttle, so a smaller value keeps the popover as tight to the
          // strip as this out-of-scroller design allows. The handler is a UI-thread
          // worklet, so the higher frequency is cheap.
          scrollEventThrottle={1}
          renderItem={({ item, index }: { item: SeriesEntry; index: number }) => (
            <SeriesCard
              entry={item}
              size={size}
              width={cardWidth}
              rank={ranked ? index + 1 : undefined}
              index={index}
              onPeekChange={onPeekChange}
              bridge={bridge}
              bridgeId={bridgeId}
              direct={direct}
            />
          )}
        />
      )}
      {peekIndex != null && (
        <TitlePeek
          title={section.items[peekIndex].title}
          style={[
            {
              left: peekBase - Spacing.two,
              right: 'auto',
              top: titleTop - Spacing.one,
              width: cardWidth + Spacing.two * 2,
            },
            peekStyle,
          ]}
        />
      )}
    </View>
  );
}

/** Generic "a rail is loading" placeholder — shown wherever a rail's data
 *  hasn't resolved yet (e.g. a related-series rail lazily fetched after the
 *  rest of the series page, or the home rails during a bridge/page switch).
 *  Mirrors the real `Rail`'s shape (heading + a row of 2:3 cards) without
 *  knowing the eventual title/item count, same way `SeriesSkeleton` mirrors
 *  series content it hasn't fetched yet. */
export function RailSkeleton({ viewportWidth }: { viewportWidth: number }) {
  const wide = useIsLargeScreen();
  const stripGap = stripGapFor(viewportWidth);
  const cardWidth = wide ? gridCardWidth(viewportWidth, stripGap) : cardWidthFor('regular', viewportWidth);
  const count = wide ? GRID_COLUMNS : 4;
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Skeleton style={styles.skelHeadTitle} />
      </View>
      <View style={[styles.strip, styles.skelStrip, { gap: stripGap }]}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={{ width: cardWidth }}>
            <Skeleton style={{ width: cardWidth, height: cardWidth * COVER_RATIO, borderRadius: 8 }} />
            <Skeleton style={styles.skelCardLine} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function SectionHead({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const theme = useTheme();
  // Match the reference's `.section-head h3`: 1.2rem mobile / 1.5rem desktop.
  const compact = useIsCompact();
  return (
    <View style={styles.head}>
      <ThemedText
        type="subtitle"
        style={[styles.headTitle, compact ? styles.headTitleCompact : styles.headTitleWide]}
        numberOfLines={1}>
        {title}
      </ThemedText>
      {onSeeAll && (
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            See all →
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
    position: 'relative',
  },
  // While peeking, lift the whole section so its popover draws over the rail
  // below it.
  sectionPeeking: {
    zIndex: 1000,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  headTitle: {
    flexShrink: 1,
  },
  headTitleCompact: {
    fontSize: 19.2,
    lineHeight: 25,
  },
  headTitleWide: {
    fontSize: 24,
    lineHeight: 30,
  },
  strip: {
    // gap is viewport-dependent — set inline (see `stripGapFor`) alongside this.
    paddingHorizontal: STRIP_PAD,
    // Vertical breathing room so the highlight ring (which sits just outside the
    // card) isn't clipped at the top/bottom of the horizontal strip.
    paddingVertical: Spacing.one,
  },
  // Wide-desktop static grid — paddingHorizontal/gap set inline (STRIP_PAD /
  // stripGapFor), row gap matches the column gap for an even grid.
  grid: {
    paddingVertical: Spacing.one,
  },
  gridRow: {
    flexDirection: 'row',
  },
  skelHeadTitle: {
    width: 140,
    height: 20,
    borderRadius: 4,
  },
  skelStrip: {
    flexDirection: 'row',
  },
  skelCardLine: {
    marginTop: Spacing.one,
    height: 12,
    width: '80%',
    borderRadius: 4,
  },
});
