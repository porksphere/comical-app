import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
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
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { mockSeries, SERIES_OPEN_DELAY_MS } from '@/data/mock';
import { LARGE_SCREEN_BREAKPOINT, useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

const LARGE_COVER_WIDTH = 200;

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

  const isLarge = width >= LARGE_SCREEN_BREAKPOINT;
  // Shared with the browse bar so both top bars are the same height.
  const barHeight = useTopBarHeight();
  // Sticky cover column is a web-only, large-screen affordance: as the page
  // scrolls, the left column pins to the top until the chapters end (mirrors the
  // reference's `position: sticky` cover col). Native has no sticky, and on a
  // small screen there's no second column to pin alongside.
  const sticky = isLarge && Platform.OS === 'web';

  // Give the cover the lion's share of the hero and keep the action column
  // narrow: actions take a small fixed slice, the cover fills the rest (capped
  // so it doesn't get absurd on very wide layouts). Only used on small screens.
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

  // Cover image + optional chapter-count badge — shared between layouts.
  const coverEl = (
    <View style={isLarge ? styles.coverWrapLarge : styles.coverWrap}>
      <Image
        source={{ uri: series.cover }}
        style={isLarge ? styles.coverLarge : styles.cover}
        contentFit="cover"
        transition={200}
      />
      {series.chapterCount != null && (
        <View style={styles.coverBadge}>
          <ThemedText style={styles.coverBadgeText}>{series.chapterCount}</ThemedText>
        </View>
      )}
    </View>
  );

  // Action buttons — shared between layouts; width controlled by parent.
  const actionsEl = (
    <View style={[styles.actions, !isLarge && { width: actionsWidth }]}>
      <ActionButton
        label={series.readLabel ?? '▶  Read'}
        variant="primary"
        onPress={() => {
          const params: Record<string, string> = {
            seed: series.id,
            title: series.title,
            start: '0',
          };
          if (direct === '1') params.direct = '1';
          else if (series.chapters?.length) {
            const first = series.chapters[series.chapters.length - 1];
            params.chapterId = first.id;
            params.chapterName = first.name;
          }
          router.push({ pathname: '/reader', params });
        }}
      />
      <ActionButton label="＋  Library" />
      {series.hasSources && <ActionButton label="Sources" caret />}
      {series.hasTrackers && <ActionButton label="Trackers" caret />}
      <ActionButton label="☆  Favorite" />
      {series.newCount != null && <NewBadge count={series.newCount} />}
    </View>
  );

  // Metadata, description, and chapters — placed in the right column (large)
  // or stacked below the hero row (small).
  const contentEl = (
    <>
      {series.genres?.length || series.tagGroups?.length ? (
        <View style={styles.tagsBlock}>
          {series.genres?.length ? <ChipRow labels={series.genres} /> : null}
          {series.tagGroups?.map((g) => <TagGroupRow key={g.label} group={g} />)}
        </View>
      ) : null}

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

      {/* Chapters live with the metadata (right column on large screens). The
          page-thumbnail grid for direct series is rendered separately, full-width
          below the columns (see `pagesEl`). */}
      <ChaptersSection
        chapters={series.chapters}
        pageThumbs={series.pageThumbs}
        seed={series.id}
        title={series.title}
        only="chapters"
      />
    </>
  );

  // Page-thumbnail grid (direct series only): full-width below the two-column
  // row, like the reference's `#page-thumbs` outside `.detail-head`. Rendering it
  // here also lets the sticky cover column release at the top of this grid.
  const pagesEl = (
    <ChaptersSection
      chapters={series.chapters}
      pageThumbs={series.pageThumbs}
      seed={series.id}
      title={series.title}
      only="pages"
    />
  );

  return (
    <ThemedView style={styles.container}>
      {/* Static top bar: back button + originating bridge name. */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top, height: insets.top + barHeight, borderBottomColor: theme.hairline },
        ]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.backButton, { height: barHeight }]}
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
            <SeriesSkeleton actionsWidth={actionsWidth} isLarge={isLarge} />
          ) : (
          <>
          <View style={styles.inner}>
            <ThemedText type="subtitle" style={styles.title}>
              {series.title}
            </ThemedText>

            {isLarge ? (
              /* Large screen: two-column layout — cover+actions left, content right. */
              <View style={styles.twoCol}>
                <View style={[styles.leftCol, sticky && styles.leftColSticky]}>
                  {coverEl}
                  {actionsEl}
                </View>
                <View style={styles.rightCol}>
                  {contentEl}
                </View>
              </View>
            ) : (
              /* Small screen: hero row then content stacked below. */
              <>
                <View style={styles.hero}>
                  {coverEl}
                  {actionsEl}
                </View>
                {contentEl}
              </>
            )}

            {/* Page-thumbnails (direct series): full-width below the columns. */}
            {pagesEl}
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

/** Loading placeholder that mirrors the series layout while the simulated fetch
 *  is in flight. Matches both the small-screen and large-screen layouts. */
function SeriesSkeleton({ actionsWidth, isLarge }: { actionsWidth: number; isLarge: boolean }) {
  const actionSkels = Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} style={styles.skelButton} />
  ));

  const coverSkel = (
    <View style={isLarge ? styles.coverWrapLarge : styles.coverWrap}>
      <Skeleton style={isLarge ? styles.coverLarge : styles.cover} />
    </View>
  );

  const rightSkel = (
    <>
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
    </>
  );

  return (
    <View style={styles.inner}>
      <View style={styles.skelTitle}>
        <Skeleton style={[styles.skelLine, { width: '85%', height: 26 }]} />
        <Skeleton style={[styles.skelLine, { width: '55%', height: 26 }]} />
      </View>

      {isLarge ? (
        <View style={styles.twoCol}>
          <View style={styles.leftCol}>
            {coverSkel}
            <View style={styles.actions}>{actionSkels}</View>
          </View>
          <View style={styles.rightCol}>{rightSkel}</View>
        </View>
      ) : (
        <>
          <View style={styles.hero}>
            {coverSkel}
            <View style={[styles.actions, { width: actionsWidth }]}>{actionSkels}</View>
          </View>
          {rightSkel}
        </>
      )}
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
    // height is set inline from the shared bar height.
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
  // ── Small-screen hero ────────────────────────────────────────────────────────
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
  // ── Large-screen two-column ───────────────────────────────────────────────
  twoCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.four,
  },
  leftCol: {
    width: LARGE_COVER_WIDTH,
    gap: Spacing.three,
  },
  // Web-only: pin the cover+actions column as the page scrolls. `position:
  // 'sticky'` isn't in RN's ViewStyle union but react-native-web passes it
  // straight to the DOM, so the cast is safe. The sticky region is bounded by
  // the `twoCol` row's height (driven by the taller right column), so it releases
  // once the chapters end — at the top of the page-thumbs / related rail.
  leftColSticky: {
    position: 'sticky',
    top: Spacing.four,
    alignSelf: 'flex-start',
  } as unknown as ViewStyle,
  rightCol: {
    flex: 1,
    gap: Spacing.four,
    minWidth: 0,
  },
  coverWrapLarge: {
    width: LARGE_COVER_WIDTH,
    position: 'relative',
  },
  coverLarge: {
    width: LARGE_COVER_WIDTH,
    aspectRatio: 2 / 3,
    borderRadius: 12,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  // ── Shared ────────────────────────────────────────────────────────────────
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
  // Genres + tag-group rows packed tightly together (the outer column's larger
  // gap then separates the whole block from the meta grid below).
  tagsBlock: {
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
