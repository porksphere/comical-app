import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { estimatedCardHeight, SeriesCard, TitlePeek, type CardSize } from '@/components/series-card';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
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
  // The inter-card gap is split as symmetric padding on each item wrapper (not an
  // ItemSeparator), so the highlight ring's outward bleed has room on BOTH sides of
  // every card. LegendList's web item container is `contain: paint` (react-native.web.js),
  // which hard-clips anything past the item box — with the old right-only separator the
  // card sat flush against its box's left edge, so the ring's left stroke was cut off.
  const stripHalfGap = stripGap / 2;
  const cardWidth = wide ? gridCardWidth(viewportWidth, stripGap) : cardWidthFor(section.kind, viewportWidth);
  const ranked = section.kind === 'ranked';
  // Reserve the strip's height up front (worst-case card: cover + a 3-line title + sub, plus the
  // stripItem's vertical padding) so a fresh horizontal LegendList — one that mounts cold on a
  // bridge switch, since rails are keyed by section.id and remount rather than recycle — occupies
  // its final height immediately instead of virtualizing up from 0 and visibly popping the cards
  // in. Shares the grid's own `estimatedCardHeight` math so the two can't drift. `minHeight` (not a
  // fixed height): titles clamp to 3 lines so a card can't exceed this, and a rail whose cards all
  // have short titles just reserves a little unused bottom space, consistently.
  const stripMinHeight = estimatedCardHeight(cardWidth) + STRIP_PAD_V * 2;

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
  // AnimatedLegendList writes the strip's horizontal offset into `scrollX` on the UI thread via its
  // `sharedValues` prop (below); the peek transform reads it directly — no worklet onScroll needed.
  const scrollX = useSharedValue(0);

  // Desktop web only: a horizontal ScrollView (LegendList or FlatList alike) can't be dragged with a
  // mouse — touch swipe and shift+wheel work, but click-and-drag does nothing. Add grab-and-pull
  // drag-to-scroll on the strip's scroll node, and swallow the click that follows a real drag so a
  // card doesn't navigate when you were only scrolling.
  const listRef = useRef<LegendListRef>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || wide) return;
    const node = listRef.current?.getNativeScrollRef?.() as unknown as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    node.style.cursor = 'grab';
    node.style.userSelect = 'none';
    let down = false;
    let dragged = false;
    let startX = 0;
    let startScroll = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return; // native touch scrolling is fine
      down = true;
      dragged = false;
      startX = e.clientX;
      startScroll = node.scrollLeft;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) > 4) {
        dragged = true;
        node.style.cursor = 'grabbing';
      }
      if (dragged) {
        node.scrollLeft = startScroll - dx;
        e.preventDefault();
      }
    };
    const endDrag = () => {
      down = false;
      node.style.cursor = 'grab';
    };
    const onClickCapture = (e: MouseEvent) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    };
    // The cards contain <img>, so a mousedown-drag otherwise starts the browser's native image
    // drag-and-drop, which kills the pointermove stream after one frame. Suppress it.
    const onDragStart = (e: Event) => e.preventDefault();
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    node.addEventListener('dragstart', onDragStart);
    node.addEventListener('click', onClickCapture, true);
    return () => {
      node.style.cursor = '';
      node.style.userSelect = '';
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('click', onClickCapture, true);
    };
  }, [wide]);

  // iOS-only mount-time reset: a LegendList horizontal strip can render already
  // scrolled away from its start on iOS (an upstream recycling/positioning
  // regression — legendapp/list#458, iOS-only, Android/web unaffected). This is a
  // no-op once already at offset 0, so it costs nothing when the bug doesn't
  // reproduce; it's just cheap insurance against a rail opening mid-list.
  useEffect(() => {
    if (Platform.OS !== 'ios' || wide) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide the lifted title peek the instant a drag starts on the strip. A peek is
  // opened by a press-hold (see SeriesCard's `useHeld`, with a huge
  // `pressRetentionOffset` so a finger sliding off the card doesn't cancel it) —
  // if that same touch turns into a horizontal drag of the strip, the card's
  // `active` state never turns off mid-drag, so the popover would otherwise keep
  // trying to follow the scroll. On iOS, `AnimatedLegendList`'s reanimated-driven
  // transform lands a frame behind the native scroll during a fling (an upstream
  // reanimated/UIScrollView compositing gap — legendapp/list#489, far less
  // visible on Android/web), which reads as the popover visibly lagging/glitching
  // behind its card — the "scrolling seems bugged" symptom. A held-but-dragging
  // popover isn't useful anyway, so just drop it for the duration of the drag.
  const hidePeekForDrag = useCallback(() => setPeekIndex(null), []);

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
        <AnimatedLegendList
          ref={listRef}
          horizontal
          // iOS only: let content escape the strip's vertical bounds so a long-pressed card's lifted
          // context-menu preview isn't clipped at the top. The strip is short (just card height), so
          // unlike the full-height vertical grid it has no headroom for the lift — `overflow: visible`
          // turns off the scroll view's clipsToBounds so the system preview can draw above it. Kept
          // iOS-only: on web/Android the horizontal scroller must keep clipping (web relies on it to
          // not overflow the page; Android's menu is a dropdown with no lift to clear anyway).
          style={[{ minHeight: stripMinHeight }, Platform.OS === 'ios' && { overflow: 'visible' }]}
          data={section.items}
          keyExtractor={(it) => it.id}
          // Recycle-safe now (SeriesCard resets its per-item state on entry change), so reuse card
          // instances as the strip scrolls instead of remounting each heavy card.
          recycleItems
          estimatedItemSize={cardWidth + stripGap}
          // Give LegendList the strip's size on the very first render. Without it, its
          // `initialScrollLength` defaults to 0 (`react-native.web.js`: estimatedListSize ?? {width:0}),
          // so a cold-mounting rail lays every card out as if the container were zero-width — all
          // squashed at the left — until `onLayout` measures the real width and it repositions (the
          // visible "expand out to correct spacing"). Rails remount on a bridge switch (keyed by
          // section.id), so they hit this every time; seeding the width positions them correctly on
          // frame one. Width is the viewport the strip spans; height reuses the reserved strip height.
          estimatedListSize={{ width: viewportWidth, height: stripMinHeight }}
          showsHorizontalScrollIndicator={false}
          // WEB ONLY (same rationale + native carve-out as Browse's main grid): without a
          // renderScrollComponent, @legendapp/list/reanimated's scroll bridge renders
          // Animated.ScrollView at whatever scrollEventThrottle LegendList's internals hardcode
          // (0), and react-native-web's ScrollView at throttle 0 only fires onScroll at gesture
          // start and ~100ms after it goes idle — so on web, holding a finger down and dragging
          // through the strip never recycled newly-visible cards (or moved the peek popover, or
          // advanced anything else keyed off scroll position) until you let go. Passing this
          // routes through the bridge's other branch, which forces scrollEventThrottle: 1.
          // On NATIVE we don't pass it: forcing throttle:1 there just adds per-frame JS work during
          // a fling, and the peek is driven by the UI-thread `scrollX` (sharedValues below), which
          // works regardless — native's default bridge recycles fine (the debounce bug is web-only).
          renderScrollComponent={
            Platform.OS === 'web' ? (scrollProps) => <Animated.ScrollView {...scrollProps} /> : undefined
          }
          // LegendList positions items virtually and ignores `gap` on contentContainerStyle, and its
          // web item container is `contain: paint` (clips overflow). So the inter-card gap lives as
          // symmetric `paddingHorizontal: stripHalfGap` on each item wrapper below — this both spaces
          // the cards (halfGap + halfGap = stripGap between neighbours) AND leaves the highlight ring
          // room inside the clipped box on every side. The outer inset then only needs the remaining
          // STRIP_PAD − stripHalfGap so the first card still lines up under the section heading.
          contentContainerStyle={{ paddingLeft: STRIP_PAD - stripHalfGap, paddingRight: STRIP_PAD - stripHalfGap }}
          onLayout={(e) => setStripTop(e.nativeEvent.layout.y)}
          onScrollBeginDrag={hidePeekForDrag}
          onMomentumScrollBegin={hidePeekForDrag}
          // Feeds scrollX on the UI thread; the lifted peek slides from it via transform (see
          // peekStyle), keeping the popover glued to its card with no JS round-trip.
          sharedValues={{ scrollOffset: scrollX }}
          renderItem={({ item, index }) => (
            <View style={[styles.stripItem, { paddingHorizontal: stripHalfGap }]}>
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
            </View>
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
export function RailSkeleton({ viewportWidth, title }: { viewportWidth: number; title?: string }) {
  const wide = useIsLargeScreen();
  const stripGap = stripGapFor(viewportWidth);
  const cardWidth = wide ? gridCardWidth(viewportWidth, stripGap) : cardWidthFor('regular', viewportWidth);
  const count = wide ? GRID_COLUMNS : 4;
  return (
    <View style={styles.section}>
      {/* A known title (the Home skeleton, which already has it from the bridge's list
          metadata) renders as real text immediately, same as SectionHead — only the cards
          below are actually unknown. Callers with no title yet (e.g. series.tsx's related-
          rail, fetched lazily with no name to show) keep the skeleton bar. */}
      {title ? (
        <SectionHead title={title} />
      ) : (
        <View style={styles.head}>
          <Skeleton style={styles.skelHeadTitle} />
        </View>
      )}
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
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <View style={styles.head}>
      <ThemedText
        type="subtitle"
        style={[styles.headTitle, compact ? styles.headTitleCompact : styles.headTitleWide]}
        numberOfLines={1}>
        {title}
      </ThemedText>
      {onSeeAll && (
        <Pressable
          onPress={onSeeAll}
          onHoverIn={onHoverIn}
          onHoverOut={onHoverOut}
          hitSlop={8}
          style={({ pressed }) => [
            styles.seeAll,
            pressed && styles.seeAllPressed,
            // Brighten (not dim) on hover — same treatment as the chapter tab strip.
            hovered && { backgroundColor: theme.backgroundSelected },
          ]}>
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
  seeAll: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 8,
  },
  seeAllPressed: {
    opacity: 0.7,
  },
  strip: {
    // gap is viewport-dependent — set inline (see `stripGapFor`) alongside this.
    paddingHorizontal: STRIP_PAD,
    // Vertical breathing room so the highlight ring (which sits just outside the
    // card) isn't clipped at the top/bottom of the horizontal strip.
    paddingVertical: Spacing.one,
  },
  // Per-card wrapper for the LegendList strip. LegendList's web item container is `contain: paint`,
  // so the highlight ring (which bleeds a couple px outside the cover) is clipped to this wrapper's
  // box — hence the ring's room lives here: STRIP_PAD_V vertically, and `paddingHorizontal:
  // stripHalfGap` (applied inline, since the gap is viewport-dependent) horizontally. STRIP_PAD_V
  // matches the peek popover's assumed inset so it still lands on the title.
  stripItem: {
    paddingVertical: STRIP_PAD_V,
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
