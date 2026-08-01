import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TagGroupRow } from '@/components/chip';
import { Rail, RailSkeleton } from '@/components/rail';
import { ChapterNavigator } from '@/components/reader/chapter-navigator';
import { PagedReader, type PagedReaderHandle, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { SettingsControl } from '@/components/reader/settings-panel';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { RetryBlock } from '@/components/retry-block';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { resolveAssetSourceCached } from '@/data/api';
import { directPagesQuery, historyQuery, queryKeys, relatedGroupsQuery, seriesDetailQuery } from '@/data/queries';
import { setSearchIntent, tagSearchIntent } from '@/data/search-intent';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type SeriesDetail, type TagGroup } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useReaderSettings } from '@/hooks/use-reader-settings';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';
import { tagPaletteFor } from '@/lib/tag-colors';

// EXPERIMENTAL direct-series page (Settings → General → Experimental). A DIRECT (chapterless)
// series opened from a card lands HERE instead of on `/series`: the reader is up immediately —
// same paged/webtoon readers, chrome, scrubber, and progress recording as `/reader` — and the
// series info (tags, meta, description, related rails) sits one scroll away as if the whole thing
// were a single scrollable page, with a snap at the reader↔info boundary so the pages always rest
// fully framed:
//   - paged mode (horizontal reading): the info is BELOW — swipe up to reveal it.
//   - webtoon mode (vertical reading): the info is a panel to the LEFT — swipe right to reveal it.
//
// Deliberately self-contained so removing the experiment is simple: delete this file +
// `lib/experimental-flags.ts`, the Settings row in `settings-general.tsx`, the `buildHref` target
// switch in `series-card.tsx`, and this route's Stack.Screen entry in `_layout.tsx`. The reader
// here is a direct-only sibling of `app/reader.tsx` built from the same shared components
// (PagedReader/WebtoonReader/ReaderToolbar/ChapterNavigator/ProgressPill/SettingsControl) — it
// skips everything chapter-shaped (stitching, next/prev, auto-advance), which is what keeps it
// small enough to live in one file.

const CHROME_HIDE_MS = 3000;
// Same CI-speed override as reader.tsx: Maestro steps can outlast the auto-hide, and hidden chrome
// drops out of the accessibility tree.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';
const WARM_BEHIND = 2;
const IS_WEB = Platform.OS === 'web';
// The reader surface's tone — matches reader.tsx's backdrop (`#reader-view`'s #0f0f0f, not pure black).
const READER_BACKDROP = '#0f0f0f';

// Warm expo-image's cache around the read position — a trimmed copy of reader.tsx's warmPrefetch
// (same dedup memo, same "resolve then prefetch only http(s)" rule; see there for the reasoning).
const warmed = new Set<string>();
const WARM_MEMO_MAX = 2000;
function warmPrefetch(pages: string[]): void {
  const fresh = pages.filter((p) => !warmed.has(p));
  if (!fresh.length) return;
  if (warmed.size > WARM_MEMO_MAX) warmed.clear();
  for (const p of fresh) warmed.add(p);
  void Promise.all(fresh.map((p) => resolveAssetSourceCached(p).catch(() => null))).then((urls) => {
    const http = urls.filter((u): u is string => !!u && !u.startsWith('data:'));
    if (http.length) void Image.prefetch(http);
  });
}

export default function DirectSeriesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const mock = useMockActive();
  const [settings] = useReaderSettings();

  // Same params a series card forwards to `/series` (see series-card.tsx buildHref) — including the
  // percent-encoded bridge name / cover, decoded the same way series.tsx does.
  const { id, title, bridge: bridgeParam, bridgeId, cover: coverParam } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
    bridgeId?: string;
    cover?: string;
  }>();
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;

  // Series detail (title/tags/meta/description/related) — placeholder-seeded from the forwarded
  // title+cover exactly like series.tsx, so the info section has a real title immediately.
  const { data: series = null, isPlaceholderData } = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: true,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
  );

  // The pages ARE the series (direct = chapterless).
  const {
    data: pages = null,
    error: queryError,
    refetch,
  } = useQuery(directPagesQuery(ds, mock, bridgeId ?? '', id ?? ''));
  const error = queryError ? (queryError as Error).message || 'Failed to load pages' : null;

  // Resume point, resolved from the reading history HERE rather than at the card tap (cards render
  // in recycled lists — a history subscription per card would be a scroll cost; see useStartReading
  // for the same reasoning). A direct series records under the DIRECT_CHAPTER_ID sentinel. The
  // reader pane below only mounts once BOTH pages and history are in, and seeds its position from
  // `startIndex` at that mount — later history refetches (our own progress writes invalidate it)
  // change this value without moving the mounted pager.
  const { data: history, isLoading: historyLoading } = useQuery(historyQuery(ds, mock));
  const startIndex = useMemo(() => {
    if (!pages?.length) return 0;
    const resume = history?.find((h) => h.bridgeId === bridgeId && h.seriesId === id);
    const resumeDirect = resume && (resume.chapterId === DIRECT_CHAPTER_ID || !resume.chapterId);
    return Math.max(0, Math.min(pages.length - 1, resumeDirect ? (resume?.lastPage ?? 0) : 0));
  }, [pages, history, bridgeId, id]);
  const readerReady = !!pages && !historyLoading;

  // ── Chrome auto-hide (reader.tsx's scheme, minus the swipe-dismiss guards) ──
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeHeldRef = useRef(false);
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!CHROME_AUTO_HIDE || chromeHeldRef.current) return;
    hideTimer.current = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  }, []);
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);
  const showChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  const holdChrome = useCallback(
    (hold: boolean) => {
      chromeHeldRef.current = hold;
      if (hold) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      } else {
        setChromeVisible(true);
        scheduleHide();
      }
    },
    [scheduleHide],
  );
  const toggleChrome = useCallback(() => {
    setChromeVisible((v) => {
      const nextVisible = !v;
      if (nextVisible) scheduleHide();
      else if (hideTimer.current) clearTimeout(hideTimer.current);
      return nextVisible;
    });
  }, [scheduleHide]);

  // Pinch-zoom suspends the outer reveal scroll so a one-finger drag pans the zoomed page; a scrub
  // drag suspends it so the thumb can't also pull the page off the reader.
  const [readerZoomed, setReaderZoomed] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubActive = useCallback(
    (active: boolean) => {
      setScrubbing(active);
      holdChrome(active);
    },
    [holdChrome],
  );

  // ── Reveal state: which end of the outer scroll we're on (styles the status bar) ──
  const [infoRevealed, setInfoRevealed] = useState(false);
  const scheme = useActiveColorScheme();
  const onOuterScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset } = e.nativeEvent;
      const revealed = settings.mode === 'paged' ? contentOffset.y > height / 2 : contentOffset.x < width / 2;
      setInfoRevealed(revealed);
    },
    [settings.mode, height, width],
  );

  const seriesTitle = series?.title ?? title ?? id ?? 'Reader';
  const author = series?.meta?.find((m) => m.label === 'AUTHOR')?.value;

  // One full-viewport cell: the reader plus its own chrome (toolbar, page scrubber / progress
  // pill). The chrome is absolutely positioned WITHIN the cell, so it travels with the reader when
  // the info is revealed instead of floating over it.
  const readerCell = (
    <View style={[styles.readerCell, { width, height }]}>
      {error ? (
        <View style={styles.centerFill}>
          <RetryBlock message={error} onRetry={refetch} />
        </View>
      ) : !readerReady ? (
        <View style={styles.centerFill}>
          <ThemedText style={styles.loadingText}>Loading…</ThemedText>
        </View>
      ) : (
        <ReaderPane
          pages={pages}
          startIndex={startIndex}
          width={width}
          height={height}
          bridgeId={bridgeId}
          seriesId={id}
          seriesTitle={seriesTitle}
          seriesCover={series?.cover}
          chromeVisible={chromeVisible}
          onToggleChrome={toggleChrome}
          onShowChrome={showChrome}
          onHoldChrome={holdChrome}
          onZoomChange={setReaderZoomed}
          onScrubActive={onScrubActive}
        />
      )}
      {/* Toolbar outside the loaded branch, like reader.tsx: back + settings stay reachable while
          pages are loading or the fetch failed. */}
      <ReaderToolbar
        title={seriesTitle}
        subtitle=""
        visible={chromeVisible}
        onBack={() => router.back()}
        right={
          <SettingsControl
            bridgeId={bridgeId}
            seriesId={id}
            title={seriesTitle}
            thumbnailUrl={series?.cover}
            author={author}
            direct
          />
        }
      />
    </View>
  );

  const info = (
    <InfoSection
      series={series}
      loading={!series || isPlaceholderData}
      fallbackTitle={title}
      bridgeId={bridgeId}
      width={width}
    />
  );

  // Vertical (paged reading): [reader | info below]. `snapToOffsets` puts a snap point at each side
  // of the reader↔info boundary — a partial swipe settles on one or the other so the pages are never
  // left half-framed — while `snapToEnd: false` leaves everything past the boundary free-scrolling,
  // so the info still reads as one continuous page.
  const snapOffsets = useMemo(() => [0, height], [height]);

  return (
    <ThemedView style={styles.container}>
      <StatusBar
        style={infoRevealed ? (scheme === 'dark' ? 'light' : 'dark') : 'light'}
        hidden={!chromeVisible && !infoRevealed}
      />
      {settings.mode === 'paged' ? (
        <ScrollView
          // Keyed by mode: flipping paged↔webtoon in the reader settings swaps the outer axis, and a
          // reused scroller would keep the old axis' offset.
          key="outer-vertical"
          testID="direct-series.scroll"
          snapToOffsets={snapOffsets}
          snapToEnd={false}
          scrollEnabled={!readerZoomed && !scrubbing}
          showsVerticalScrollIndicator={false}
          onScroll={onOuterScroll}
          scrollEventThrottle={32}
          contentInsetAdjustmentBehavior="never">
          {readerCell}
          {info}
        </ScrollView>
      ) : (
        // Horizontal (webtoon reading): [info | reader], starting on the reader — swiping right
        // reveals the info panel to the left. Two exactly-viewport pages, so plain paging IS the snap.
        <HorizontalReveal width={width} onScroll={onOuterScroll} scrollEnabled={!readerZoomed}>
          <View style={[styles.infoPanel, { width, height }]}>
            <ScrollView showsVerticalScrollIndicator={false}>{info}</ScrollView>
          </View>
          {readerCell}
        </HorizontalReveal>
      )}
    </ThemedView>
  );
}

/** The reader itself + its bottom chrome, mounted only once pages AND the reading history are in —
 *  so the resume position can seed `useState`/`useRef` directly at mount (the same reason
 *  reader.tsx's pagers seed from `initialPage` exactly once) instead of being synced in after the
 *  fact. Direct-only trim of reader.tsx's body: one segment, offset 0, nothing chapter-shaped. */
function ReaderPane({
  pages,
  startIndex,
  width,
  height,
  bridgeId,
  seriesId,
  seriesTitle,
  seriesCover,
  chromeVisible,
  onToggleChrome,
  onShowChrome,
  onHoldChrome,
  onZoomChange,
  onScrubActive,
}: {
  pages: string[];
  startIndex: number;
  width: number;
  height: number;
  bridgeId?: string;
  seriesId?: string;
  seriesTitle: string;
  seriesCover?: string;
  chromeVisible: boolean;
  onToggleChrome: () => void;
  onShowChrome: () => void;
  /** Chrome-hold (see reader.tsx's holdChrome): suspend auto-hide while a control is in use. */
  onHoldChrome: (hold: boolean) => void;
  onZoomChange: (zoomed: boolean) => void;
  /** A scrub drag started/ended — the screen also freezes its reveal scroll for the duration. */
  onScrubActive: (active: boolean) => void;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [settings] = useReaderSettings();

  const [currentPage, setCurrentPage] = useState(startIndex);
  const currentRef = useRef(startIndex);
  const setCurrent = useCallback((i: number) => {
    currentRef.current = i;
    setCurrentPage(i);
  }, []);

  const pagedRef = useRef<PagedReaderHandle>(null);
  const webtoonRef = useRef<WebtoonReaderHandle>(null);
  const items: ReaderPageItem[] = useMemo(
    () => pages.map((uri, i) => ({ uri, key: `${DIRECT_CHAPTER_ID}:${i}`, pageNumber: i + 1 })),
    [pages],
  );

  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      setCurrent(clamped);
      if (settings.mode === 'paged') pagedRef.current?.goToPage(clamped, animated);
      else webtoonRef.current?.goToPage(clamped);
    },
    [pages, settings.mode, setCurrent],
  );
  const turnPrev = useCallback(() => goTo(currentRef.current - 1, false), [goTo]);
  const turnNext = useCallback(() => goTo(currentRef.current + 1, false), [goTo]);

  // ── Scrubber (same UI-thread path as reader.tsx; offset 0 — nothing stitched) ──
  const scrubFlat = useSharedValue(-1);
  const [scrubbing, setScrubbing] = useState(false);
  const handleScrubbing = useCallback(
    (active: boolean) => {
      setScrubbing(active);
      onScrubActive(active);
    },
    [onScrubActive],
  );
  const scrubTo = useCallback(
    (position: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, position));
      if (settings.mode === 'paged') pagedRef.current?.scrubTo(clamped);
      else webtoonRef.current?.goToPage(Math.round(clamped), false);
    },
    [pages, settings.mode],
  );

  // ── Warm-ahead ──
  const warmAround = useCallback(
    (index: number) => {
      if (!pages.length) return;
      warmPrefetch(pages.slice(Math.max(0, index - WARM_BEHIND), index + 1 + settings.prefetchAhead));
    },
    [pages, settings.prefetchAhead],
  );
  useEffect(() => {
    if (pages.length) warmAround(currentPage);
  }, [pages, currentPage, warmAround]);

  // ── Progress recording — reader.tsx's direct-series branch (reading log, sentinel chapter id) ──
  const record = useCallback(() => {
    if (!bridgeId || !seriesId || !pages.length) return;
    void ds
      .recordReadingHistory({
        bridgeId,
        seriesId,
        title: seriesTitle,
        ...(seriesCover ? { thumbnailUrl: seriesCover } : {}),
        chapterId: DIRECT_CHAPTER_ID,
        lastPage: currentRef.current,
        pageCount: pages.length,
      })
      .then(() => {
        // Same invalidations as reader.tsx: resume labels + History tab + activity pip all read
        // this progress and would otherwise sit on stale cache.
        void queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
      })
      .catch(() => {});
  }, [bridgeId, seriesId, pages, seriesTitle, seriesCover, ds, mock, queryClient]);
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  // Debounced on page settle + flushed on unmount, like reader.tsx.
  useEffect(() => {
    const t = setTimeout(() => recordRef.current(), 1500);
    return () => clearTimeout(t);
  }, [currentPage]);
  useEffect(() => () => recordRef.current(), []);

  // ── Web keyboard nav (single-step version of reader.tsx's; no held-key repeat) ──
  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key === 'Escape') {
        router.back();
        e.preventDefault();
        return;
      }
      const isRight = e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';
      const isLeft = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
      if (!isRight && !isLeft) return;
      e.preventDefault();
      if (e.repeat) return;
      const forward = isRight !== (settings.direction === 'rtl');
      (forward ? turnNext : turnPrev)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, turnNext, turnPrev, settings.direction]);

  return (
    <>
      {settings.mode === 'paged' ? (
        <PagedReader
          ref={pagedRef}
          pages={items}
          width={width}
          height={height}
          rtl={settings.direction === 'rtl'}
          pageFit={settings.pageFit}
          initialPage={startIndex}
          onPageChange={setCurrent}
          // Keep the counter live during fast flicks (display-only elsewhere; here the committed
          // and visible page are the same thing — one segment, nothing to relabel).
          onVisiblePageChange={IS_WEB ? undefined : setCurrent}
          scrubTarget={scrubFlat}
          scrubbing={scrubbing}
          onPrev={turnPrev}
          onNext={turnNext}
          onToggleChrome={onToggleChrome}
          onZoomChange={onZoomChange}
        />
      ) : (
        <WebtoonReader
          ref={webtoonRef}
          pages={pages}
          width={width}
          height={height}
          pageFit={settings.pageFit}
          initialPage={startIndex}
          onPageChange={setCurrent}
          onToggleChrome={onToggleChrome}
          onZoomChange={onZoomChange}
        />
      )}

      {IS_WEB ? (
        <ProgressPill
          current={currentPage}
          total={pages.length}
          visible={chromeVisible}
          onJump={(i) => {
            goTo(i);
            onShowChrome();
          }}
          onEditingChange={onHoldChrome}
        />
      ) : (
        <ChapterNavigator
          page={currentPage}
          total={pages.length}
          rtl={settings.mode === 'paged' && settings.direction === 'rtl'}
          visible={chromeVisible}
          chaptered={false}
          hasPrevChapter={false}
          hasNextChapter={false}
          onPrevChapter={() => {}}
          onNextChapter={() => {}}
          onScrub={scrubTo}
          scrubTarget={settings.mode === 'paged' ? scrubFlat : undefined}
          offset={0}
          onSeek={goTo}
          onScrubbingChange={handleScrubbing}
          onScrubPage={warmAround}
        />
      )}
    </>
  );
}

/** The webtoon-mode outer pager: horizontal, two viewport-wide pages, resting on the SECOND (the
 *  reader). `contentOffset` seeds that rest position on iOS/web; the onLayout scroll is the Android
 *  fallback (where the prop has historically been unreliable) — one unanimated jump, first layout only. */
function HorizontalReveal({
  width,
  onScroll,
  scrollEnabled,
  children,
}: {
  width: number;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEnabled: boolean;
  children: ReactNode;
}) {
  const ref = useRef<ScrollView>(null);
  const seededRef = useRef(false);
  return (
    <ScrollView
      key="outer-horizontal"
      ref={ref}
      testID="direct-series.scroll"
      horizontal
      pagingEnabled
      contentOffset={{ x: width, y: 0 }}
      onLayout={() => {
        if (seededRef.current) return;
        seededRef.current = true;
        ref.current?.scrollTo({ x: width, animated: false });
      }}
      scrollEnabled={scrollEnabled}
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={32}>
      {children}
    </ScrollView>
  );
}

/** The series-info block: title, tags, meta, description, related rails — a compact single-column
 *  take on series.tsx's contentEl + relatedRailsEl (duplicated on purpose: extracting them from
 *  SeriesBody would couple the experiment to the stable screen it exists to bypass). */
function InfoSection({
  series,
  loading,
  fallbackTitle,
  bridgeId,
  width,
}: {
  series: SeriesDetail | null;
  /** Placeholder detail (or none at all) — tags/meta/description still in flight. */
  loading: boolean;
  fallbackTitle?: string;
  bridgeId?: string;
  width: number;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Related rails: same lazy fetch + capability gate as series.tsx (see there for why
  // `relatedGroupsDeferred` alone can't distinguish "deferred" from "has none").
  const { byId: bridgeById } = useBridgeMap();
  const relatedCapable = bridgeId
    ? (bridgeById.get(bridgeId)?.capabilities.includes('related-series') ?? false)
    : false;
  const needsRelatedFetch = relatedCapable && !!series?.relatedGroupsDeferred && !series.relatedGroups;
  const { data: fetchedRelated, isLoading: relatedLoading } = useQuery(
    relatedGroupsQuery(ds, mock, bridgeId ?? '', series?.id ?? '', needsRelatedFetch),
  );
  const relatedGroups = series?.relatedGroups ?? fetchedRelated;

  const tagColors = tagPaletteFor(series?.tagGroups?.map((g) => g.label) ?? [], scheme);
  const onTagPress = (group: TagGroup, index: number) => {
    if (!bridgeId) return;
    const intent = tagSearchIntent(group, index, { bridgeId });
    if (!intent) return;
    setSearchIntent(intent);
    router.push('/search');
  };

  return (
    <View
      testID="direct-series.info"
      // At least one viewport tall, so the snap boundary always has a full info page behind it.
      style={[styles.info, { width, minHeight: height, paddingBottom: insets.bottom + Spacing.five }]}>
      <ThemedText style={styles.infoTitle}>{series?.title ?? fallbackTitle ?? ''}</ThemedText>

      {loading ? (
        <>
          <View style={styles.skelChips}>
            {[60, 48, 80, 52, 70].map((w, i) => (
              <Skeleton key={i} style={[styles.skelChip, { width: w }]} />
            ))}
          </View>
          {(['100%', '96%', '100%', '60%'] as const).map((w, i) => (
            <Skeleton key={i} style={[styles.skelLine, { width: w }]} />
          ))}
        </>
      ) : (
        <>
          {series?.tagGroups?.length ? (
            <View style={styles.tagsBlock}>
              {series.tagGroups.map((g, gi) => (
                <TagGroupRow key={`${gi}:${g.label}`} group={g} color={tagColors[gi]!} onTagPress={(i) => onTagPress(g, i)} />
              ))}
            </View>
          ) : null}

          {series?.meta?.length ? (
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

          {series?.description ? (
            <ThemedText themeColor="textSecondary" style={styles.description}>
              {series.description}
            </ThemedText>
          ) : null}
        </>
      )}

      {relatedGroups?.length ? (
        <View style={styles.related}>
          {relatedGroups.map(
            (group, i) =>
              group.items.length > 0 && (
                <Rail
                  key={`${group.label}-${i}`}
                  section={{ id: `related-${i}`, title: group.label, kind: 'regular', items: group.items }}
                  viewportWidth={width}
                  bridge={series?.bridge}
                  bridgeId={bridgeId}
                  direct
                />
              ),
          )}
        </View>
      ) : needsRelatedFetch && relatedLoading ? (
        <View style={styles.related}>
          <RailSkeleton viewportWidth={width} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  readerCell: {
    backgroundColor: READER_BACKDROP,
    overflow: 'hidden',
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
  },
  infoPanel: {
    overflow: 'hidden',
  },
  info: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.four,
  },
  infoTitle: {
    // Matches series.tsx's title treatment (h2-ish, not the 32px subtitle).
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  tagsBlock: {
    gap: Spacing.two,
  },
  metaGrid: {
    flexDirection: 'row',
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
    fontSize: 14,
    lineHeight: 21,
  },
  related: {
    gap: Spacing.two,
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
  skelLine: {
    height: 13,
    borderRadius: 6,
  },
});
