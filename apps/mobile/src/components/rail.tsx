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

export function Rail({
  section,
  onSeeAll,
}: {
  section: RailSection;
  onSeeAll?: (section: RailSection) => void;
}) {
  const size = CARD_SIZE[section.kind];
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
          <SeriesCard entry={item} size={size} rank={ranked ? index + 1 : undefined} />
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
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
});
