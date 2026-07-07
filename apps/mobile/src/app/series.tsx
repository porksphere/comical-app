import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipRow, TagGroupRow } from '@/components/chip';
import { Rail, RailSkeleton } from '@/components/rail';
import { RetryBlock } from '@/components/retry-block';
import { ActionButton, NewBadge } from '@/components/series/action-button';
import { ChaptersSection, PageThumbList } from '@/components/series/chapters-section';
import { TrackerButton } from '@/components/series/tracker-panel';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { setBrowseIntent } from '@/data/browse-intent';
import {
  historyQuery,
  inLibraryQuery,
  isFavoriteQuery,
  queryKeys,
  relatedGroupsQuery,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
import { resetPreferredGroup, usePreferredGroup } from '@/lib/preferred-group';
import { DIRECT_CHAPTER_ID, type SeriesDetail, type TagGroup } from '@/data/types';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { LARGE_SCREEN_BREAKPOINT } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

const LARGE_COVER_WIDTH = 200;

/** Meta cells whose value should open a matching Browse search, keyed by the
 *  cell's `label` (see `buildMeta` in `data/source.ts`) to the `BrowseIntent`
 *  meta key it maps to. STATUS is left static — a lifecycle value like
 *  "Ongoing" isn't a meaningful search term the way an author/artist/type is. */
const SEARCHABLE_META_KEYS: Record<string, 'author' | 'artist' | 'type' | undefined> = {
  AUTHOR: 'author',
  ARTIST: 'artist',
  TYPE: 'type',
};

export default function SeriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, title, bridge: bridgeParam, bridgeId, direct, cover: coverParam } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
    bridgeId?: string;
    direct?: string;
    cover?: string;
  }>();
  // series-card.tsx percent-encodes the bridge name before putting it in a
  // route param (parens in real bridge names break expo-router's web href
  // resolution) — undo that here.
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  // Cover forwarded from the browse card, escaped the same way — decode it so the
  // loading skeleton can show the real (cache-warm) cover instead of a shimmer.
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;

  // Opening a different series clears the remembered scanlation group, so a
  // preference carried over from the last series doesn't pick versions here.
  // Keyed on `id` so it fires on a series change, not on a back-navigation to the
  // same series (which must keep the group the user was reading).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Cached series fetch: revisiting a series (or reopening it from the reader)
  // now repaints instantly from the query cache instead of refetching, and the
  // result survives an app restart via the persisted cache (see query-client.ts).
  const mock = useMockActive();
  const {
    data: series = null,
    error: queryError,
    isPlaceholderData,
    refetch,
  } = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: direct === '1',
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
  );
  const error = queryError ? (queryError as Error).message || 'Failed to load series' : null;
  const retry = refetch;

  const isLarge = width >= LARGE_SCREEN_BREAKPOINT;
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

  // Error / deep-link skeleton stay in a plain ScrollView; a resolved SeriesBody
  // owns its own scroll container (a ScrollView for chaptered series, a
  // virtualized LegendList for direct/page-thumbnail series — see SeriesBody).
  const scrollFallback = (child: ReactNode) => (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.five }]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.column}>{child}</View>
    </ScrollView>
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar title={series?.bridge ?? bridge ?? ''} />

      {error ? (
        scrollFallback(<RetryBlock message={error} onRetry={retry} />)
      ) : !series ? (
        // No forwarded cover (deep-link) — nothing to keep steady, so use the
        // full skeleton until the fetch resolves.
        scrollFallback(<SeriesSkeleton actionsWidth={actionsWidth} isLarge={isLarge} title={title} cover={cover} />)
      ) : (
        // `series` is either the placeholder (real hero, rest loading) or the
        // resolved detail. SeriesBody stays mounted across that transition, so
        // the cover never remounts/blanks.
        <SeriesBody
          series={series}
          bridgeId={bridgeId}
          isLarge={isLarge}
          sticky={sticky}
          actionsWidth={actionsWidth}
          direct={direct === '1'}
          width={width}
          initialCover={cover}
          loading={isPlaceholderData}
        />
      )}
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
  initialCover,
  loading,
}: {
  series: SeriesDetail;
  bridgeId?: string;
  isLarge: boolean;
  sticky: boolean;
  actionsWidth: number;
  direct: boolean;
  width: number;
  /** Cover forwarded from browse. When it matches this body's cover, skip the
   *  fade-in so the first paint of the (cache-warm) hero is instant. */
  initialCover?: string;
  /** True while showing placeholder data (real hero known, rest still fetching).
   *  The hero renders for real; the actions + content render as skeletons until
   *  the fetch resolves — all without remounting the persistent cover <Image>. */
  loading?: boolean;
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const mock = useMockActive();
  const queryClient = useQueryClient();

  // Let the native push transition play before mounting the heavy chapter/page
  // grid. On a cache-warm revisit the full list would otherwise render
  // synchronously on the screen's first commit and hold the transition back; the
  // list shows its own skeleton until this flips (see ChaptersSection `loading`).
  const listReady = useDeferredMount();

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

  // Related-series rails: the main query leaves `relatedGroups` unset and flags
  // `relatedGroupsDeferred` when the bridge only serves them via a separate,
  // slower endpoint (see source.ts) — fetch that lazily here so the rest of the
  // page never waits on it, and show a rail skeleton in its place meanwhile.
  const needsRelatedFetch = !!series.relatedGroupsDeferred && !series.relatedGroups;
  const { data: fetchedRelated, isLoading: relatedLoading } = useQuery(
    relatedGroupsQuery(ds, mock, bridgeId ?? '', series.id, needsRelatedFetch),
  );
  const relatedGroups = series.relatedGroups ?? fetchedRelated;

  // Chapter list / page-thumbnail grid: `getSeriesDetail` returns only the fast
  // info payload and flags `listDeferred`, leaving this ~200ms fetch to stream in
  // separately so the hero/meta/description paint immediately (this is what made
  // the page feel slower than comical-web, which for chaptered series blocks its
  // whole body on the /chapters request). The chapter section shows a skeleton
  // meanwhile, and the merged chapters/pageThumbs/count/label below prefer the
  // deferred result but fall back to any inline values (e.g. mock data).
  const listDeferred = !!series.listDeferred;
  const { data: listData, isLoading: listFetching } = useQuery(
    seriesListQuery(ds, mock, bridgeId ?? '', series.id, direct, listDeferred),
  );
  const listLoading = listDeferred && listFetching;
  const chapters = series.chapters ?? listData?.chapters;
  // The scanlation group last opened for this series — so Read (with no resume)
  // starts Chapter 1 of the source the user is reading, not an arbitrary copy.
  const preferredGroup = usePreferredGroup();
  const pageThumbs = series.pageThumbs ?? listData?.pageThumbs;
  const chapterCount = listData?.chapterCount ?? series.chapterCount;
  const readLabel = listData?.readLabel ?? series.readLabel;

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
    // A confirmed write is the source of truth for this series: re-assert `next` so a slow
    // `isFavorite` scrape that resolves after the toggle can't leave the star reverted while the
    // favorite actually landed (the reported "reverts almost instantly" flake).
    onSuccess: (_data, next) => {
      queryClient.setQueryData(favKey, next);
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

  // Library membership: cached per series so the button is warm on revisit. A
  // server/runtime with no library store 404s here → reads as "not in library"
  // (isInLibrary maps 404 → false), so the button stays a best-effort no-op
  // rather than surfacing an error, mirroring the favorite toggle above.
  const libKey = queryKeys.inLibrary(mock, bridgeId ?? '', series.id);
  const { data: inLibraryData } = useQuery({ ...inLibraryQuery(ds, mock, bridgeId ?? '', series.id), retry: false });
  const inLibrary = inLibraryData ?? null; // null while loading (toggle disabled)

  // Author snapshot for the library entry, pulled from the meta grid if present,
  // so the library/history render it without re-hitting the bridge.
  const author = series.meta?.find((m) => m.label === 'AUTHOR')?.value;
  const libMutation = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? ds.addToLibrary(bridgeId!, series.id, {
            title: series.title,
            ...(series.cover ? { thumbnailUrl: series.cover } : {}),
            ...(author ? { author } : {}),
          })
        : ds.removeFromLibrary(bridgeId!, series.id),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: libKey });
      const prev = queryClient.getQueryData<boolean>(libKey);
      queryClient.setQueryData(libKey, next);
      return { prev };
    },
    onError: (_e, _next, ctx) => {
      if (ctx) queryClient.setQueryData(libKey, ctx.prev ?? false);
    },
    onSettled: () => {
      // The Library tab keys its grid on ['library', mock, …] — refresh it so an
      // add/remove here shows up when the user switches back to that tab.
      queryClient.invalidateQueries({ queryKey: ['library', mock] });
    },
  });
  const toggleLibrary = () => {
    if (!bridgeId || inLibrary === null) return;
    libMutation.mutate(!inLibrary);
  };

  // Resume point: if this series has a reading-history entry, the primary Read
  // button should continue from there instead of always restarting at the
  // oldest chapter — same lookup/param shape as the History tab's own Resume
  // action (`app/(tabs)/history.tsx`'s `resume()`).
  const { data: history } = useQuery(historyQuery(ds, mock));
  const resumeEntry = history?.find((h) => h.bridgeId === bridgeId && h.seriesId === series.id);

  // Cover image + optional chapter-count badge — shared between layouts.
  const coverEl = (
    <View style={isLarge ? styles.coverWrapLarge : styles.coverWrap}>
      <Image
        source={{ uri: series.cover }}
        style={isLarge ? styles.coverLarge : styles.cover}
        contentFit="cover"
        cachePolicy="memory-disk"
        // The skeleton already painted this exact cover — fading it in again on the
        // skeleton→body swap makes it flash. Skip the fade when it matches; keep the
        // 200ms fade for a cold load (deep-link, or a bridge whose detail cover
        // differs from the browse thumbnail).
        transition={initialCover && initialCover === series.cover ? 0 : 200}
      />
      {chapterCount != null && (
        <View style={styles.coverBadge}>
          <ThemedText style={styles.coverBadgeText}>{chapterCount}</ThemedText>
        </View>
      )}
    </View>
  );

  // Placeholder actions/content shown while `loading` (real hero already up).
  // Kept in sync with SeriesSkeleton's pieces — same styles, same shapes — so the
  // only thing that changes when data lands is the content, not the layout.
  const actionsSkel = (
    <View style={[styles.actions, !isLarge && { width: actionsWidth }]}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} style={styles.skelButton} />
      ))}
    </View>
  );
  const contentSkel = (
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

  // Action buttons — shared between layouts; width controlled by parent.
  const actionsEl = (
    <View style={[styles.actions, !isLarge && { width: actionsWidth }]}>
      <ActionButton
        label={readLabel ?? '▶  Read'}
        variant="primary"
        // A chaptered series needs its (deferred) chapter list to know which chapter
        // to open — disable Read until it lands. Direct series read from page 0, and
        // a resume entry carries its own chapter, so both stay enabled immediately.
        disabled={!direct && !resumeEntry && listLoading}
        onPress={() => {
          if (resumeEntry) {
            const isDirect = resumeEntry.chapterId === DIRECT_CHAPTER_ID || !resumeEntry.chapterId;
            const params: Record<string, string> = {
              seed: series.id,
              title: series.title,
              start: String(resumeEntry.lastPage ?? 0),
            };
            if (bridgeId) params.bridgeId = bridgeId;
            if (!isDirect) {
              params.chapterId = resumeEntry.chapterId!;
              params.chapterName = resumeEntry.chapterName ?? '';
            } else if (direct) {
              params.direct = '1';
            }
            router.push({ pathname: '/reader', params });
            return;
          }
          const params: Record<string, string> = {
            seed: series.id,
            title: series.title,
            start: '0',
          };
          if (bridgeId) params.bridgeId = bridgeId;
          if (direct) params.direct = '1';
          else if (chapters?.length) {
            // Start at the first chapter in reading order (by number), preferring the
            // user's scanlation group — not the raw array's last element.
            const first = firstChapterInReadingOrder(chapters, preferredGroup);
            if (first) {
              params.chapterId = first.id;
              params.chapterName = first.name;
            }
          }
          router.push({ pathname: '/reader', params });
        }}
      />
      <ActionButton label={inLibrary ? '✓  In Library' : '＋  Library'} onPress={toggleLibrary} />
      {series.hasSources && <ActionButton label="Sources" caret />}
      {series.hasTrackers && <TrackerButton seriesId={series.id} initialLinks={series.trackers ?? []} />}
      <ActionButton
        label={favorited ? '★  Favorited' : '☆  Favorite'}
        onPress={toggleFavorite}
        disabled={favorited === null}
      />
      {series.newCount != null && <NewBadge count={series.newCount} />}
    </View>
  );

  // Tapping a tag chip drops the Browse tab into a matching search, mirroring
  // comical-web's tag chips (app.ts): a `tagQueries` entry runs a free-text
  // search; a `tagIds` entry selects the bridge's tag-multiselect filter (keyed
  // "tag" by convention). We hand the intent to Browse via the
  // shared store and jump to that tab. No-op without a real bridge id (mock).
  //
  // `dismissTo` (not `navigate`/`push`) targets the Browse tab's route ('/'),
  // dismissing this pushed Series screen and returning to the existing Browse
  // instance instead of stacking a fresh one on top (which is what `navigate`
  // did: from a screen pushed outside the tab group it can't tell the tab is
  // already there, so it pushes a duplicate rather than returning to it). This
  // holds no matter which tab the series was opened from (Browse, Library,
  // History, …) — '/' resolves to the index tab, so dismissTo switches to it.
  // Browse then applies the stashed intent on focus and forces its page to Home
  // (see the focus effect in `(tabs)/index.tsx`), so a tag/meta search always
  // lands on Browse › Home regardless of the originating tab.
  const onTagPress = (group: TagGroup, index: number) => {
    if (!bridgeId) return;
    const query = group.tagQueries?.[index];
    const tagId = group.tagIds?.[index];
    if (query) {
      setBrowseIntent({ bridgeName: series.bridge, kind: 'query', query });
    } else if (tagId) {
      setBrowseIntent({ bridgeName: series.bridge, kind: 'tag', filterKey: 'tag', tagId, label: group.tags[index] });
    } else {
      return;
    }
    router.dismissTo('/');
  };

  // Same idea for the Author/Artist/Type meta cells: Browse will try to route
  // the value into the matching filter field, falling back to a free-text
  // search if the bridge has no such filter.
  const onMetaPress = (metaKey: 'author' | 'artist' | 'type', value: string) => {
    if (!bridgeId) return;
    setBrowseIntent({ bridgeName: series.bridge, kind: 'meta', metaKey, value });
    router.dismissTo('/');
  };

  // Metadata, description, and chapters — placed in the right column (large)
  // or stacked below the hero row (small).
  const contentEl = (
    <>
      {series.genres?.length || series.tagGroups?.length ? (
        <View style={styles.tagsBlock}>
          {series.genres?.length ? <ChipRow labels={series.genres} /> : null}
          {series.tagGroups?.map((g) => (
            <TagGroupRow key={g.label} group={g} onTagPress={(i) => onTagPress(g, i)} />
          ))}
        </View>
      ) : null}

      {series.meta?.length ? (
        <View style={[styles.metaGrid, { borderColor: theme.hairline }]}>
          {series.meta.map((m) => {
            const metaKey = SEARCHABLE_META_KEYS[m.label];
            const cellContent = (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.metaLabel}>
                  {m.label}
                </ThemedText>
                <ThemedText type="small">{m.value}</ThemedText>
              </>
            );
            return metaKey && bridgeId ? (
              <Pressable
                key={m.label}
                onPress={() => onMetaPress(metaKey, m.value)}
                accessibilityRole="button"
                accessibilityLabel={`Search ${m.value}`}
                style={({ pressed }) => [styles.metaCell, pressed && styles.metaCellPressed]}>
                {cellContent}
              </Pressable>
            ) : (
              <View key={m.label} style={styles.metaCell}>
                {cellContent}
              </View>
            );
          })}
        </View>
      ) : null}

      {series.description ? (
        <ThemedText themeColor="textSecondary" style={styles.description}>
          {series.description}
        </ThemedText>
      ) : null}

      {/* Chapters live with the metadata (right column on large screens). Direct
          series have no chapters — their page-thumbnail grid is the screen's own
          virtualized scroller instead (see `PageThumbList` in the return). */}
      {!direct && (
        <ChaptersSection
          chapters={chapters}
          loading={listLoading || !listReady}
          seed={series.id}
          title={series.title}
          bridgeId={bridgeId}
        />
      )}
    </>
  );

  const insets = useSafeAreaInsets();
  // The web-only sticky cover column is a chaptered-ScrollView affordance — a
  // direct series' hero lives inside the page list's header, where position:sticky
  // doesn't apply, so don't ask for it there.
  const heroSticky = sticky && !direct;

  // Hero + metadata (+ chapters, for chaptered series). Shared by both layouts
  // below: the chaptered ScrollView renders it in a padded `inner`; the direct
  // page list renders it as its (unpadded — the list content-container insets)
  // header.
  const heroBlock = (
    <>
      <ThemedText type="subtitle" style={styles.title}>
        {series.title}
      </ThemedText>

      {isLarge ? (
        /* Large screen: two-column layout — cover+actions left, content right. */
        <View style={styles.twoCol}>
          <View style={[styles.leftCol, heroSticky && styles.leftColSticky]}>
            {coverEl}
            {loading ? actionsSkel : actionsEl}
          </View>
          <View style={styles.rightCol}>{loading ? contentSkel : contentEl}</View>
        </View>
      ) : (
        /* Small screen: hero row then content stacked below. */
        <>
          <View style={styles.hero}>
            {coverEl}
            {loading ? actionsSkel : actionsEl}
          </View>
          {loading ? contentSkel : contentEl}
        </>
      )}
    </>
  );

  // Related rails (per-bridge): a bridge may surface any number of labeled
  // groups (sequels, similar, …). Full-bleed to the capped column.
  const relatedRailsEl = relatedGroups?.length ? (
    <View style={styles.related}>
      {relatedGroups.map(
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
  ) : needsRelatedFetch && relatedLoading ? (
    <View style={styles.related}>
      <RailSkeleton viewportWidth={width} />
    </View>
  ) : null;

  // Direct series: the page-thumbnail grid IS the scroll container — a
  // virtualized, recycling LegendList with the hero/meta as its header and the
  // rails as its footer, so a huge page set stays cheap. Chaptered series keep
  // the plain ScrollView (chapters in the two-column layout + web sticky cover).
  if (direct) {
    return (
      <PageThumbList
        thumbs={pageThumbs ?? []}
        loading={loading || listLoading || !listReady}
        seed={series.id}
        title={series.title}
        bridgeId={bridgeId}
        header={<View style={styles.innerNoPad}>{heroBlock}</View>}
        footer={relatedRailsEl}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.five }]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.column}>
        <View style={styles.inner}>{heroBlock}</View>
        {relatedRailsEl}
      </View>
    </ScrollView>
  );
}

/** Loading placeholder that mirrors the series layout while the detail fetch is
 *  in flight. Matches both the small-screen and large-screen layouts. When the
 *  browse card forwards the `title` and `cover` it already had, those paint for
 *  real (the cover straight from expo-image's cache, warmed by the grid) while
 *  the rest still shimmers — so the page feels immediate instead of blank, then
 *  swaps seamlessly to `SeriesBody` (same cover URI + slot) once data resolves.
 *  This is comical-app's equivalent of comical-web's SW-cached instant cover. */
function SeriesSkeleton({
  actionsWidth,
  isLarge,
  title,
  cover,
}: {
  actionsWidth: number;
  isLarge: boolean;
  title?: string;
  cover?: string;
}) {
  const actionSkels = Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} style={styles.skelButton} />
  ));

  const coverSkel = (
    <View style={isLarge ? styles.coverWrapLarge : styles.coverWrap}>
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={isLarge ? styles.coverLarge : styles.cover}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
        />
      ) : (
        <Skeleton style={isLarge ? styles.coverLarge : styles.cover} />
      )}
    </View>
  );

  const titleEl = title ? (
    <ThemedText type="subtitle" style={styles.title}>
      {title}
    </ThemedText>
  ) : (
    <View style={styles.skelTitle}>
      <Skeleton style={[styles.skelLine, { width: '85%', height: 26 }]} />
      <Skeleton style={[styles.skelLine, { width: '55%', height: 26 }]} />
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
      {titleEl}

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
  // Same as `inner` but without the horizontal padding — used as the direct-series
  // page list's header, where the LegendList content-container supplies the inset.
  innerNoPad: {
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
    boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.5)',
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
  metaCellPressed: {
    opacity: 0.6,
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
