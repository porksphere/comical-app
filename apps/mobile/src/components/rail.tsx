import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { SeriesCard, TitlePeek, type CardSize } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { RailSection, SeriesEntry } from '@/data/mock';

// Card cover aspect is 2:3, so a card of width W has a cover of height W·3/2;
// the title sits a card-gap below it. Used to place the lifted peek popover.
const COVER_RATIO = 3 / 2;
const STRIP_PAD_V = Spacing.one;
// Must match the SeriesCard's cover→title gap so the lifted peek lands on the title.
const CARD_GAP = Spacing.two;

// A horizontal rail: section header (title + "See all") above a snap-scrolling
// strip of cards. Mirrors the reference's `.carousel` (with hero / ranked size
// variants). We keep horizontal scroll on all widths (see plan: cross-platform
// liberty #3) rather than wrapping into a capped grid on desktop.

const CARD_SIZE: Record<RailSection['kind'], CardSize> = {
  hero: 'hero',
  ranked: 'ranked',
  regular: 'rail',
};

// Strip layout: outer padding + inter-card gap. Kept here so the responsive
// card width that yields "3 full + ⅓ of the next" on mobile stays in sync with
// the strip's actual padding/gap below.
const STRIP_PAD = Spacing.four;
const STRIP_GAP = Spacing.three;

/**
 * Responsive card width per rail kind, given the current viewport width (passed
 * in from the screen so there's a single, hydration-safe dimensions source). On
 * mobile we size so that N full cards plus a ⅓ peek of the next fit the
 * viewport: with left pad P and gap G,
 *   P + N·c + N·G + c/3 = viewport  ⇒  c = (viewport − P − N·G) / (N + ⅓).
 * Regular carousels show 3 full + ⅓; featured (hero) cards are larger, showing
 * 2 full + ⅓. On wide layouts we use comfortable fixed sizes.
 */
function peekWidth(viewport: number, fullCards: number): number {
  return Math.round((viewport - STRIP_PAD - fullCards * STRIP_GAP) / (fullCards + 1 / 3));
}

function cardWidthFor(kind: RailSection['kind'], viewport: number): number {
  if (viewport >= 768) {
    return kind === 'hero' ? 210 : kind === 'ranked' ? 160 : 150;
  }
  if (kind === 'hero') return peekWidth(viewport, 2);
  if (kind === 'ranked') return Math.round(peekWidth(viewport, 3) * 1.05);
  return peekWidth(viewport, 3);
}

export function Rail({
  section,
  viewportWidth,
  onSeeAll,
  bridge,
  direct,
}: {
  section: RailSection;
  /** Current viewport width, threaded from the screen. */
  viewportWidth: number;
  onSeeAll?: (section: RailSection) => void;
  /** Originating bridge name + whether it serves direct series — passed to each
   *  card so the series detail opens with the right header / page-grid view. */
  bridge?: string;
  direct?: boolean;
}) {
  const size = CARD_SIZE[section.kind];
  const cardWidth = cardWidthFor(section.kind, viewportWidth);
  const ranked = section.kind === 'ranked';

  // The full-title peek lives here (not in the card) so it can float ABOVE the
  // horizontal scroller, which would otherwise clip the card's own popover. We
  // position it from pure geometry — index, gap, scroll offset — no DOM
  // measurement, so it's deterministic and follows the strip as it scrolls.
  const [peekIndex, setPeekIndex] = useState<number | null>(null);
  const [stripTop, setStripTop] = useState(0);
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
  // when a different card is peeked, not per scroll frame.
  const peekBase = peekIndex == null ? 0 : STRIP_PAD + peekIndex * (cardWidth + STRIP_GAP);
  const titleTop = stripTop + STRIP_PAD_V + cardWidth * COVER_RATIO + CARD_GAP;

  // The only per-frame update: slide the peek with the strip on the UI thread.
  const peekStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -scrollX.value }],
  }));

  return (
    <View style={[styles.section, peekIndex != null && styles.sectionPeeking]}>
      <SectionHead title={section.title} onSeeAll={onSeeAll ? () => onSeeAll(section) : undefined} />
      <Animated.FlatList
        horizontal
        data={section.items}
        keyExtractor={(it: SeriesEntry) => it.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
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
            direct={direct}
          />
        )}
      />
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

export function SectionHead({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.head}>
      <ThemedText type="subtitle" style={styles.headTitle} numberOfLines={1}>
        {title}
      </ThemedText>
      {onSeeAll && (
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            See all
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
    fontSize: 22,
    lineHeight: 28,
    flexShrink: 1,
  },
  strip: {
    gap: STRIP_GAP,
    paddingHorizontal: STRIP_PAD,
    // Vertical breathing room so the highlight ring (which sits just outside the
    // card) isn't clipped at the top/bottom of the horizontal strip.
    paddingVertical: Spacing.one,
  },
});
