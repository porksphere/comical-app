import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { RetryBlock } from '@/components/retry-block';
import { ActionButton, NewBadge } from '@/components/series/action-button';
import { ChaptersSection } from '@/components/series/chapters-section';
import { TrackerButton } from '@/components/series/tracker-panel';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { isFavoriteQuery, queryKeys, seriesDetailQuery } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import type { SeriesDetail } from '@/data/types';
import { LARGE_SCREEN_BREAKPOINT, useTopBarHeight } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

const LARGE_COVER_WIDTH = 200;

export default function SeriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, title, bridge: bridgeParam, bridgeId, direct } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
    bridgeId?: string;
    direct?: string;
  }>();
  // series-card.tsx percent-encodes the bridge name before putting it in a
  // route param (parens in real bridge names break expo-router's web href
  // resolution) — undo that here.
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;

  // Cached series fetch: revisiting a series (or reopening it from the reader)
  // now repaints instantly from the query cache instead of refetching, and the
  // result survives an app restart via the persisted cache (see query-client.ts).
  const mock = useMockActive();
  const {
    data: series = null,
    error: queryError,
    refetch,
  } = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: direct === '1',
      bridgeName: bridge ?? 'Library',
      title,
    }),
  );
  const error = queryError ? (queryError as Error).message || 'Failed to load series' : null;
  const retry = refetch;

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
          {series?.bridge ?? bridge ?? ''}
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.five }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          {error ? (
            <RetryBlock message={error} onRetry={retry} />
          ) : !series ? (
            <SeriesSkeleton actionsWidth={actionsWidth} isLarge={isLarge} />
          ) : (
            <SeriesBody
              series={series}
              bridgeId={bridgeId}
              isLarge={isLarge}
              sticky={sticky}
              actionsWidth={actionsWidth}
              direct={direct === '1'}
              width={width}
            />
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

/** Two-column (large) / stacked (small) series detail — only rendered once the
 *  real (or mock) fetch has resolved, so it never has to handle a null series. */
function SeriesBody({
  series,
  bridgeId,
  isLarge,
  sticky,
  actionsWidth,
  direct,
  width,
}: {
  series: SeriesDetail;
  bridgeId?: string;
  isLarge: boolean;
  sticky: boolean;
  actionsWidth: number;
  direct: boolean;
  width: number;
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const mock = useMockActive();
  const queryClient = useQueryClient();

  // Favorite state: cached per series so the star is warm on revisit. Best-effort
  // — a bridge without the "favorites" capability (or one requiring auth the user
  // hasn't configured) 400s/401s here; the star just stays unfilled rather than
  // surfacing a full error state for what's a peripheral action, not content.
  const favKey = queryKeys.isFavorite(mock, bridgeId ?? '', series.id);
  const { data: favData, isError: favIsError } = useQuery({
    ...isFavoriteQuery(ds, mock, bridgeId ?? '', series.id),
    // A favorites check that errors (unsupported/unauthed) should read as "not
    // favorited", not spin a retry loop — keep it quiet like the previous
    // best-effort catch (the star just stays unfilled).
    retry: false,
  });
  // `null` only while still loading (toggle disabled); an errored check reads as
  // `false` so the button stays usable, matching the prior best-effort behavior.
  const favorited = favData ?? (favIsError ? false : null);
  // Optimistic toggle: flip the cached value immediately, invalidate the
  // favorites list so it reflects the change, and roll back on failure — mirrors
  // comical-web's optimistic favorite + `favoritesCache.delete` invalidation.
  const favMutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? ds.addFavorite(bridgeId!, series.id) : ds.removeFavorite(bridgeId!, series.id),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: favKey });
      const prev = queryClient.getQueryData<boolean>(favKey);
      queryClient.setQueryData(favKey, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(favKey, ctx.prev ?? false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites', mock, bridgeId] });
    },
  });
  const toggleFavorite = () => {
    if (!bridgeId || favorited === null) return;
    favMutation.mutate(!favorited);
  };

  // Cover image + optional chapter-count badge — shared between layouts.
  const coverEl = (
    <View style={isLarge ? styles.coverWrapLarge : styles.coverWrap}>
      <Image
        source={{ uri: series.cover }}
        style={isLarge ? styles.coverLarge : styles.cover}
        contentFit="cover"
        cachePolicy="memory-disk"
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
          if (bridgeId) params.bridgeId = bridgeId;
          if (direct) params.direct = '1';
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
      {series.hasTrackers && <TrackerButton seriesId={series.id} initialLinks={series.trackers ?? []} />}
      <ActionButton label={favorited ? '★  Favorited' : '☆  Favorite'} onPress={toggleFavorite} />
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
        bridgeId={bridgeId}
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
      bridgeId={bridgeId}
      only="pages"
    />
  );

  return (
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
            <View style={styles.rightCol}>{contentEl}</View>
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

      {/* Related rails (per-bridge): full-bleed, outside the padded inner. A
          bridge may surface any number of labeled groups (sequels, similar, …). */}
      {series.relatedGroups?.length ? (
        <View style={styles.related}>
          {series.relatedGroups.map(
            (group, i) =>
              group.items.length > 0 && (
                <Rail
                  key={`${group.label}-${i}`}
                  section={{ id: `related-${i}`, title: group.label, kind: 'regular', items: group.items }}
                  viewportWidth={width}
                  bridge={series.bridge}
                  bridgeId={bridgeId}
                  direct={direct}
                />
              ),
          )}
        </View>
      ) : null}
    </>
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
    // Mirrors `.cover-badge`'s `box-shadow: 0 1px 4px rgba(0,0,0,0.5)`.
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
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
    gap: Spacing.five,
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
