import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TagGroupRow } from '@/components/chip';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { ChevronDownIcon } from '@/components/icons/ui-icons';
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
import { relativeTime } from '@/data/mock';
import {
  chapterPagesQuery,
  chapterProgressQuery,
  directPagesQuery,
  historyQuery,
  inLibraryQuery,
  queryKeys,
  relatedGroupsQuery,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { setSearchIntent, tagSearchIntent } from '@/data/search-intent';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type Chapter, type SeriesDetail, type TagGroup } from '@/data/types';
import { useBridgeMap } from '@/hooks/use-bridges';
import { useReaderSettings } from '@/hooks/use-reader-settings';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { applyReadState, firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import { tagPaletteFor } from '@/lib/tag-colors';
import { testId } from '@/lib/test-id';

// EXPERIMENTAL series reader page (Settings → General → Experimental). A series opened from a card
// lands HERE instead of on `/series`: the reader is up immediately — same paged/webtoon readers,
// chrome, scrubber, and progress recording as `/reader` — and the series info (tags, meta,
// description, chapter list, related rails) sits one scroll away as if the whole thing were a
// single scrollable page, with a snap at the reader↔info boundary so the pages always rest fully
// framed:
//   - paged mode (horizontal reading): the info is BELOW — swipe up to reveal it.
//   - webtoon mode (vertical reading): the info is a panel to the LEFT — swipe right to reveal it.
// The chrome also carries an explicit "Details" pill — the guaranteed reveal path for the cases a
// cross-axis swipe can't serve: web (the web pager owns its whole touch surface) and a fit-width
// page taller than the viewport in paged mode (its own vertical content-pan — see zoomable-page's
// `contentPan`, whose 10px activation out-competes the outer scroll — rightly wins the drag).
//
// Chaptered series read chapter-by-chapter: the screen resolves resume-or-first-chapter itself
// (same history lookup as useStartReading), the navigator's skip buttons and falling off either
// end of a chapter swap chapters in place, and tapping a chapter in the revealed info scrolls back
// up into the reader at that chapter. Unlike /reader there's NO cross-chapter stitching — a
// boundary crossing remounts the pane on the new chapter (the pre-stitching /reader behavior),
// which is the simplicity/fidelity trade this experiment deliberately makes.
//
// Deliberately self-contained so removing the experiment is simple: delete this file +
// `lib/experimental-flags.ts`, the Settings row in `settings-general.tsx`, the `buildHref` target
// switch in `series-card.tsx`, and this route's Stack.Screen entry in `_layout.tsx`.

const CHROME_HIDE_MS = 3000;
// Same CI-speed override as reader.tsx: Maestro steps can outlast the auto-hide, and hidden chrome
// drops out of the accessibility tree.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';
const WARM_BEHIND = 2;
const IS_WEB = Platform.OS === 'web';
// The reader surface's tone — matches reader.tsx's backdrop (`#reader-view`'s #0f0f0f, not pure black).
const READER_BACKDROP = '#0f0f0f';
// How many chapter rows the info section shows before collapsing behind "Show all" — the info
// column mounts with the screen (it's the other half of the reveal scroll), so a 200-chapter
// series must not pay for 200 rows just to open the reader.
const COLLAPSED_CHAPTER_ROWS = 25;

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

/** What the reader pane is pointed at: a chapter (chaptered series) or the series itself (direct).
 *  `start: 'last'` = land on the final page (arriving from the NEXT chapter's "previous"). */
type ReadTarget = { chapterId?: string; chapterName?: string; start: number | 'last' };

export default function SeriesReaderScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const mock = useMockActive();
  const [settings] = useReaderSettings();

  // Same params a series card forwards to `/series` (see series-card.tsx buildHref) — including the
  // percent-encoded bridge name / cover, decoded the same way series.tsx does.
  const { id, title, bridge: bridgeParam, bridgeId, cover: coverParam, direct } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
    bridgeId?: string;
    cover?: string;
    /** '1' for a direct (chapterless) series — its pages ARE the series. */
    direct?: string;
  }>();
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Series detail (title/tags/meta/description/related) — placeholder-seeded from the forwarded
  // title+cover exactly like series.tsx, so the info section has a real title immediately.
  const { data: series = null, isPlaceholderData } = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
  );

  // Chapter list (chaptered series only), with local read state merged on for the info rows —
  // the same chapterProgressQuery + applyReadState pair ChapterScrollList uses.
  const { data: listData, isLoading: listLoading } = useQuery(
    seriesListQuery(ds, mock, bridgeId ?? '', id ?? '', false, !isDirect),
  );
  const { data: progress } = useQuery(chapterProgressQuery(ds, mock, bridgeId ?? '', id ?? '', !isDirect && !!bridgeId));
  const chapters = useMemo(
    () => (listData?.chapters ? applyReadState(listData.chapters, progress ?? []) : undefined),
    [listData, progress],
  );
  const chapterCount = listData?.chapterCount ?? series?.chapterCount;

  // ── Where does reading start? ────────────────────────────────────────────
  // Resume from the reading history (same lookup as useStartReading — resolved here, not at the
  // card tap, so cards in recycled lists never subscribe to history), else the first chapter in
  // reading order, else — for a direct series — the pages themselves. The derived value settles
  // once the history (and, chaptered, the chapter list) is in; after that, chapter navigation
  // OVERRIDES it. The mounted pane seeds its position once at mount, so later history refetches
  // (our own progress writes invalidate it) never yank the pager.
  const { data: history, isLoading: historyLoading } = useQuery(historyQuery(ds, mock));
  const resume = useMemo(
    () => history?.find((h) => h.bridgeId === bridgeId && h.seriesId === id),
    [history, bridgeId, id],
  );
  const derivedTarget: ReadTarget | null = useMemo(() => {
    if (historyLoading) return null;
    if (isDirect) {
      const resumeDirect = resume && (resume.chapterId === DIRECT_CHAPTER_ID || !resume.chapterId);
      return { start: resumeDirect ? (resume?.lastPage ?? 0) : 0 };
    }
    if (resume?.chapterId && resume.chapterId !== DIRECT_CHAPTER_ID) {
      return { chapterId: resume.chapterId, chapterName: resume.chapterName, start: resume.lastPage ?? 0 };
    }
    if (chapters?.length) {
      const first = firstChapterInReadingOrder(chapters, getPreferredGroup());
      if (first) return { chapterId: first.id, chapterName: first.name, start: 0 };
    }
    return null; // chapter list still loading (or empty)
  }, [historyLoading, isDirect, resume, chapters]);
  const [override, setOverride] = useState<ReadTarget | null>(null);
  const target = override ?? derivedTarget;
  const targetChapterId = target?.chapterId;

  // Keep next/prev chapter following the same scanlation group (mirrors reader.tsx).
  useEffect(() => {
    if (!targetChapterId) return;
    const group = chapters?.find((c) => c.id === targetChapterId)?.group;
    if (group !== undefined) setPreferredGroup(group);
  }, [targetChapterId, chapters]);

  // The target chapter's pages (or the direct page list). Cached per chapter, so revisiting one
  // (or skipping back) repaints from the query cache.
  const {
    data: pages = null,
    error: queryError,
    refetch,
  } = useQuery({
    ...(target?.chapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', target.chapterId)
      : directPagesQuery(ds, mock, bridgeId ?? '', id ?? '')),
    enabled: !!target && !!id,
  });
  const error = queryError ? (queryError as Error).message || 'Failed to load pages' : null;
  const readerReady = !!target && !!pages;

  // ── Adjacent chapters (chaptered only; no stitching — see the header comment) ──
  const currentChapter = useMemo(
    () => (targetChapterId ? chapters?.find((c) => c.id === targetChapterId) : undefined),
    [chapters, targetChapterId],
  );
  const nextChapter = useMemo(
    () => (currentChapter && chapters ? getAdjacentChapter(chapters, currentChapter, 1, getPreferredGroup()) : null),
    [chapters, currentChapter],
  );
  const prevChapter = useMemo(
    () => (currentChapter && chapters ? getAdjacentChapter(chapters, currentChapter, -1, getPreferredGroup()) : null),
    [chapters, currentChapter],
  );
  // `landing` defaults to whichever keeps PAGING continuous (same rule as reader.tsx): forward
  // lands on page 1, backward on the last page. The navigator's skip buttons pass 'first'.
  const goAdjacentChapter = useCallback(
    (delta: 1 | -1, landing: 'first' | 'last' = delta === 1 ? 'first' : 'last') => {
      const chapterTo = delta === 1 ? nextChapter : prevChapter;
      if (!chapterTo) return;
      setOverride({ chapterId: chapterTo.id, chapterName: chapterTo.name, start: landing === 'last' ? 'last' : 0 });
    },
    [nextChapter, prevChapter],
  );

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

  // ── Reveal plumbing: outer scroll ref, revealed-state (status bar), programmatic jumps ──
  const outerRef = useRef<ScrollView>(null);
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
  const revealInfo = useCallback(() => {
    if (settings.mode === 'paged') outerRef.current?.scrollTo({ y: height, animated: true });
    else outerRef.current?.scrollTo({ x: 0, animated: true });
  }, [settings.mode, height]);
  const revealReader = useCallback(() => {
    if (settings.mode === 'paged') outerRef.current?.scrollTo({ y: 0, animated: true });
    else outerRef.current?.scrollTo({ x: width, animated: true });
  }, [settings.mode, width]);

  // A chapter row in the revealed info: scroll back up into the reader, now on that chapter —
  // resuming its recorded page when it's the series' resume chapter, else from the top.
  const openChapter = useCallback(
    (chapter: Chapter) => {
      setOverride({
        chapterId: chapter.id,
        chapterName: chapter.name,
        start: resume?.chapterId === chapter.id ? (resume.lastPage ?? 0) : 0,
      });
      revealReader();
    },
    [resume, revealReader],
  );

  const seriesTitle = series?.title ?? title ?? id ?? 'Reader';
  const author = series?.meta?.find((m) => m.label === 'AUTHOR')?.value;

  // One full-viewport cell: the reader plus its own chrome (toolbar, page scrubber / progress
  // pill, Details hint). The chrome is absolutely positioned WITHIN the cell, so it travels with
  // the reader when the info is revealed instead of floating over it.
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
          // Chapter navigation swaps the pane wholesale — position state, records, and the pager
          // all belong to exactly one chapter (or the direct page list).
          key={target.chapterId ?? DIRECT_CHAPTER_ID}
          pages={pages}
          start={target.start}
          width={width}
          height={height}
          bridgeId={bridgeId}
          seriesId={id}
          seriesTitle={seriesTitle}
          seriesCover={series?.cover}
          chapterId={target.chapterId}
          chapterName={target.chapterName}
          chaptered={!isDirect}
          hasPrevChapter={!!prevChapter}
          hasNextChapter={!!nextChapter}
          nextChapterName={nextChapter?.name}
          onCrossChapter={goAdjacentChapter}
          onSkipChapter={(delta) => {
            showChrome();
            goAdjacentChapter(delta, 'first');
          }}
          chromeVisible={chromeVisible}
          onToggleChrome={toggleChrome}
          onShowChrome={showChrome}
          onHoldChrome={holdChrome}
          onZoomChange={setReaderZoomed}
          onScrubActive={onScrubActive}
        />
      )}
      <DetailsHint mode={settings.mode} visible={chromeVisible} onPress={revealInfo} />
      {/* Toolbar outside the loaded branch, like reader.tsx: back + settings stay reachable while
          pages are loading or the fetch failed. Series title on top, chapter beneath. */}
      <ReaderToolbar
        title={seriesTitle}
        subtitle={target?.chapterName ?? ''}
        visible={chromeVisible}
        onBack={() => router.back()}
        right={
          <SettingsControl
            bridgeId={bridgeId}
            seriesId={id}
            title={seriesTitle}
            thumbnailUrl={series?.cover}
            author={author}
            direct={isDirect}
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
      chapters={isDirect ? undefined : chapters}
      chaptersLoading={!isDirect && listLoading}
      chapterCount={isDirect ? undefined : chapterCount}
      currentChapterId={target?.chapterId}
      onOpenChapter={openChapter}
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
          ref={outerRef}
          testID="series-reader.scroll"
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
        <HorizontalReveal scrollRef={outerRef} width={width} onScroll={onOuterScroll} scrollEnabled={!readerZoomed}>
          <View style={[styles.infoPanel, { width, height }]}>
            <ScrollView showsVerticalScrollIndicator={false}>{info}</ScrollView>
          </View>
          {readerCell}
        </HorizontalReveal>
      )}
    </ThemedView>
  );
}

/** The reader itself + its bottom chrome, keyed to ONE chapter (or the direct page list) and
 *  mounted only once its pages are in — so the start position seeds `useState`/`useRef` directly
 *  at mount (the same reason reader.tsx's pagers seed from `initialPage` exactly once). A trim of
 *  reader.tsx's body: chapter changes swap the whole pane (no cross-chapter stitching), and the
 *  unmount flush records the outgoing chapter's final position. */
function ReaderPane({
  pages,
  start,
  width,
  height,
  bridgeId,
  seriesId,
  seriesTitle,
  seriesCover,
  chapterId,
  chapterName,
  chaptered,
  hasPrevChapter,
  hasNextChapter,
  nextChapterName,
  onCrossChapter,
  onSkipChapter,
  chromeVisible,
  onToggleChrome,
  onShowChrome,
  onHoldChrome,
  onZoomChange,
  onScrubActive,
}: {
  pages: string[];
  /** First page to show — `'last'` lands on the final page (arriving backward from the next chapter). */
  start: number | 'last';
  width: number;
  height: number;
  bridgeId?: string;
  seriesId?: string;
  seriesTitle: string;
  seriesCover?: string;
  chapterId?: string;
  chapterName?: string;
  /** False for a direct series — drops the navigator's chapter-skip buttons. */
  chaptered: boolean;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  nextChapterName?: string;
  /** Paging off either end of the chapter (delta −1 lands on the previous chapter's LAST page). */
  onCrossChapter: (delta: 1 | -1) => void;
  /** The navigator's skip buttons — always land on the target chapter's first page. */
  onSkipChapter: (delta: 1 | -1) => void;
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

  const startIndex = Math.max(0, Math.min(pages.length - 1, start === 'last' ? pages.length - 1 : start));
  const [currentPage, setCurrentPage] = useState(startIndex);
  const currentRef = useRef(startIndex);
  const setCurrent = useCallback((i: number) => {
    currentRef.current = i;
    setCurrentPage(i);
  }, []);

  const pagedRef = useRef<PagedReaderHandle>(null);
  const webtoonRef = useRef<WebtoonReaderHandle>(null);
  const items: ReaderPageItem[] = useMemo(
    () => pages.map((uri, i) => ({ uri, key: `${chapterId ?? DIRECT_CHAPTER_ID}:${i}`, pageNumber: i + 1 })),
    [pages, chapterId],
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
  // Boundary page-turns fall through to the adjacent chapter (chaptered only), same as reader.tsx's
  // route-level fallback — there's no stitched window here, so this is the only crossing.
  const turnPrev = useCallback(() => {
    if (currentRef.current <= 0) {
      if (chaptered && hasPrevChapter) onCrossChapter(-1);
      return;
    }
    goTo(currentRef.current - 1, false);
  }, [goTo, chaptered, hasPrevChapter, onCrossChapter]);
  const turnNext = useCallback(() => {
    if (currentRef.current >= pages.length - 1) {
      if (chaptered && hasNextChapter) onCrossChapter(1);
      return;
    }
    goTo(currentRef.current + 1, false);
  }, [goTo, pages, chaptered, hasNextChapter, onCrossChapter]);
  const atLastPage = useCallback(() => currentRef.current >= pages.length - 1, [pages]);

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

  // ── Progress recording — reader.tsx's rules: a library series records chapter progress, anything
  // else (including a direct series) goes to the reading log under the DIRECT_CHAPTER_ID sentinel. ──
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, bridgeId ?? '', seriesId ?? ''),
    retry: false,
  });
  const record = useCallback(() => {
    if (!bridgeId || !seriesId || !pages.length || inLibrary === undefined) return;
    const lastPage = currentRef.current;
    const pageCount = pages.length;
    const invalidateHistory = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.history(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapterProgress(mock, bridgeId, seriesId) });
    };
    if (chapterId && inLibrary) {
      void ds
        .recordChapterProgress(bridgeId, seriesId, chapterId, {
          lastPage,
          pageCount,
          ...(chapterName ? { chapterName } : {}),
        })
        .then(invalidateHistory)
        .catch(() => {});
      return;
    }
    void ds
      .recordReadingHistory({
        bridgeId,
        seriesId,
        title: seriesTitle,
        ...(seriesCover ? { thumbnailUrl: seriesCover } : {}),
        chapterId: chapterId ?? DIRECT_CHAPTER_ID,
        ...(chapterName ? { chapterName } : {}),
        lastPage,
        pageCount,
      })
      .then(invalidateHistory)
      .catch(() => {});
  }, [bridgeId, seriesId, pages, inLibrary, chapterId, chapterName, seriesTitle, seriesCover, ds, mock, queryClient]);
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  // Debounced on page settle + flushed on unmount (leaving the screen AND chapter swaps — the pane
  // is keyed by chapter), like reader.tsx.
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
          // and visible page are the same thing — one chapter, nothing to relabel).
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
          // Same pairing as reader.tsx: the continuous strip advances via its end sentinel, the
          // fit-page variant via the end-reached + last-page check.
          nextChapterName={chaptered ? nextChapterName : undefined}
          onAdvance={chaptered && hasNextChapter ? () => onCrossChapter(1) : undefined}
          onEndReached={
            chaptered && hasNextChapter
              ? () => {
                  if (atLastPage()) onCrossChapter(1);
                }
              : undefined
          }
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
          chaptered={chaptered}
          hasPrevChapter={hasPrevChapter}
          hasNextChapter={hasNextChapter}
          onPrevChapter={() => onSkipChapter(-1)}
          onNextChapter={() => onSkipChapter(1)}
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

/** The chrome's "Details" pill — the guaranteed, non-gesture way into the info half. Sits above
 *  the bottom chrome and fades with it. Needed because the cross-axis swipe can't always win:
 *  the web pager owns its whole touch surface, and an overflowing fit-width page's content-pan
 *  (rightly) takes vertical drags in paged mode. */
function DetailsHint({
  mode,
  visible,
  onPress,
}: {
  mode: 'paged' | 'webtoon';
  visible: boolean;
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
  }));
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.detailsWrap, { bottom: insets.bottom + Spacing.two + 48 }, style]}>
      <Pressable
        testID="series-reader.details"
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Show series details"
        style={styles.detailsPill}>
        {/* The chevron points where the info comes FROM: below in paged mode, the left in webtoon. */}
        {mode === 'paged' ? <ChevronDownIcon color="#fff" size={16} /> : <ChevronLeftIcon color="#fff" size={16} />}
        <ThemedText type="small" style={styles.detailsLabel}>
          Details
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

/** The webtoon-mode outer pager: horizontal, two viewport-wide pages, resting on the SECOND (the
 *  reader). `contentOffset` seeds that rest position on iOS/web; the onLayout scroll is the Android
 *  fallback (where the prop has historically been unreliable) — one unanimated jump, first layout only. */
function HorizontalReveal({
  scrollRef,
  width,
  onScroll,
  scrollEnabled,
  children,
}: {
  scrollRef: RefObject<ScrollView | null>;
  width: number;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEnabled: boolean;
  children: ReactNode;
}) {
  const seededRef = useRef(false);
  return (
    <ScrollView
      key="outer-horizontal"
      ref={scrollRef}
      testID="series-reader.scroll"
      horizontal
      pagingEnabled
      contentOffset={{ x: width, y: 0 }}
      onLayout={() => {
        if (seededRef.current) return;
        seededRef.current = true;
        scrollRef.current?.scrollTo({ x: width, animated: false });
      }}
      scrollEnabled={scrollEnabled}
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={32}>
      {children}
    </ScrollView>
  );
}

/** The series-info block: title, tags, meta, description, chapter list (chaptered series), and
 *  related rails — a compact single-column take on series.tsx's contentEl + chapter list +
 *  relatedRailsEl (duplicated on purpose: extracting them from SeriesBody would couple the
 *  experiment to the stable screen it exists to bypass; the chapter rows here are deliberately
 *  plain — no swipe actions/downloads — because the full ChapterScrollList owns its own scroller,
 *  which can't nest inside the reveal scroll). */
function InfoSection({
  series,
  loading,
  fallbackTitle,
  bridgeId,
  width,
  chapters,
  chaptersLoading,
  chapterCount,
  currentChapterId,
  onOpenChapter,
}: {
  series: SeriesDetail | null;
  /** Placeholder detail (or none at all) — tags/meta/description still in flight. */
  loading: boolean;
  fallbackTitle?: string;
  bridgeId?: string;
  width: number;
  /** Chaptered series only — with local read state already merged on (applyReadState). */
  chapters?: Chapter[];
  chaptersLoading?: boolean;
  chapterCount?: number;
  /** The chapter the reader pane is on — highlighted in the list. */
  currentChapterId?: string;
  onOpenChapter?: (chapter: Chapter) => void;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const router = useRouter();
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [chaptersExpanded, setChaptersExpanded] = useState(false);

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

  const shownChapters = chaptersExpanded ? chapters : chapters?.slice(0, COLLAPSED_CHAPTER_ROWS);
  const hiddenCount = (chapters?.length ?? 0) - (shownChapters?.length ?? 0);

  return (
    <View
      testID="series-reader.info"
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

      {/* Chapter list (chaptered series). Tapping a row hands it to the reader half and the screen
          scrolls back up into it — the row IS the navigation, so no /reader push. */}
      {chapters || chaptersLoading ? (
        <View>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.chaptersHeading}>
            {chapterCount != null ? `${chapterCount} CHAPTERS` : 'CHAPTERS'}
          </ThemedText>
          {chaptersLoading && !chapters
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} style={styles.skelChapterRow} />)
            : shownChapters?.map((c) => {
                const current = c.id === currentChapterId;
                return (
                  <Pressable
                    key={c.id}
                    testID={testId('series-reader.chapter', c.id)}
                    onPress={() => onOpenChapter?.(c)}
                    accessibilityRole="button"
                    accessibilityLabel={c.name}
                    style={({ pressed }) => [
                      styles.chapterRow,
                      { borderColor: theme.hairline },
                      pressed && styles.chapterRowPressed,
                    ]}>
                    <View style={styles.chapterRowText}>
                      <ThemedText
                        type="small"
                        numberOfLines={1}
                        style={[current && { color: theme.accent }, !current && c.read && { color: theme.textSecondary }]}>
                        {c.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.chapterSub}>
                        {[c.group, c.date ? relativeTime(c.date) : undefined].filter(Boolean).join(' · ')}
                      </ThemedText>
                    </View>
                    {current && (
                      <ThemedText type="small" style={{ color: theme.accent }}>
                        Reading
                      </ThemedText>
                    )}
                  </Pressable>
                );
              })}
          {hiddenCount > 0 && (
            <Pressable
              testID="series-reader.chapters.show-all"
              onPress={() => setChaptersExpanded(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.showAll, pressed && styles.chapterRowPressed]}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                Show all {chapters?.length}
              </ThemedText>
            </Pressable>
          )}
        </View>
      ) : null}

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
  detailsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  detailsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  detailsLabel: {
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
  chaptersHeading: {
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: Spacing.two,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chapterRowPressed: {
    opacity: 0.6,
  },
  chapterRowText: {
    flex: 1,
    gap: 2,
  },
  chapterSub: {
    fontSize: 12,
  },
  skelChapterRow: {
    height: 40,
    borderRadius: 6,
    marginBottom: Spacing.one,
  },
  showAll: {
    paddingVertical: Spacing.two,
    alignItems: 'center',
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
