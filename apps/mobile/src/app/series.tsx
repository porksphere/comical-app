import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipRow, TagGroupRow } from '@/components/chip';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { Rail } from '@/components/rail';
import { SeriesCard } from '@/components/series-card';
import { ActionButton, NewBadge } from '@/components/series/action-button';
import { ChaptersSection } from '@/components/series/chapters-section';
import { StatsRow } from '@/components/series/stats-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { mockSeries } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

const BAR_HEIGHT = 44;

export default function SeriesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, title, bridge } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
  }>();

  const series = useMemo(
    () => mockSeries(id ?? '', title, bridge ?? 'Library'),
    [id, title, bridge],
  );
  const coverWidth = width >= 750 ? 200 : 140;

  return (
    <ThemedView style={styles.container}>
      {/* Static top bar: back button + originating bridge name. */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top, height: insets.top + BAR_HEIGHT, borderBottomColor: theme.hairline },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ChevronLeftIcon color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.bridgeName}>
          {series.bridge}
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.five }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          <View style={styles.inner}>
            <ThemedText type="subtitle" style={styles.title}>
              {series.title}
            </ThemedText>

            {/* Hero: cover (with chapter-count badge) + the actions column. */}
            <View style={styles.hero}>
              <View style={[styles.coverWrap, { width: coverWidth }]}>
                <Image source={{ uri: series.cover }} style={styles.cover} contentFit="cover" transition={200} />
                {series.chapterCount != null && (
                  <View style={styles.coverBadge}>
                    <ThemedText style={styles.coverBadgeText}>{series.chapterCount}</ThemedText>
                  </View>
                )}
              </View>

              <View style={styles.actions}>
                <ActionButton label={series.readLabel ?? '▶  Read'} variant="primary" />
                <ActionButton label="＋  Library" />
                {series.hasSources && <ActionButton label="Sources" caret />}
                {series.hasTrackers && <ActionButton label="Trackers" caret />}
                <ActionButton label="☆  Favorite" />
                {series.newCount != null && <NewBadge count={series.newCount} />}
              </View>
            </View>

            {/* Per-bridge dynamic sections: each renders only when present. */}
            {series.genres?.length ? <ChipRow labels={series.genres} accent /> : null}
            {series.tagGroups?.map((g) => <TagGroupRow key={g.label} group={g} />)}
            {series.stats?.length ? <StatsRow stats={series.stats} /> : null}

            {series.meta?.length ? (
              <View style={[styles.metaGrid, { borderColor: theme.hairline }]}>
                {series.meta.map((m) => (
                  <View key={m.label} style={styles.metaCell}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.metaLabel}>
                      {m.label}
                    </ThemedText>
                    <ThemedText type="small">{m.value}</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            {series.description ? (
              <ThemedText themeColor="textSecondary" style={styles.description}>
                {series.description}
              </ThemedText>
            ) : null}

            <ChaptersSection chapters={series.chapters} pageThumbs={series.pageThumbs} />
          </View>

          {/* Related rail (per-bridge): full-bleed, outside the padded inner. */}
          {series.related?.length ? (
            <View style={styles.related}>
              <Rail section={{ id: 'related', title: 'Related', kind: 'regular', items: series.related }} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    position: 'absolute',
    left: Spacing.three,
    bottom: Spacing.one,
    height: BAR_HEIGHT - Spacing.two,
    justifyContent: 'center',
  },
  bridgeName: {
    maxWidth: '70%',
  },
  scroll: {
    paddingTop: Spacing.four,
    alignItems: 'center',
  },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.four,
  },
  inner: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: {
    lineHeight: 40,
  },
  hero: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  coverWrap: {
    position: 'relative',
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 12,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  coverBadge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  coverBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  actions: {
    flex: 1,
    gap: Spacing.two,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaCell: {
    gap: Spacing.half,
    minWidth: 120,
  },
  metaLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  description: {
    lineHeight: 22,
  },
  related: {
    gap: Spacing.two,
  },
});
