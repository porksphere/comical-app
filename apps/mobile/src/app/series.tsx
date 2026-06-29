import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipRow, TagGroupRow } from '@/components/chip';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { Rail } from '@/components/rail';
import { SeriesCard } from '@/components/series-card';
import { ActionButton, NewBadge } from '@/components/series/action-button';
import { ChaptersSection } from '@/components/series/chapters-section';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TopBarHeight } from '@/constants/theme';
import { mockSeries, SERIES_OPEN_DELAY_MS } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

export default function SeriesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, title, bridge, direct } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
    direct?: string;
  }>();

  const series = useMemo(
    () => mockSeries(id ?? '', title, bridge ?? 'Library', { direct: direct === '1' }),
    [id, title, bridge, direct],
  );
  // Give the cover the lion's share of the hero and keep the action column
  // narrow: actions take a small fixed slice, the cover fills the rest (capped
  // so it doesn't get absurd on very wide layouts).
  const contentWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2;
  const actionsWidth = Math.round(Math.min(Math.max(contentWidth * 0.3, 116), 150));

  // Simulated fetch latency so the loading skeleton is visible when opening a
  // series. Resets if you navigate to a different one.
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), SERIES_OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [id, title, bridge]);

  return (
    <ThemedView style={styles.container}>
      {/* Static top bar: back button + originating bridge name. */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top, height: insets.top + TopBarHeight, borderBottomColor: theme.hairline },
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
          {loading ? (
            <SeriesSkeleton actionsWidth={actionsWidth} />
          ) : (
          <>
          <View style={styles.inner}>
            <ThemedText type="subtitle" style={styles.title}>
              {series.title}
            </ThemedText>

            {/* Hero: cover (with chapter-count badge) + the actions column. */}
            <View style={styles.hero}>
              <View style={styles.coverWrap}>
                <Image source={{ uri: series.cover }} style={styles.cover} contentFit="cover" transition={200} />
                {series.chapterCount != null && (
                  <View style={styles.coverBadge}>
                    <ThemedText style={styles.coverBadgeText}>{series.chapterCount}</ThemedText>
                  </View>
                )}
              </View>

              <View style={[styles.actions, { width: actionsWidth }]}>
                <ActionButton label={series.readLabel ?? '▶  Read'} variant="primary" />
                <ActionButton label="＋  Library" />
                {series.hasSources && <ActionButton label="Sources" caret />}
                {series.hasTrackers && <ActionButton label="Trackers" caret />}
                <ActionButton label="☆  Favorite" />
                {series.newCount != null && <NewBadge count={series.newCount} />}
              </View>
            </View>

            {/* Per-bridge dynamic sections: each renders only when present. */}
            {series.genres?.length ? <ChipRow labels={series.genres} /> : null}
            {series.tagGroups?.map((g) => <TagGroupRow key={g.label} group={g} />)}

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
              <Rail
                section={{ id: 'related', title: 'Related', kind: 'regular', items: series.related }}
                viewportWidth={width}
                bridge={series.bridge}
                direct={direct === '1'}
              />
            </View>
          ) : null}
          </>
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

/** Loading placeholder that mirrors the series layout (title, hero, chips, meta,
 *  description) while the simulated fetch is in flight. */
function SeriesSkeleton({ actionsWidth }: { actionsWidth: number }) {
  return (
    <View style={styles.inner}>
      <View style={styles.skelTitle}>
        <Skeleton style={[styles.skelLine, { width: '85%', height: 26 }]} />
        <Skeleton style={[styles.skelLine, { width: '55%', height: 26 }]} />
      </View>

      <View style={styles.hero}>
        <View style={styles.coverWrap}>
          <Skeleton style={styles.cover} />
        </View>
        <View style={[styles.actions, { width: actionsWidth }]}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} style={styles.skelButton} />
          ))}
        </View>
      </View>

      <View style={styles.skelChips}>
        {[60, 48, 80, 52, 70].map((w, i) => (
          <Skeleton key={i} style={[styles.skelChip, { width: w }]} />
        ))}
      </View>

      <Skeleton style={styles.skelMeta} />

      <View style={styles.skelTitle}>
        {(['100%', '96%', '100%', '60%'] as const).map((w, i) => (
          <Skeleton key={i} style={[styles.skelLine, { width: w, height: 13 }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    position: 'absolute',
    left: Spacing.three,
    bottom: 0,
    height: TopBarHeight,
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
    // Reference series title is the h2 default (~24px bold), not the 32px subtitle.
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  coverWrap: {
    flex: 1,
    maxWidth: 300,
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
    gap: Spacing.two,
  },
  metaGrid: {
    flexDirection: 'row',
    // Keep all cells (Status / Type / Author / Artist) on a single row, each an
    // equal column; long values wrap within their own cell.
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaCell: {
    flex: 1,
    gap: Spacing.half,
  },
  metaLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  description: {
    // Reference #detail-description: 0.88rem / line-height 1.5.
    fontSize: 14,
    lineHeight: 21,
  },
  related: {
    gap: Spacing.two,
  },
  skelTitle: {
    gap: Spacing.two,
  },
  skelLine: {
    borderRadius: 6,
  },
  skelButton: {
    height: 34,
    borderRadius: Spacing.two,
  },
  skelChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  skelChip: {
    height: 22,
    borderRadius: 999,
  },
  skelMeta: {
    height: 72,
    borderRadius: Spacing.three,
  },
});
