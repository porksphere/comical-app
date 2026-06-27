import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { SeriesCard, type CardSize } from '@/components/series-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { RailSection, SeriesEntry } from '@/data/mock';

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
}: {
  section: RailSection;
  /** Current viewport width, threaded from the screen. */
  viewportWidth: number;
  onSeeAll?: (section: RailSection) => void;
}) {
  const size = CARD_SIZE[section.kind];
  const cardWidth = cardWidthFor(section.kind, viewportWidth);
  const ranked = section.kind === 'ranked';
  return (
    <View style={styles.section}>
      <SectionHead title={section.title} onSeeAll={onSeeAll ? () => onSeeAll(section) : undefined} />
      <FlatList
        horizontal
        data={section.items}
        keyExtractor={(it) => it.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        renderItem={({ item, index }: { item: SeriesEntry; index: number }) => (
          <SeriesCard entry={item} size={size} width={cardWidth} rank={ranked ? index + 1 : undefined} />
        )}
      />
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
