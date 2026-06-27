import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

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
 * Responsive card width per rail kind. On mobile, a regular carousel shows
 * exactly 3 full cards plus a ⅓ peek of the 4th: with left pad P and gap G,
 *   P + 3·c + 3·G + c/3 = width  ⇒  c = 0.3·(width − P − 3·G).
 * Featured (hero) cards land "about the size" of carousel cards (a touch
 * larger); ranked sits between. On wide layouts we use comfortable fixed sizes.
 */
function useCardWidth(kind: RailSection['kind']): number {
  const { width } = useWindowDimensions();
  const mobile = width < 768;
  if (!mobile) {
    return kind === 'hero' ? 180 : kind === 'ranked' ? 160 : 150;
  }
  const base = Math.round(0.3 * (width - STRIP_PAD - 3 * STRIP_GAP));
  if (kind === 'hero') return Math.round(base * 1.18);
  if (kind === 'ranked') return Math.round(base * 1.05);
  return base;
}

export function Rail({
  section,
  onSeeAll,
}: {
  section: RailSection;
  onSeeAll?: (section: RailSection) => void;
}) {
  const size = CARD_SIZE[section.kind];
  const cardWidth = useCardWidth(section.kind);
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
  },
});
