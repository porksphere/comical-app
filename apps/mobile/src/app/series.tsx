import { useQuery } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TagGroupRow } from '@/components/chip';
import { Rail, RailSkeleton } from '@/components/rail';
import { RetryBlock } from '@/components/retry-block';
import { ActionButton, NewBadge } from '@/components/series/action-button';
import { SeriesDownloadButton } from '@/components/series/download-button';
import { ChapterScrollList, PageThumbList } from '@/components/series/chapters-section';
import { TrackerButton } from '@/components/series/tracker-panel';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { relativeTime } from '@/data/mock';
import { setSearchIntent, tagSearchIntent } from '@/data/search-intent';
import { queryKeys, relatedGroupsQuery, seriesDetailQuery, seriesListQuery } from '@/data/queries';
import { queryClient } from '@/data/query-client';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { PullIndicator } from '@/components/pull-indicator';
import { useDataSource, useMockActive } from '@/data/source';
import { ASPECT_TRANSITION_MS, DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { resetPreferredGroup } from '@/lib/preferred-group';
import { tagPaletteFor } from '@/lib/tag-colors';
import { testId } from '@/lib/test-id';
import { type Chapter, type SeriesDetail, type TagGroup } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { useFavorite } from '@/hooks/use-favorite';
import { useHovered } from '@/hooks/use-hovered';
import { openListPicker } from '@/components/list-picker';
import { useLibrary } from '@/hooks/use-library';
import { useStartReading } from '@/hooks/use-start-reading';
import { LARGE_SCREEN_BREAKPOINT } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';

const LARGE_COVER_WIDTH = 300;

/** Faithful hero aspect (width/height): the details page honours the cover's REAL shape — landscape
 *  and taller-than-2:3 alike — width-constrained, with height following. Unlike `clampThumbAspect`
 *  (grid cards, which floor at 2:3 so a slot never grows), this only bounds pathological images so
 *  a stray banner can't blow the layout up. */
function clampHeroAspect(ratio?: number | null): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return DEFAULT_THUMB_ASPECT;
  return Math.min(2.5, Math.max(0.5, ratio));
}

/** The hero cover's box: width fills its wrap, height follows the animated aspect. Mounts AT the
 *  current aspect (no mount animation — the skeleton⇄body swap must not replay the resize) and
 *  eases to a new one over `ASPECT_TRANSITION_MS`, matching the cards' box-settle. The box clips
 *  and rounds; the child image/skeleton just fills it. */
function SeriesCoverBox({ aspect, children }: { aspect: number; children: ReactNode }) {
  const aspectSV = useSharedValue(aspect);
  useEffect(() => {
    aspectSV.set(withTiming(aspect, { duration: ASPECT_TRANSITION_MS }));
  }, [aspect, aspectSV]);
  const boxStyle = useAnimatedStyle(() => ({ aspectRatio: aspectSV.value }));
  return <Animated.View style={[styles.coverBox, boxStyle]}>{children}</Animated.View>;
}

// Conservative cap on the top bar's "<Bridge> / <Title>" title portion — some
// series titles run extremely long, and letting the bar's own `numberOfLines={1}`
// truncate the combined string could clip the bridge name off the front entirely.
const TOP_BAR_TITLE_MAX_CHARS = 40;

function truncateTopBarTitle(t: string): string {
  return t.length > TOP_BAR_TITLE_MAX_CHARS ? `${t.slice(0, TOP_BAR_TITLE_MAX_CHARS).trimEnd()}…` : t;
}

/** Meta cells whose value should open a matching search, keyed by the
 *  cell's `label` (see `buildMeta` in `data/source.ts`) to the `SearchIntent`
 *  meta key it maps to. STATUS is left static — a lifecycle value like
 *  "Ongoing" isn't a meaningful search term the way an author/artist/type is. */
const SEARCHABLE_META_KEYS: Record<string, 'author' | 'artist' | 'type' | undefined> = {
  AUTHOR: 'author',
  ARTIST: 'artist',
  TYPE: 'type',
};

/** One searchable meta-grid cell (Author/Artist/Type). Its own component so it
 *  can call `useHovered` — the grid renders cells from a `.map`, where a hook
 *  can't be called directly (same reasoning as chip.tsx's `PressableChip`).
 *  A full-cell background brighten read as a big flat rectangle bleeding into
 *  the grid's own top/bottom hairlines, so hover here instead behaves like a
 *  text link — just the value turning accent-blue, not a block. */
function MetaCell({
  onPress,
  metaLabel,
  value,
  testID,
}: {
  onPress: () => void;
  metaLabel: string;
  value: string;
  testID: string;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={`Search ${value}`}
      style={({ pressed }) => [styles.metaCell, pressed && styles.metaCellPressed]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.metaLabel}>
        {metaLabel}
      </ThemedText>
      <ThemedText type="small" style={hovered && { color: theme.accent }}>
        {value}
      </ThemedText>
    </Pressable>
  );
}

export default function SeriesScreen() {
  const ds = useDataSource();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
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
    isFetching,
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

  // Pull-to-refresh for the series scroller (the same house overlay spinner Browse/Search use — see
  // usePullToRefresh). The body's LegendList (ChapterScrollList or PageThumbList) owns the scroll, so
  // this screen owns the shared scroll offset + the spinner and threads `sharedValues` /
  // `onScrollEndDrag` / the content-shift `wrapperStyle` down through SeriesBody to whichever list is
  // mounted. A pull re-attempts the live fetch for THIS series — which is also the manual escape hatch
  // for a stuck "Offline — showing saved details" entry (the embedded runtime served the library's
  // cached detail because the live fetch failed); refetching the detail replaces that cached payload
  // and the pill disappears with it. (The automatic recovery — a `cached` detail is marked
  // always-stale so it re-attempts on its own — lives in seriesDetailQuery; this is the on-demand one.)
  const scrollY = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset: scrollY }), [scrollY]);
  const refreshSeries = useCallback(
    () =>
      // Refetch every mounted query for this exact series (detail, chapter/page list, related rails,
      // favorite, …) — all keyed `[name, mock, bridgeId, seriesId, …]`, so match on the bridge+series
      // slots. `type: 'active'` limits it to what's actually on screen.
      queryClient.refetchQueries({
        type: 'active',
        predicate: (q) => q.queryKey[2] === (bridgeId ?? '') && q.queryKey[3] === (id ?? ''),
      }),
    [bridgeId, id],
  );
  const pull = usePullToRefresh(scrollY, refreshSeries);

  const isLarge = width >= LARGE_SCREEN_BREAKPOINT;
  // Sticky cover column is a web-only, large-screen affordance: as the page
  // scrolls, the left column pins to the top until the chapters end (mirrors the
  // reference's `position: sticky` cover col). Native has no sticky, and on a
  // small screen there's no second column to pin alongside.
  const sticky = isLarge && Platform.OS === 'web';

  // Small-screen hero: the action column takes roughly 40% of the screen so the
  // buttons (e.g. "▶ Chapter 1") read comfortably, and the cover fills the rest.
  // Capped so it doesn't get absurd just below the large-screen breakpoint (768).
  // Only used on small screens.
  const actionsWidth = Math.round(Math.min(width * 0.4, 220));

  // The hero cover's measured aspect, hoisted ABOVE the skeleton⇄body swap so the shape survives
  // that remount instead of snapping back to 2:3 between them. Fed by whichever cover <Image> is
  // currently mounted (skeleton or body — usually the same URI, so they agree).
  const [coverAspect, setCoverAspect] = useState(DEFAULT_THUMB_ASPECT);
  const onCoverLoad = (e: ImageLoadEventData) => {
    const src = e.source;
    if (!src?.width || !src.height) return;
    const next = clampHeroAspect(src.width / src.height);
    // Ignore sub-2% wiggle (a re-encode of the same art) so the box doesn't visibly resettle.
    setCoverAspect((prev) => (Math.abs(next - prev) > 0.02 ? next : prev));
  };

  // Error / deep-link skeleton stay in a plain ScrollView; a resolved SeriesBody
  // owns its own scroll container (a ScrollView for chaptered series, a
  // virtualized LegendList for direct/page-thumbnail series — see SeriesBody).
  const scrollFallback = (child: ReactNode) => (
    <ScrollView
      // The TopBar overlays the screen, so content pads past it and scrolls under its frost.
      contentContainerStyle={[styles.scroll, { paddingTop: topBarInset + BarContentGap, paddingBottom: insets.bottom + Spacing.five }]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.column}>{child}</View>
    </ScrollView>
  );

  const topBarSeriesTitle = series?.title ?? title;
  const topBarBridge = series?.bridge ?? bridge;
  const topBarTitle = topBarSeriesTitle
    ? topBarBridge
      ? `${topBarBridge} / ${truncateTopBarTitle(topBarSeriesTitle)}`
      : truncateTopBarTitle(topBarSeriesTitle)
    : (topBarBridge ?? '');

  return (
    <ThemedView
      style={styles.container}
      // Touch-driven pull for web + Android (caught here so it works regardless of what's under the
      // finger); empty on iOS, which sources its pull from the native bounce (see usePullToRefresh).
      {...pull.touchHandlers}>
      <TopBar title={topBarTitle} />

      {/* Served from the library's offline metadata cache — a floating, non-blocking pill under the
          top bar. Derived from the payload itself (never a connectivity probe): a live refetch
          replaces the cached payload and the pill disappears with it. */}
      {series?.cached && <OfflineDetailsPill cachedAt={series.cachedAt} topBarInset={topBarInset} />}

      {error ? (
        scrollFallback(<RetryBlock message={error} onRetry={retry} />)
      ) : !series ? (
        // No forwarded cover (deep-link) — nothing to keep steady, so use the
        // full skeleton until the fetch resolves.
        scrollFallback(
          <SeriesSkeleton
            actionsWidth={actionsWidth}
            isLarge={isLarge}
            title={title}
            cover={cover}
            coverAspect={coverAspect}
            onCoverLoad={onCoverLoad}
          />,
        )
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
          // The chapters fetch may start as soon as the detail request is IN FLIGHT (not once it
          // resolves) — this is true while background-fetching the placeholder (isFetching) and after
          // the real detail lands (!isPlaceholderData). Because this only flips true AFTER the detail
          // query's own fetch has begun (fetchStatus turns 'fetching' in an effect, a commit later),
          // the detail request is always enqueued at the rate limiter first — chapters never jump
          // ahead of it. See seriesListQuery `enabled` in SeriesBody.
          detailStarted={isFetching || !isPlaceholderData}
          coverAspect={coverAspect}
          onCoverLoad={onCoverLoad}
          sharedValues={sharedValues}
          onScrollEndDrag={pull.onScrollEndDrag}
          wrapperStyle={pull.listStyle}
        />
      )}
      {/* The house pull-to-refresh spinner — sits under the top bar, above the scroller. */}
      <PullIndicator {...pull.indicator} top={topBarInset} />
    </ThemedView>
  );
}

/** Two-column (large) / stacked (small) series detail — only rendered once the
 *  real (or mock) fetch has resolved, so it never has to handle a null series.
 *
 *  Exported: the experimental series-reader page (`app/series-reader.tsx`) renders this exact
 *  component as its details panel, so the two screens can never drift apart. The `topInset` /
 *  `onStartReading` / `onOpenChapter` / `onOpenPage` props exist for that embedding and default
 *  to this screen's behavior. */
export function SeriesBody({
  series,
  bridgeId,
  isLarge,
  sticky,
  actionsWidth,
  direct,
  width,
  initialCover,
  loading,
  detailStarted,
  coverAspect,
  onCoverLoad,
  topInset,
  onStartReading,
  onOpenChapter,
  onOpenPage,
  sharedValues,
  onScrollEndDrag,
  onScrollBeginDrag,
  wrapperStyle,
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
  /** The detail request has begun (see SeriesScreen). Gates the chapters/pages fetch so it fires as
   *  soon as detail is in flight — not only once detail resolves — while still, by construction,
   *  being enqueued after the detail request. */
  detailStarted: boolean;
  /** The hero cover's live aspect + its measurer — owned by SeriesScreen (see there). */
  coverAspect: number;
  onCoverLoad: (e: ImageLoadEventData) => void;
  /** Top inset for the owning scroller — defaults to this screen's overlaying TopBar height.
   *  The series-reader embedding passes its own (its details card has no top bar). */
  topInset?: number;
  /** Replaces the Read button / cover tap's "open `/reader` at the resume point" — the
   *  series-reader embedding returns to its own in-place reader instead. */
  onStartReading?: () => void;
  /** See ChapterScrollList / PageThumbList: hand a tapped chapter version / page thumbnail to the
   *  caller's in-place reader instead of pushing `/reader`. */
  onOpenChapter?: (version: Chapter) => void;
  onOpenPage?: (pageIndex: number) => void;
  /** Pull-to-refresh wiring owned by SeriesScreen, threaded to whichever list owns the scroll. */
  sharedValues?: { scrollOffset: SharedValue<number> };
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  wrapperStyle?: Parameters<typeof Animated.View>[0]['style'];
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const mock = useMockActive();

  // Trackers are bridge-agnostic (unlike `hasSources`, which the bridge itself reports per
  // series), so whether the Trackers button renders comes from the same `/trackers` query the
  // Settings screen uses, not a per-series flag: `undefined` while loading (button withheld
  // rather than flashing in), `null` when this server has no TrackerManager mounted at all.
  const { data: trackers } = useQuery({ queryKey: queryKeys.trackers(), queryFn: ({ signal }) => ds.getTrackers(signal) });

  // Let the native push transition play before mounting the heavy chapter/page
  // grid. On a cache-warm revisit the full list would otherwise render
  // synchronously on the screen's first commit and hold the transition back; the
  // list shows its own skeleton until this flips (see ChaptersSection `loading`).
  const listReady = useDeferredMount();

  // Favorite state + optimistic toggle — shared hook so the Series screen and the reader's settings
  // panel stay in lockstep (see useFavorite). `favorited` is null while loading (button disabled),
  // false on an unsupported/errored check (the star stays unfilled).
  const { favorited, toggle: toggleFavorite, available: favoritesAvailable } = useFavorite(bridgeId, series.id);

  // Related-series rails: the main query leaves `relatedGroups` unset and flags
  // `relatedGroupsDeferred` when the bridge only serves them via a separate,
  // slower endpoint (see source.ts) — fetch that lazily here so the rest of the
  // page never waits on it, and show a rail skeleton in its place meanwhile.
  //
  // But `relatedGroupsDeferred` is set whenever the detail simply lacked inline
  // related groups, which can't distinguish "deferred to /related" from "this
  // bridge has none at all" — so gate the lazy fetch (and its rail skeleton) on
  // the bridge actually advertising the "related-series" capability. Without
  // this, a direct source with no related rails still showed a rail skeleton
  // footer, which made `PageThumbList` collapse the page grid
  // behind "Show all" for nothing — the page thumbnails past the first
  // `cols * COLLAPSED_ROWS` (20 on wide screens) appeared cut off.
  const { byId: bridgeById } = useBridgeMap();
  const relatedCapable = bridgeId
    ? (bridgeById.get(bridgeId)?.capabilities.includes('related-series') ?? false)
    : false;
  const needsRelatedFetch = relatedCapable && !!series.relatedGroupsDeferred && !series.relatedGroups;
  const { data: fetchedRelated, isLoading: relatedLoading } = useQuery(
    relatedGroupsQuery(ds, mock, bridgeId ?? '', series.id, needsRelatedFetch),
  );
  const relatedGroups = series.relatedGroups ?? fetchedRelated;

  // Chapter list / page-thumbnail grid: `getSeriesDetail` returns only the fast info payload and
  // defers this fetch so the hero/meta/description paint immediately (this is what made the page feel
  // slower than comical-web, which blocked its whole body on the /chapters request). The chapter
  // section shows a skeleton meanwhile. The list comes only from this fetch (both real and mock defer
  // it); count/label still fall back to any inline detail value a direct series carries.
  //
  // Gated on `detailStarted` rather than the resolved detail's `listDeferred`, so it fires the moment
  // the detail request is IN FLIGHT instead of waiting for it to fully resolve. Under the bridge's
  // serial rate limit (maxConcurrent 1) the detail request is still admitted first — `detailStarted`
  // only turns true a commit AFTER detail begins fetching — so chapters never delay detail; they just
  // stop idling behind detail's resolve on a slow link. `series.id` is the real id even on the
  // placeholder, and `direct` comes from the route, so nothing here needs the resolved detail.
  const { data: listData, isLoading: listFetching } = useQuery(
    seriesListQuery(ds, mock, bridgeId ?? '', series.id, direct, detailStarted),
  );
  const listLoading = detailStarted && listFetching;
  const chapters = listData?.chapters;
  const pageThumbs = listData?.pageThumbs;
  const chapterCount = listData?.chapterCount ?? series.chapterCount;
  const readLabel = listData?.readLabel ?? series.readLabel;

  // Author snapshot for the library entry, pulled from the meta grid if present, so the
  // library/history render it without re-hitting the bridge.
  const author = series.meta?.find((m) => m.label === 'AUTHOR')?.value;
  // Library membership + optimistic toggle — shared hook (see useLibrary). The ADD snapshot is built
  // lazily from the loaded detail (title/cover/author).
  const { inLibrary, toggle: toggleLibrary } = useLibrary(bridgeId, series.id, () => ({
    title: series.title,
    ...(series.cover ? { thumbnailUrl: series.cover } : {}),
    ...(author ? { author } : {}),
  }));

  // Resume point + the push that opens it — shared with the card long-press menu's Read row, so the
  // two can't resume at different places (see useStartReading).
  // Read no longer waits on the deferred chapter list: with no resume point it hands the reader an
  // unspecified chapter and the reader picks the first one itself, so the button is live immediately.
  const {
    label: readingLabel,
    resume: resumeEntry,
    start: startReadingDefault,
  } = useStartReading({
    bridgeId,
    seriesId: series.id,
    title: series.title,
    direct,
    readLabel,
  });
  // The series-reader embedding swaps the push-to-/reader for a return to its in-place reader
  // (which resolved the same resume point itself); this screen keeps the default.
  const startReading = onStartReading ?? startReadingDefault;
  // The play glyph leads a RESUME (and the bare "Read" fallback); a bridge's own readLabel is shown
  // as it comes.
  const primaryLabel = !resumeEntry && readLabel ? readLabel : `▶  ${readingLabel}`;

  // Some bridges hand back a Referer-gated, server-relative `/img-proxy?…` cover that
  // `<Image>` can't load raw — resolve it the same way the browse card and the loading
  // skeleton do (absolute CDN covers pass straight through, no async work). Without this
  // the detail hero rendered blank even though the browse thumbnail showed fine.
  const resolvedCover = useResolvedAsset(series.cover);

  // Cover image + optional chapter-count badge — shared between layouts. Tapping
  // it starts reading, same as the primary Read button.
  const coverEl = (
    <Pressable
      testID="series.cover"
      style={isLarge ? styles.coverWrapLarge : styles.coverWrap}
      onPress={startReading}
      accessibilityRole="button"
      accessibilityLabel={primaryLabel}>
      <SeriesCoverBox aspect={coverAspect}>
        {resolvedCover ? (
          <Image
            source={{ uri: resolvedCover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            // The skeleton already painted this exact cover — fading it in again on the
            // skeleton→body swap makes it flash. Skip the fade when it matches; keep the
            // 200ms fade for a cold load (deep-link, or a bridge whose detail cover
            // differs from the browse thumbnail). Raw comparison: resolution is
            // deterministic and its cache is warm from the skeleton, so equal raw values
            // still mean "same cover already painted".
            transition={initialCover && initialCover === series.cover ? 0 : 200}
            onLoad={onCoverLoad}
          />
        ) : (
          // Brief window while a server-relative cover resolves (absolute covers seed
          // synchronously and never hit this).
          <Skeleton style={StyleSheet.absoluteFill} />
        )}
      </SeriesCoverBox>
      {chapterCount != null && (
        <View style={styles.coverBadge}>
          <ThemedText style={styles.coverBadgeText}>{chapterCount}</ThemedText>
        </View>
      )}
    </Pressable>
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
        testID="series.action.read"
        label={primaryLabel}
        variant="primary"
        onPress={startReading}
      />
      <ActionButton testID="series.action.library" label={inLibrary ? '✓  In Library' : '＋  Library'} onPress={toggleLibrary} />
      {bridgeId && (
        <SeriesDownloadButton
          bridgeId={bridgeId}
          seriesId={series.id}
          direct={direct}
          title={series.title}
          cover={series.cover}
          {...(chapters !== undefined && { chapters })}
        />
      )}
      <ActionButton
        testID="series.action.favorite"
        label={favorited ? '★  Favorited' : '☆  Favorite'}
        onPress={toggleFavorite}
        // Greyed when the bridge's favorites need a login the user hasn't set (see useFavorite) — as
        // well as while the initial status check loads.
        disabled={!favoritesAvailable || favorited === null}
      />
      {series.hasSources && <ActionButton testID="series.action.sources" label="Sources" caret />}
      {/* List + tracker sit at the bottom of the column: they're the "where does this
          series belong" actions, below the ones that act on the series itself. */}
      {bridgeId && (
        <ActionButton
          testID="series.action.lists"
          label="Add to list"
          caret
          onPress={() =>
            openListPicker({
              bridgeId,
              seriesId: series.id,
              title: series.title,
              snapshot: () => ({
                title: series.title,
                ...(series.cover ? { thumbnailUrl: series.cover } : {}),
                ...(author ? { author } : {}),
              }),
            })
          }
        />
      )}
      {Array.isArray(trackers) && trackers.length > 0 && bridgeId && (
        <TrackerButton bridgeId={bridgeId} seriesId={series.id} />
      )}
      {series.newCount != null && <NewBadge count={series.newCount} />}
    </View>
  );

  // Tapping a tag chip drops the Browse tab into a matching search, mirroring
  // comical-web's tag chips (app.ts): a `tagQueries` entry runs a free-text
  // search; a `tagIds` entry selects the bridge's tag-multiselect filter (keyed
  // "tag" by convention). We hand the intent to the Search screen via the shared
  // store and push it. No-op without a real bridge id (mock).
  //
  // `push('/search')` overlays the Search screen on top of this pushed Series
  // screen, so its back arrow returns here. Search consumes the stashed intent on
  // mount (see search.tsx) and applies it against the intent's bridge.
  const onTagPress = (group: TagGroup, index: number) => {
    if (!bridgeId) return;
    const intent = tagSearchIntent(group, index, { bridgeId });
    if (!intent) return;
    setSearchIntent(intent);
    router.push('/search');
  };

  // Same idea for the Author/Artist/Type meta cells: Search will try to route the
  // value into the matching filter field, falling back to a free-text search if
  // the bridge has no such filter.
  const onMetaPress = (metaKey: 'author' | 'artist' | 'type', value: string) => {
    if (!bridgeId) return;
    setSearchIntent({ bridgeId, kind: 'meta', metaKey, value });
    router.push('/search');
  };

  // One colour per tag group, computed over the whole list at once (a group's hue depends on the
  // others it shares this series with — see tagPaletteFor). The card popup gives these same tags the
  // same colours when it folds the groups into a single row, so these labelled rows read as its
  // legend.
  const tagColors = tagPaletteFor(series.tagGroups?.map((g) => g.label) ?? [], scheme);

  // Metadata, description, and chapters — placed in the right column (large)
  // or stacked below the hero row (small).
  const contentEl = (
    <>
      {series.tagGroups?.length ? (
        <View style={styles.tagsBlock}>
          {/* Genres are just the `kind: "genre"` group here — one path renders every taxonomy.
              Keyed by index, not `g.label` — a bridge can repeat a group label, and two siblings on
              the same key is a duplicate-key error (same reasoning as chip.tsx's `chipKey`). */}
          {series.tagGroups.map((g, gi) => (
            <TagGroupRow
              key={`${gi}:${g.label}`}
              group={g}
              color={tagColors[gi]!}
              onTagPress={(i) => onTagPress(g, i)}
            />
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
              <MetaCell
                key={m.label}
                testID={testId('series.meta', m.label)}
                onPress={() => onMetaPress(metaKey, m.value)}
                metaLabel={m.label}
                value={m.value}
              />
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
    </>
  );
  // `contentEl` above is now just tags + meta + description (no chapters). For chaptered series the
  // chapter list is the screen's own virtualized scroller (`ChapterScrollList` below), which takes
  // this block as its header; direct series render `contentEl` inside the page-thumb list header.

  const defaultTopInset = useTopBarInset();
  const topBarInset = topInset ?? defaultTopInset;
  // The web-only sticky cover column is a two-column-hero affordance — a direct series' hero lives
  // inside the page list's header, where position:sticky doesn't apply, so don't ask for it there.
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
  // rails as its footer, so a huge page set stays cheap.
  if (direct) {
    return (
      <PageThumbList
        topInset={topBarInset}
        thumbs={pageThumbs ?? []}
        loading={loading || listLoading || !listReady}
        seed={series.id}
        title={series.title}
        bridgeId={bridgeId}
        header={<View style={styles.innerNoPad}>{heroBlock}</View>}
        footer={relatedRailsEl}
        onOpenPage={onOpenPage}
        sharedValues={sharedValues}
        onScrollEndDrag={onScrollEndDrag}
        onScrollBeginDrag={onScrollBeginDrag}
        wrapperStyle={wrapperStyle}
      />
    );
  }

  // Chaptered series: the chapter list IS the scroll container (ChapterScrollList), virtualized so a
  // 250-chapter series never mounts every row at once. The hero is the list header, the chapter rows
  // are full-width list items below it, and the rails are the full-width footer. On a large screen the
  // hero is a two-column block (cover+actions | meta/description); the chapters and rails sit
  // full-width beneath it, so they stay virtualized AND the rails span the whole column. On small
  // screens the hero stacks (cover row, then meta). ChapterScrollList renders the title itself.
  const chapterHeader = isLarge ? (
    <View style={styles.twoCol}>
      <View style={styles.leftCol}>
        {coverEl}
        {loading ? actionsSkel : actionsEl}
      </View>
      <View style={styles.rightCol}>{loading ? contentSkel : contentEl}</View>
    </View>
  ) : (
    <>
      <View style={styles.hero}>
        {coverEl}
        {loading ? actionsSkel : actionsEl}
      </View>
      {loading ? contentSkel : contentEl}
    </>
  );

  return (
    <ChapterScrollList
      chapters={chapters}
      loading={listLoading || !listReady}
      seed={series.id}
      title={series.title}
      bridgeId={bridgeId}
      offline={series.cached === true}
      header={chapterHeader}
      footer={relatedRailsEl}
      isLarge={isLarge}
      topInset={topBarInset}
      onOpenChapter={onOpenChapter}
      sharedValues={sharedValues}
      onScrollEndDrag={onScrollEndDrag}
      onScrollBeginDrag={onScrollBeginDrag}
      wrapperStyle={wrapperStyle}
    />
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
  coverAspect,
  onCoverLoad,
}: {
  actionsWidth: number;
  isLarge: boolean;
  title?: string;
  cover?: string;
  /** The hero cover's live aspect + its measurer — owned by SeriesScreen (see there). */
  coverAspect: number;
  onCoverLoad: (e: ImageLoadEventData) => void;
}) {
  const resolvedCover = useResolvedAsset(cover);
  const actionSkels = Array.from({ length: 5 }).map((_, i) => (
    <Skeleton key={i} style={styles.skelButton} />
  ));

  const coverSkel = (
    <View style={isLarge ? styles.coverWrapLarge : styles.coverWrap}>
      <SeriesCoverBox aspect={coverAspect}>
        {resolvedCover ? (
          <Image
            source={{ uri: resolvedCover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            onLoad={onCoverLoad}
          />
        ) : (
          <Skeleton style={StyleSheet.absoluteFill} />
        )}
      </SeriesCoverBox>
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

/** Floating "saved details" pill shown when the host answered from the offline metadata cache. */
function OfflineDetailsPill({ cachedAt, topBarInset }: { cachedAt?: number; topBarInset: number }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={[styles.offlinePillWrap, { top: topBarInset + Spacing.two }]}>
      <ThemedView type="backgroundElement" style={[styles.offlinePill, { borderColor: theme.hairline }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Offline — showing saved details{cachedAt ? ` · updated ${relativeTime(cachedAt)}` : ''}
        </ThemedText>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offlinePillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  offlinePill: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    paddingTop: Spacing.four,
    alignItems: 'center',
  },
  column: {
    width: '100%',
    // Match the top-level views (browse grid, library, history) so the two-column
    // hero and the related rails read at one width — the rails' wide-desktop grid
    // sizes its six cards against MaxTopLevelWidth (see rail.tsx), so an 800-cap
    // column let them overflow past the content. Below 768 (mobile/small) this cap
    // never binds — the column is width:100% — so nothing changes there.
    maxWidth: MaxTopLevelWidth,
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
  // The animated cover box (see SeriesCoverBox): width from its wrap, height from the live aspect.
  coverBox: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
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
