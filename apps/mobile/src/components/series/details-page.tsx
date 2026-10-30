import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useNavigation, useTheme as useNavTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { LinearGradient } from 'expo-linear-gradient';
import { usePushSettled } from '@/components/reader/chapter-navigator';
import { focusSkip } from '@/lib/focus-nav';
import { RetryBlock } from '@/components/retry-block';
import { TopBar } from '@/components/top-bar';
import { TopBarSwitch } from '@/components/top-bar-switch';
import { Spacing } from '@/constants/theme';
import { seriesGoneReason } from '@/data/api';
import {
  chapterPagesQuery,
  directPagesQuery,
  historyQuery,
  inLibraryQuery,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type Chapter } from '@/data/types';
import { useMissingBridge } from '@/hooks/use-bridges';
import { useChapterReconcile } from '@/hooks/use-chapter-reconcile';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { withoutRouterParams, withZoomSource, ZoomSource } from '@/components/zoom-source';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { firstChapterInReadingOrder } from '@/lib/chapter-order';
import { useTabRoute } from '@/lib/focused-tab';
import { tabHref, useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import {
  backSwipePan,
  backSwipeShape,
  backSwipeStayedHorizontal,
  resetBackSwipeShape,
  trackBackSwipeShape,
  BackSwipeGestureContext,
} from '@/lib/back-swipe';
import { trace, traceGate, traceJS, traceThrottled, useGestureTraceEnabled } from '@/lib/gesture-trace';
import { releaseCommitted } from '@/lib/gesture-release';
import { useSeriesPaneWidth } from '@/lib/series-pane-context';
import { holdSeriesBackdrop, seriesReaderDim } from '@/lib/series-backdrop';
import { type ZoomRect } from '@/lib/series-zoom';
import { truncateTopBarTitle } from '@/components/series/series-body';
import { SeriesDetailsHost } from '@/components/series/details-host';
import { LeavingMask } from '@/components/series/leaving-mask';
import {
  COLLAPSE_ARMED,
  DISMISS_COMMIT_FRACTION,
  NO_ORIGIN_SCALE,
  PULL_COMMIT_PX,
  REVEAL_COMMIT_FRACTION,
  SPRING_BACK,
  ZOOM_BACK_SWIPE_FOLLOW_GRIP,
  ZOOM_BACK_SWIPE_FOLLOW_REACH,
  ZOOM_BOUND_MIN_VISIBLE,
  ZOOM_BOUND_WAIT_MS,
  ZOOM_CONTENT_FADE_CLOSE,
  ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE,
  ZOOM_CONTENT_FADE_CLOSE_OFFCOVER,
  ZOOM_CONTENT_FADE_OPEN,
  ZOOM_DRAG_TRAVEL,
  ZOOM_OUT_SPRING,
  ZOOM_THUMB_FADE_CLOSE,
  ZOOM_THUMB_FADE_CLOSE_OFFCOVER,
  ZOOM_THUMB_FADE_OPEN,
  computeZoomGeom,
  pickZoomGeom,
  zoomBoundShift,
  zoomCrossAxisDrag,
  zoomDragFollow,
  zoomMaskBox,
  zoomThrowSpeed,
} from '@/components/series/page-motion';
import { ReaderPane, type ReaderPaneHandle } from '@/components/series/reader-pane';
import { NO_SEGMENTS, type ReadTarget, type SeriesReaderParams } from '@/components/series/reader-types';
import {
  FADE_WINDOW,
  HEADER_BAND,
  READER_BACKDROP,
  SHEET_FADE_H,
  TITLE_MID,
  handOffSplit,
  takeSplitHandoff,
} from '@/components/series/split-handoff';
import { usePageLeave } from '@/components/series/use-page-leave';
import { usePageZoom } from '@/components/series/use-page-zoom';
import { useViewport } from '@/components/series/viewport';

const IS_WEB = Platform.OS === 'web';

const noop = () => {};

const IS_IOS = Platform.OS === 'ios';

/**
 * The details page of a series: its hero, its SeriesBody, and the strip across the top showing the
 * page you are on, which opens the reader page on a tap or a drag. It is the route's first page, a
 * series drilled over another one (a layer, `depth` > 0), or a pushed card in an iOS tab, and it
 * leaves by collapsing into the card it came from or by the back-swipe.
 */
export function SeriesDetailsPage({
  params,
  depth,
  onPopLayer,
  isTop,
  nativePush,
}: {
  params: SeriesReaderParams;
  depth: number;
  onPopLayer: () => void;
  /** A pushed card whose transitions are the system's (see useNativePush). Never for a layer. */
  nativePush: boolean;
  /** Whether this instance is the top of the stack — the one keyboard back acts on (web). */
  isTop: boolean;
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  // The navigation theme, for the system bar's own tint (iOS): the details hand it back after the
  // reader's white.
  const navTheme = useNavTheme();
  const { width, height } = useViewport();
  const insets = useSafeAreaInsets();
  const mock = useMockActive();

  const {
    id,
    title,
    bridge: bridgeParam,
    bridgeId,
    cover: coverParam,
    direct,
  } = params;
  const seriesKey = bridgeId && id ? `${bridgeId}:${id}` : null;
  // Off iOS the pages of the split draw the move between them (see SplitHandoff): these details
  // grow the reader page they push out of their strip, and slide up over a reader that brings
  // them up in its place. On iOS each is a native push over the other (see useNativePush).
  const splitDrawn = !IS_IOS;
  const [revealIn] = useState(() => splitDrawn && !!seriesKey && !!takeSplitHandoff(seriesKey, 'reveal'));
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // The strip's visible page, as its pane reports it.
  const [visiblePage, setVisiblePage] = useState<{ pageIndex: number; chapterId: string } | null>(null);

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Chapter list (chaptered series only) — drives resume-or-first resolution and prev/next
  // adjacency for the reader pane. (The details card's own list rendering — read state, downloads,
  // versions — is SeriesBody's business, not duplicated here.)
  const { data: listData } = useQuery(
    seriesListQuery(ds, mock, bridgeId ?? '', id ?? '', false, !isDirect),
  );
  const chapters = listData?.chapters;

  // Library membership — tells the reader pane whether a read also has to keep the reading log's row
  // up to date (see its `record`). The query lives HERE, not in the pane:
  // the pane re-renders on every page sweep, and useQuery's per-render subscription work (query
  // key hashing) is measurable at that cadence.
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, bridgeId ?? '', id ?? ''),
    retry: false,
    enabled: !!bridgeId && !!id,
  });

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
  // The strip shows where reading would resume. The reader page records its moves into the
  // history, so the strip follows them there.
  const target = derivedTarget;
  const targetChapterId = target?.chapterId;

  // Keep next/prev chapter following the same scanlation group.
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
    ...(targetChapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', targetChapterId)
      : directPagesQuery(ds, mock, bridgeId ?? '', id ?? '')),
    // A DIRECT series' page list is just "this series' pages" — `directPagesQuery` takes nothing
    // from the read target, so waiting for one held it behind the history query for no reason
    // (history only decides which PAGE to land on, which the pane needs, not which request to
    // make). Chaptered still waits, and genuinely must: until the target resolves there is no
    // chapter id, and firing without one would ask `directPagesQuery` for a series that has none.
    enabled: !!id && (isDirect || !!target),
  });
  // Series detail for the bar's title (placeholder-seeded from the forwarded title+cover). The details card's SeriesDetailsHost subscribes to this same query key, so this
  // costs one fetch total.
  const { data: series = null } = useQuery({
    ...seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title: title,
      cover: cover,
    }),
  });
  // ORDERING, and why this query sits HERE rather than at the top of the component. React Query
  // dispatches on mount effects, which run in hook order, so declaration order IS request order
  // for anything enabled on the first commit. That gives both directions for free:
  //   · a BROWSE open — the pages query above is gated on a resolved read target, which needs
  //     history (and, chaptered, the chapter list) to come back first. Detail is dispatched at
  //     mount and wins by a mile; it needs no gate of its own.
  //   · a READER-FIRST open — the row seeds the target from its own params, so the pages query is
  //     live on the first commit and, being declared above, is dispatched first. Which is the
  //     ordering History and Activity want: the page they tapped to keep reading, then the rest.
  // Both matter on device, where the on-device runtime serves everything through one in-process
  // transport and order of arrival is order of service.
  //
  // What this replaced was `/series`'s `detailStarted` rule — an `enabled` gate on the pages query,
  // true once detail was in flight. Hook order already guarantees that, and can express the
  // reverse as well, which a gate cannot: a gate only ever holds one query back, it can never swap
  // which goes first. Nothing here delays a request that is ready to go.

  const error = queryError ? (queryError as Error).message || 'Failed to load pages' : null;
  // The bridge's own error for a bridge that isn't there is a server path and a Retry that can't work.
  const missingBridge = useMissingBridge(bridgeId);
  const pagesGone = seriesGoneReason(queryError) !== undefined;

  // True while a horizontal details gesture (back-swipe or webtoon reveal) is ACTIVE. The pans
  // ride the details scroller's own detector, simultaneous with it — that's the only way they
  // activate over a UIScrollView at all (see makeBackSwipePan) — but simultaneous means the list
  // happily keeps scrolling underneath a swipe that is carrying the whole page away. Freezing
  // the scroller for the duration is the standard fix: one re-render as the gesture takes over,
  // and iOS drops its in-flight tracking the moment scrolling is disabled.
  const [swipeLocked, setSwipeLocked] = useState(false);
  // Whether the ENTRANCE animation has finished (the zoom spring's completion callback flips it —
  // see startZoom). The zoom scales the WHOLE page behind a growing mask, so the strip rides
  // `standby` until this flips: its visible page mounts and paints, everything else waits out the
  // flight. Starts SETTLED on web and on a pushed card, where there is no entrance to defer
  // behind, and for details sliding up over their reader, which open on that reader's page.
  const [entranceSettled, setEntranceSettled] = useState(IS_WEB || nativePush || revealIn);
  const markEntranceSettled = useCallback(() => setEntranceSettled(true), []);
  const pushSettled = usePushSettled();
  const readerReady = !!target && !!pages;

  // ── The strip ⇄ reader move ───────────────────────────────────────────────
  // `progress` (0 = the strip grown to the full window, 1 = details) is written on the UI thread by
  // the pans below and animated by `setRevealed`. The page rests at 1; it travels toward 0 only on
  // the way to the reader page, which takes over from wherever it got to (see SplitHandoff), and
  // details sliding up over their reader start from 0.
  const progress = useSharedValue(revealIn ? 0 : 1);
  // How far a drag travels to carry the strip down to the full window.
  const headerSpan = Math.max(1, height - (insets.top + HEADER_BAND));
  // The details page's internal scroll offset (SeriesBody's list writes it on the UI thread via
  // the same `sharedValues` wiring pull-to-refresh uses) — drives the strip occlusion, the top
  // bar's scroll crossfade, and the pull-past-top reveal.
  const detailsScrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset: detailsScrollOffset }), [detailsScrollOffset]);
  // Whether the details are the page at rest: false from the moment a drag or a pull commits to
  // the reader page until the page is put back behind it (`paneHandoffs`, or the strip hand-off's
  // `covered`), so the details' own gestures stand down meanwhile.
  const detailsActiveSV = useSharedValue(true);
  // The iOS pull past the top (the reaction below): armed while the page is pulled down past it.
  const pullEngagedSV = useSharedValue(false);
  // This page is on its way out under a system pop — UIKit's zoom dismissal claims the same
  // pull-down at the top that the pull above reads, and a release then must not push the reader
  // onto a page that is leaving. Mirrored from the stack's transition events (see `ClosingNavigation`).
  const closingSV = useSharedValue(false);

  // Geometry: the reader strip's height — the top-of-page band the details content starts below.
  // The details layer itself is full-screen (the strip is page, not chrome). Declared up here
  // because it is also the zoom's DESTINATION BOUND (see zoomGeom), and the split's hand-off
  // below reads the strip's rect.
  const bandH = insets.top + HEADER_BAND;
  // Content starts high enough that the series title's center lands on the seam gradient's
  // center — the strip fades into the details THROUGH the title.
  const headerTopInset = bandH - SHEET_FADE_H / 2 - TITLE_MID;
  // The strip as the zoom source of the reader page it pushes, on iOS (see ZoomSource).
  const tab = useTabRoute();
  const [stripZoomId, setStripZoomId] = useState<string | null>(null);
  const stripZoomHref = useMemo(
    () => (IS_IOS ? (tab ? tabHref(tab, '/series/read', {}) : '/series/read') : null),
    [tab],
  );

  /**
   * Reading starts on the reader page, pushed over these details with the same params a History row
   * carries, plus `from` so its Details button comes back here.
   *
   * On iOS the push zooms out of the strip while the strip is on screen. Elsewhere the reader grows
   * out of the strip itself (see SplitHandoff), except in the desktop pane (components/series-pane):
   * a reader is the one thing on web that still takes the whole window, so from there it is a plain
   * push over the pane, which closing the reader comes back to as it was.
   */
  const inPane = useSeriesPaneWidth() !== null;
  const handsStripOff = splitDrawn && !inPane;
  const [paneHandoffs, setPaneHandoffs] = useState(0);
  // A swipe that commits to the reader has already animated `progress` there itself, so the pane
  // left behind would be showing a reader when it is uncovered.
  useEffect(() => {
    if (paneHandoffs === 0) return;
    progress.set(1);
    detailsActiveSV.set(true);
  }, [paneHandoffs, progress, detailsActiveSV]);
  // `at` is for callers that set a new target in the same handler: `target` here is still the
  // previous render's, so a page tapped in the details would hand off the old start page.
  const openReaderPage = useCallback((at: ReadTarget | null = target) => {
    const next = withoutRouterParams(params);
    next.reader = '1';
    next.start = String(at?.start ?? 0);
    if (at?.chapterId) {
      next.chapterId = at.chapterId;
      next.chapterName = at.chapterName ?? '';
    } else if (isDirect) {
      next.direct = '1';
    }
    if (at?.picked) next.picked = '1';
    // The reader page goes back to what pushed it: the pane, or the details.
    next.from = 'details';
    if (handsStripOff) {
      // Picked up where the strip is now: its bottom edge, and however far a drag had opened it.
      const off = Math.min(Math.max(detailsScrollOffset.get(), 0), bandH);
      if (seriesKey) {
        handOffSplit(seriesKey, {
          kind: 'strip',
          stripBottom: Math.max(0, bandH - SHEET_FADE_H - off),
          progress: progress.get(),
          covered: () => {
            progress.set(1);
            detailsActiveSV.set(true);
          },
        });
      }
      router.push({ pathname: '/series/read', params: next });
      return;
    }
    setPaneHandoffs((n) => n + 1);
    if (inPane) {
      router.push({ pathname: '/series/read', params: next });
      return;
    }
    // Scrolled mostly away under the details, the strip is no source to grow out of.
    const zoomFrom = detailsScrollOffset.get() < headerTopInset / 2 ? stripZoomId : null;
    router.push({ pathname: '/series', params: withZoomSource(next, zoomFrom) });
  }, [
    inPane,
    handsStripOff,
    params,
    target,
    isDirect,
    router,
    detailsScrollOffset,
    bandH,
    seriesKey,
    progress,
    detailsActiveSV,
    headerTopInset,
    stripZoomId,
  ]);
  const { routeBackHeld, leaveOnce, hasLeft } = usePageLeave({ depth, onPopLayer, inPane });
  // ── The ZOOM: how this page arrives and leaves ───────────────────────────────────────────────
  // Up here because the back-swipe drives the collapse too. Where it lands is this page's own
  // (`destBound` below).
  const {
    edgeCommitting,
    zoom,
    zoomArmed,
    zoomClosing,
    zoomRadiusClosing,
    dragX,
    dragY,
    homeAt,
    zoomSource,
    hero,
    heroShiftX,
    heroShiftY,
    onZoomThumbPainted,
    startZoom,
    isZoomStarted,
    closeLayer,
    heroCentred,
    zoomGeomNoSource,
    zoomSourceAlive,
    zoomMaskStyle,
  } = usePageZoom({
    id,
    depth,
    width,
    height,
    nativePush,
    handedOff: revealIn,
    markEntranceSettled,
    leaveOnce,
    routeBackHeld,
    hasLeft,
  });
  // A drag that commits to the reader: the worklets have animated `progress` there themselves, and
  // the reader page takes over from where they left it. Closes over nothing but JS, so the gesture
  // worklets can `runOnJS` it.
  const commitRead = useCallback(() => {
    traceJS('reveal', 'commit', { toReader: true });
    openReaderPage();
  }, [openReaderPage]);
  // Details sliding up over the reader that brought them up (see SplitHandoff).
  useEffect(() => {
    if (revealIn) progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }));
    // Mount-only: a page takes its hand-off once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The strip is the top of the details PAGE, so pulling the page down past its top rubber-bands
  // with the strip in it, and a release far enough down opens the reader page (pullReleaseWatch,
  // onDetailsScrollEndDrag). The pull only counts once the offset CROSSES the top, so the bounce of
  // an earlier pull still settling can't arm it.
  //
  // The details list's own scrolling, in the same timeline as the gestures. This is how a trace
  // distinguishes "the scroller took the touch stream" from "nothing claimed it": scroll offset
  // moving between a BEGAN and a missing START is the native recognizer winning the contest.
  const scrollTraceGate = useMemo(() => traceGate(), []);
  useAnimatedReaction(
    () => detailsScrollOffset.value,
    (off, prevOff) => {
      traceThrottled(scrollTraceGate, 60, 'details.scroll', 'offset', { y: off, active: detailsActiveSV.value });
      if (!IS_IOS) return;
      if (!detailsActiveSV.value || closingSV.value) {
        // A commit's animation owns `progress` now; the leftover bounce must not re-engage.
        pullEngagedSV.set(false);
        return;
      }
      if (off >= 0) pullEngagedSV.set(false);
      else if ((prevOff ?? 0) >= 0) pullEngagedSV.set(true);
    },
    [detailsScrollOffset, detailsActiveSV, pullEngagedSV, closingSV, scrollTraceGate],
  );
  const onDetailsScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      traceJS('details.scroll', 'endDrag', { y: e.nativeEvent.contentOffset.y });
      if (!IS_IOS) return;
      // The UI-thread release watcher (pullReleaseWatch below) usually lands this commit first,
      // and has already stood the page down then. This JS path is the fallback for when those
      // touches weren't observed.
      if (!detailsActiveSV.get() || closingSV.get()) return;
      if (e.nativeEvent.contentOffset.y <= -PULL_COMMIT_PX) openReaderPage();
    },
    [detailsActiveSV, closingSV, openReaderPage],
  );

  // Where `progress` stood when a drag took it: the drag maps RELATIVE to it, so one that begins
  // mid-animation carries on from there instead of snapping to the drag's absolute position.
  const progressStartSV = useSharedValue(0);
  const panBeganSV = useSharedValue(false);

  // Band pan. The strip (the reader band at the top of the details page) opens the reader the same
  // way the page's own pull does: a tap, or, where the move is drawn (see SplitHandoff), a DOWNWARD
  // drag that slides the whole details page down under the finger. On iOS the strip only takes a
  // tap: what it opens is a pushed page, not something to drag in.
  const bandPan = useMemo(() => {
    const span = headerSpan;
    const pan = Gesture.Pan()
      .enabled(splitDrawn)
      .onUpdate((e) => {
        if (!detailsActiveSV.value) return;
        if (!panBeganSV.value) {
          panBeganSV.set(true);
          progressStartSV.set(progress.value);
        }
        const toward = e.translationY;
        progress.set(Math.max(0, Math.min(1, progressStartSV.value - toward / span)));
      })
      .onEnd((e) => {
        if (!detailsActiveSV.value) return;
        const toward = e.translationY;
        const towardVelocity = e.velocityY;
        const open = releaseCommitted(toward, towardVelocity, span * REVEAL_COMMIT_FRACTION);
        detailsActiveSV.set(!open);
        // The reader page picks a committed drag up from here (see SplitHandoff).
        if (!(open && handsStripOff)) {
          progress.set(withTiming(open ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        }
        if (open) runOnJS(commitRead)();
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
    pan.activeOffsetY([-20, 20]).failOffsetX([-15, 15]);
    return pan;
  }, [splitDrawn, handsStripOff, headerSpan, panBeganSV, progressStartSV, progress, detailsActiveSV, commitRead]);

  // Pull pan — the page's pull past its top, for platforms without the native rubber-band (the iOS
  // path is the reaction above). It shares the vertical axis with the details' own scroller, so it
  // activates MANUALLY: only a clearly-downward drag with the content at its top pulls the page
  // down; everything else fails fast and the list scrolls.
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const returnPan = useMemo(() => {
    return Gesture.Pan()
      .enabled(!IS_IOS)
      .manualActivation(true)
      .onTouchesDown((e) => {
        const t = e.allTouches[0]!;
        touchStartX.set(t.x);
        touchStartY.set(t.y);
      })
      .onTouchesMove((e, mgr) => {
        const t = e.allTouches[0]!;
        const dx = t.x - touchStartX.get();
        const dy = t.y - touchStartY.get();
        if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) {
          mgr.fail();
          return;
        }
        if (dy < -16) {
          mgr.fail(); // scrolling the details content up
          return;
        }
        if (dy > 16) {
          if (detailsScrollOffset.get() <= 1) mgr.activate();
          else mgr.fail();
        }
      })
      .onUpdate((e) => {
        if (!detailsActiveSV.value) return;
        if (!panBeganSV.value) {
          panBeganSV.set(true);
          progressStartSV.set(progress.value);
        }
        progress.set(Math.max(0, Math.min(1, progressStartSV.value - e.translationY / headerSpan)));
      })
      .onEnd((e) => {
        if (!detailsActiveSV.value) return;
        const close = releaseCommitted(e.translationY, e.velocityY, headerSpan * REVEAL_COMMIT_FRACTION);
        detailsActiveSV.set(!close);
        // The reader page picks a committed drag up from here (see SplitHandoff).
        if (!(close && handsStripOff)) {
          progress.set(withTiming(close ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        }
        if (close) runOnJS(commitRead)();
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
  }, [
    handsStripOff,
    headerSpan,
    panBeganSV,
    progressStartSV,
    progress,
    touchStartX,
    touchStartY,
    detailsScrollOffset,
    detailsActiveSV,
    commitRead,
  ]);

  // ── The zoom's DESTINATION: this page's own hero cover, measured ─────────────────────────────
  // The library takes this from a `Transition.Boundary.View` in the destination screen and its whole
  // zoom is built around the pairing — the destination's copy of the picture is what lands on the
  // tapped card, which is why its demo reads as the thumbnail itself expanding. Aligning to anything
  // else (the reader band, as the first cut of this port did) puts unrelated content in the
  // card-shaped window and the connection to the thumbnail is lost.
  //
  // The tapped card's shape, handed to the details so its hero cover opens at the same aspect —
  // which is what keeps the destination bound honest for a bridge whose covers aren't 2:3.
  // See `coverAspect` in SeriesDetailsHost.
  const heroAspectSeed = hero && hero.height > 0 ? hero.width / hero.height : undefined;
  const [destBound, setDestBound] = useState<ZoomRect | null>(null);
  const onHeroCoverRect = useCallback(
    (rect: ZoomRect) => {
      // Only the FIRST report, and only before the geometry is committed: the cover box re-lays out
      // as its aspect settles, and moving the destination mid-flight would visibly jump. What the
      // latch does NOT freeze is where that box has since scrolled to — the geometry carries the
      // scroll offset separately, on the UI thread (see zoomBoundShift).
      if (isZoomStarted()) return;
      setDestBound((prev) => prev ?? rect);
    },
    [isZoomStarted],
  );
  // The entrance waits for that measurement — the library does the same, holding the pair until
  // both ends have reported. Invisible here: the page is at opacity 0 until the spring starts, so
  // a frame or two of waiting just shows the untouched grid. A deadline caps it, after which the
  // transition falls back to the library's own no-destination behaviour (see zoomGeom).
  //
  // ARMING matters as much as waiting. A measurement reports a view's rect AFTER every
  // ancestor transform, so measuring the cover while the page is already scaled hands back a
  // shrunken rect — and a destination smaller than the source inverts the scale, which is the page
  // starting large and settling down to its real size. So the page stays at IDENTITY (invisible,
  // opacity 0) until the bound is in; only then do the transform and the mask engage. That is what
  // the library means by keeping a component at its base layout for pre-animation measurement.
  useEffect(() => {
    if (destBound) startZoom();
  }, [destBound, startZoom]);
  useEffect(() => {
    // No source rect at all (deep link, web): nothing to align to, so don't wait for anything.
    if (!zoomSource) {
      startZoom();
      return;
    }
    const t = setTimeout(startZoom, ZOOM_BOUND_WAIT_MS);
    return () => clearTimeout(t);
    // Mount-only entrance — `zoomSource` never changes for an instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android hardware back leaves: a drilled layer back to its parent series, the root back to
  // whatever it was opened over. Layer handlers register after their parent's (mounted later), so
  // BackHandler's LIFO order naturally gives the topmost instance the event. (Android-only API —
  // react-native-web's BackHandler stub rejects addEventListener.) A reader page over these details
  // registers later still, so it takes the event first (see SeriesSplit).
  useEffect(() => {
    if (Platform.OS !== 'android' || !isTop) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [isTop, closeLayer]);
  // Escape is the chevron, as is the desktop shell's mouse back button (which arrives as Escape,
  // see lib/desktop-commands). Only the TOP layer answers: when every layer listened, one press
  // popped the whole stack.
  useEffect(() => {
    if (!IS_WEB || !isTop || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      closeLayer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop, closeLayer]);
  // Back-swipe: the native stack's pop gesture, recreated — off iOS the route is a contained
  // transparent modal, which doesn't get the real one. A decisive rightward drag ANYWHERE on the
  // details (full-surface, like the platform's full-screen pop) starts the COLLAPSE under the
  // finger, and on release finishes it from wherever it got to. It no longer slides the page off
  // sideways: the drag scales the page down in place, with resistance on the drag axis and a loose
  // follow on the cross axis, exactly as the reader's own swipe-away treats a page — and then hands
  // that scale straight into the gallery collapse. This is the library's zoom/drag.ts model.
  //
  // The back-swipe recipe. FULL-SURFACE, not edge-only — a rightward drag anywhere on the details
  // goes back, the way a full-screen pop gesture does. What counts as an activation is
  // lib/back-swipe's, declarative (activeOffsetX/failOffset*), for the reasons written there.
  //
  // It is built ONCE PER PLATFORM, and which one is live is decided by `.enabled` below: on native
  // the copy composed with the list's scroller, on web the screen-level one. A device trace is what
  // settled that — it used to be both at once, and the two spent every drag cancelling each other.
  //
  // Why the native copy has to ride the scroller: the details surface is almost entirely a native
  // vertical scroll view, and UIKit force-fails any recognizer not allowed to run simultaneously
  // with a scroll view that has claimed the touch. A cross-detector `simultaneousWithExternalGesture`
  // relation did NOT reliably bind on device, so the simultaneity is declared where RNGH is built to
  // honor it: `detailsScrollGesture` below is `Gesture.Simultaneous(Gesture.Native(), <this pan>)`
  // attached BY the list's own detector (threaded down via PullListWiring.scrollGesture) — one
  // detector, both tags assigned in one attach, the relation internal to the composition.
  //
  // Every callback below carries an explicit `'worklet'` — REQUIRED, because the chain is rooted at
  // `backSwipePan(...)` rather than `Gesture.Pan()` and Reanimated's plugin only auto-workletizes
  // the latter. See lib/back-swipe for what a demoted gesture costs.
  const makeBackSwipePan = useCallback((tag: string) => {
    // The trace's throttle window, kept with the gesture rather than the component so the two
    // platform copies (and any future one) can't share a window and hide each other's samples.
    const updateGate = traceGate();
    // Did this gesture ACTIVATE? onFinalize fires either way — for a drag that was rejected before
    // it ever started as much as for one that ran — and almost everything there (settling the page,
    // handing scrolling back) is only correct for one that ran.
    const ranHere = makeMutable(false);
    // Where the finger was when the gesture ACTIVATED, so the page is dragged from there rather
    // than from touch-down. RNGH reports `translationX` from the touch, not from activation, so
    // without this every pixel travelled before it activates lands on `zoom` in the first frame
    // after. At the current 10px threshold that would be a small jump; it mattered far more under
    // the old rule, which could deliberate for most of a swipe and then apply the whole distance at
    // once, leaving the release with nothing left to animate.
    const originX = makeMutable(0);
    const originY = makeMutable(0);
    // Whether this drag's opening stretch made it a back-swipe — see BACK_SWIPE_DEGREES.
    const qualified = backSwipeShape();
    const settle = () => {
      'worklet';
      // Traced because settling is the only thing on this surface that can cancel a committed
      // collapse, so a trace showing an instant release must show whether it ran.
      trace(tag, 'settle', { zoom: zoom.value, committing: edgeCommitting.value });
      zoomClosing.set(false);
      zoom.set(withSpring(1, SPRING_BACK));
      dragX.set(withSpring(0, SPRING_BACK));
      dragY.set(withSpring(0, SPRING_BACK));
    };
    // The committed collapse, behind the same one-way `edgeCommitting` door the search layer's
    // slideOut uses. The door matters because a second write to `zoom` CANCELS the first spring, and
    // a cancelled Reanimated animation still fires its callback — so a duplicate commit would run
    // the collapse's callback on the frame the finger lifted and the page would simply be gone.
    // (That symptom turned out to have a different cause here — see onFinalize — but the guard is
    // still the right shape, and a one-way latch read across callbacks is the read that works.)
    const commit = (velocityX: number) => {
      'worklet';
      trace(tag, 'commit', { vx: velocityX, zoom: zoom.value, already: edgeCommitting.value });
      if (edgeCommitting.value) return;
      edgeCommitting.set(true);
      // Homing starts here, from wherever the drag got to — see the reader's commit for why the
      // drag is left frozen rather than sprung back.
      homeAt.set(Math.max(0.001, zoom.value));
      // Read STRAIGHT back — and on device this reports FALSE. `commit.latched readback=n` is what
      // a real trace says: a shared-value write is not visible to a read later in the SAME worklet
      // invocation, though it is visible to the next one (which is why the guard above still works
      // across gestures). Nothing here depends on it any more — onFinalize asks `success` instead
      // — but the probe stays, because anything that ever reaches for this latch inside one
      // callback will silently get the stale answer.
      trace(tag, 'commit.latched', { readback: edgeCommitting.value });

      // Resume from exactly where it was slid to: the collapse and the follow both spring from
      // their current values, so the page carries on from that spot into the card. Hand the throw
      // over too — the pan's velocity is in points per second and `zoom` moves one unit per
      // `width * ZOOM_DRAG_TRAVEL` points, so this is the same motion continuing rather than a
      // fresh spring starting from rest at the release point.
      zoom.set(
        withSpring(0, { ...ZOOM_OUT_SPRING, overshootClamping: true, velocity: -zoomThrowSpeed(velocityX, width, zoom.value) }, (finished) => {
          // Traced only. This used to leave as well, gated on `finished` — which is redundant with
          // the reaction (a completed spring writes exactly 0, which is what the reaction watches
          // for) and was the second half of the double-pop: two callers off one frame, each seeing
          // an unset latch. One caller is a better guarantee than a better latch.
          trace(tag, 'collapse.done', { finished: !!finished, zoom: zoom.value });
        }),
      );
    };
    // The shared activation criteria (lib/back-swipe). Everything after it is this surface's own:
    // a back-swipe here drives the gallery collapse, not a slide. Whether the details are the side
    // on screen is checked in each callback (`detailsActiveSV`, see the note on returnPan).
    return backSwipePan(tag)
      // Activation = this gesture owns the screen; the list must stop scrolling under it.
      .onStart((e) => {
        'worklet';
        // BEFORE the gate, always: "activated but every callback no-oped on detailsActive" and
        // "never activated" are different diagnoses and must not look the same in the log.
        trace(tag, 'START', { tx: e.translationX, ty: e.translationY, active: detailsActiveSV.value });
        if (!detailsActiveSV.value) return;
        ranHere.set(true);
        originX.set(e.translationX);
        originY.set(e.translationY);
        resetBackSwipeShape(qualified);
        runOnJS(setSwipeLocked)(true);
        // The finger owns the page's position for as long as it is down (see `zoomHoming`).
        homeAt.set(-1);
        // A drag IS a collapse, so it uses the collapse's cross-fade ranges from the first frame.
        zoomClosing.set(true);
        zoomRadiusClosing.set(true);
      })
      .onUpdate((e) => {
        'worklet';
        if (!detailsActiveSV.value) return;
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        traceThrottled(updateGate, 60, tag, 'update', { tx, ty, zoom: zoom.value });
        trackBackSwipeShape(qualified, tx, ty);
        const travel = width * ZOOM_DRAG_TRAVEL;
        // RIGHTWARD ONLY, and the clamp has to be on the follow as well as the collapse. The
        // gesture can only ACTIVATE rightward (`backSwipePan`'s activeOffsetX/failOffsetX), but
        // `tx` is measured from the activation point, so a finger that starts right and then comes
        // back left goes negative — and the collapse was already clamped while the follow was not.
        // The page slid left, and the mask, cover and flying copy went with it: the whole dismissal
        // playing out on the wrong side of the screen, aimed at a card it was never going to reach.
        const forward = Math.max(0, tx);
        // ONE resisted distance drives both the size and the position (AGENTS.md, Zoom transitions).
        const held = zoomDragFollow(forward, ZOOM_BACK_SWIPE_FOLLOW_REACH * travel, ZOOM_BACK_SWIPE_FOLLOW_GRIP);
        zoom.set(1 - Math.min(1, held / travel));
        dragX.set(held);
        // The cross axis rides the forward one PROPORTIONALLY, not as an on/off gate. Vertical play
        // is earned by horizontal travel: none at rest, all of it by the distance that would commit
        // the dismissal, linear in between. Two things fall out of that. A page dragged back toward
        // the left arrives with its vertical offset already gone, instead of holding an offset to
        // the last pixel and then snapping — which is what a gate at `forward > 0` did, one frame
        // wide but the whole height of the drift. And the further out the page is, the more it can
        // be steered, which is the only place steering means anything: near the left it is going
        // back to where it started, and there is nothing to aim.
        const lead = Math.min(1, forward / (width * DISMISS_COMMIT_FRACTION));
        dragY.set(zoomCrossAxisDrag(ty, height) * lead);
      })
      .onEnd((e) => {
        'worklet';
        trace(tag, 'END', {
          tx: e.translationX - originX.value,
          ty: e.translationY - originY.value,
          vx: e.velocityX,
          vy: e.velocityY,
          shape: qualified.value,
          zoom: zoom.value,
          active: detailsActiveSV.value,
          committing: edgeCommitting.value,
          ran: ranHere.value,
        });
        if (!detailsActiveSV.value) return;
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        // Two questions, and BOTH have to say yes: was this a back-swipe at all (did its opening
        // stretch stay horizontal — activation could only see the first ten points, see
        // lib/back-swipe), and did it go far enough. A drag that opened diagonal followed the finger
        // and springs back, which is the right outcome for one: it was never going anywhere.
        //
        // Finish from exactly where the finger left it — the spring starts at the current value, so
        // there is no seam between the dragged part and the animated part.
        if (
          backSwipeStayedHorizontal(tx, ty, e.velocityX, e.velocityY, qualified) &&
          releaseCommitted(tx, e.velocityX, width * DISMISS_COMMIT_FRACTION)
        )
          commit(e.velocityX);
        // …and a losing copy must not settle over a commit the winner just made, hence the check
        // here as well as in onFinalize.
        else if (!edgeCommitting.value) settle();
      })
      .onFinalize((_e, success) => {
        'worklet';
        // `success` is the single most valuable field in the whole trace: false here with no
        // preceding START is a recognizer that was FAILED or CANCELLED, which is a completely
        // different bug from one whose offsets were never satisfied.
        trace(tag, 'FINALIZE', { ok: !!success, ran: ranHere.value, committing: edgeCommitting.value, zoom: zoom.value });
        // `success` — NOT `edgeCommitting` — is what says whether onEnd already decided this drag.
        // onFinalize exists here for ONE case: a drag that was cancelled before it could be
        // released, which must not leave the page part-collapsed. When the gesture ended normally,
        // onEnd has already either committed or settled, and anything done here is a second opinion
        // on a decision that was made.
        //
        // It used to ask `edgeCommitting` instead, and a device trace caught that read coming back
        // FALSE in this callback on the same frame the commit set it true — so `settle` ran over a
        // committed collapse, cancelled its spring, and a cancelled Reanimated animation still
        // fires its callback. The callback is what leaves. That is what "the release finishes
        // instantly" was, and `success` doesn't depend on a cross-callback read to get it right.
        if (ranHere.value && !success) settle();
        // Only a gesture that actually drove may unlock the list — otherwise every rejected drag
        // would hand scrolling back, including one rejected mid-swipe while another is driving.
        if (ranHere.value) runOnJS(setSwipeLocked)(false);
        ranHere.set(false);
        // NOTE: `edgeCommitting` is deliberately NOT cleared. It means "this instance is leaving",
        // which is a one-way door — clearing it let a second onFinalize (the other copy's, whose
        // ordering is not guaranteed) fall through to `settle` after the commit.
      });
  }, [
    width,
    height,
    dragX,
    dragY,
    edgeCommitting,
    zoomRadiusClosing,
    detailsActiveSV,
    homeAt,
    zoom,
    zoomClosing,
  ]);
  // `traceOn` is a DEP on purpose: backSwipePan only attaches its touch observers while the trace
  // is recording, so flipping the toggle has to rebuild the gestures for the change to take.
  const traceOn = useGestureTraceEnabled();
  // THE back-swipe, and NATIVE ONLY.
  //
  // There used to be a second copy on the screen-level detector, alongside this one riding the list
  // — the theory being that the list copy covers the scroller and that one covers the chrome around
  // it. A device trace killed it. Across ~20 attempts the screen-level copy activated ZERO times,
  // and in every failed attempt BOTH copies finalized unsuccessfully in the same millisecond, right
  // as the drag reached the activation threshold — with `dy` of one or two pixels, so nothing in
  // the criteria had failed. That is what an ancestor detector and a descendant detector reaching
  // for the same touch on the same frame looks like: they are not declared simultaneous with each
  // other, so each cancels the other and the swipe dies at exactly the moment it should have
  // started. The swipes that DID work were the fast ones, where one copy crossed the threshold a
  // frame before the other could contest it. So there is one back-swipe: the copy composed with the
  // scroller, which is the only one that ever won.
  //
  // WEB has no back-swipe at all. The screen-level copy survived there for a while (nothing to
  // fight, since `detailsScrollGesture` is undefined on web) — but a page dismissed by dragging is
  // a touch idiom, and on web the series sits in a pane you leave by clicking the chevron or by
  // picking somewhere else in the rail. Not merely disabled — not BUILT: a permanently-disabled
  // gesture still rebuilds when its deps change, and a rebuilt gesture costs a full
  // re-serialization of its callbacks (measured below). Dead weight that bills on every settle is
  // worse than dead weight.
  //
  // Held separately from the composition below because the rails inside the details need to name it
  // — they declare that THIS waits for THEM, which is the one relation keeping a rail scrollable now
  // that the back-swipe activates at the same distance a scroller claims at (see BackSwipeBoundary).
  //
  // ── Gated by `detailsActiveSV` inside the worklets, never by `.enabled` ──────────────────────
  // Rebuilding a gesture gives it a fresh `gestureId`, and RNGH reacts to that by re-serializing
  // EVERY callback closure into its `animatedHandlers` shared value (GestureDetector/updateHandlers.js),
  // on the JS thread, in a microtask right after the commit. A device CPU profile put that at ~67ms
  // of `createSerializable`, and since this gesture is also the context value the rails read, its
  // new identity dragged another ~99ms of `propagateParentContextChanges` through the details
  // subtree behind it. `traceOn` stays a dep because it changes the gesture's SHAPE (see
  // backSwipePan) and only ever flips from a Settings screen, where a re-serialization costs nothing.
  const detailsBackSwipe = useMemo(
    // Tagged with DEPTH. Every instance used to log as plain `series.list`, which is fine until
    // three of them are stacked — and the bugs that most need a trace are exactly the ones where
    // the question is which instance reacted.
    // Nor on a pushed card, whose edge swipe is the navigation controller's (useNativePush).
    () => (IS_WEB || nativePush ? null : makeBackSwipePan(`series.list@${depth}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn, depth, nativePush],
  );
  const detailsScrollGesture = useMemo(
    () => (detailsBackSwipe ? Gesture.Simultaneous(Gesture.Native(), detailsBackSwipe) : undefined),
    [detailsBackSwipe],
  );
  // iOS pull release, caught ON the UI thread. The commit used to ride onScrollEndDrag alone,
  // which reaches JS a frame or two AFTER the rubber-band bounce starts — and in that window the
  // engaged follow tracked the bounce BACKWARD, so the details visibly jumped against the
  // commit's direction before animating away. This observer never activates (manual activation,
  // no activate() call) — it just watches the touches the details list is scrolling with, and on
  // the release of a committed-depth pull starts the commit animation in the same frame.
  // onScrollEndDrag stays as the fallback for the same commit (see onDetailsScrollEndDrag's
  // detailsActiveSV guard); if iOS ever stops delivering these touches mid-scroll, behavior
  // degrades to exactly the old path.
  const pullReleaseWatch = useMemo(() => {
    return Gesture.Pan()
      .enabled(IS_IOS)
      .manualActivation(true)
      .onTouchesUp(() => {
        if (!detailsActiveSV.value || !pullEngagedSV.value || closingSV.value) return;
        if (detailsScrollOffset.value <= -PULL_COMMIT_PX) {
          pullEngagedSV.set(false);
          detailsActiveSV.set(false);
          runOnJS(commitRead)();
        }
      });
  }, [detailsActiveSV, pullEngagedSV, closingSV, detailsScrollOffset, commitRead]);
  const detailsGestures = useMemo(
    () => Gesture.Race(returnPan, pullReleaseWatch),
    [returnPan, pullReleaseWatch],
  );

  // ── The zoom: MASK + CONTENT TRANSFORM ───────────────────────────────────────────────────────
  // A port of react-native-screen-transitions' `navigation.zoom({ target: 'bound' })' (the
  // transition the React Navigation "building custom screen transitions" post demonstrates). Its
  // shape, and the reason both earlier attempts here looked wrong:
  //
  // There is NO flying copy of anything. The DESTINATION SCREEN ITSELF is scaled and translated
  // so that its own hero bound lands exactly on the source rect, and a MASK — a rounded rect
  // growing from the source rect to the full screen — is what you actually see it through. That
  // pairing is the whole trick. Scaling the page with no mask (attempt one) put a page-shaped
  // rectangle over a card-shaped hole; flying a separate thumbnail to a made-up destination
  // (attempt two) had to inflate past anything real and then dissolve down into the strip, which
  // is the pop on expand. With the mask there is nothing to hand over: one object, one motion.
  //
  // WHICH destination, of the three in `ZoomDest`, depends on what is actually on screen.
  //
  // The measured hero cover (`cover`) is the right one only while the page is still showing it,
  // and `page` stands in until it has been measured.
  //
  // Scrolled PAST the cover only its POSITION is wrong. The bound follows the scroll (`zoomBoundShift`), so a collapse begun from
  // halfway down the chapter list aimed at a box hundreds of points above the top edge and dragged
  // the whole page up to meet it: the page scrolling itself away under the finger, which is not a
  // zoom of anything. The cover's SIZE is still exactly right, though — it is what the collapse's
  // scale is derived from, and it is the size the picture ought to arrive at. So that case takes
  // `cover-offscreen`, which keeps the size and centres it: the page swipes away and a cover-sized
  // picture shrinks into the card, the same shrink `cover` gives, just not out of a shared element.
  // Aiming at `page` there instead (which is what this did first) kept the shrink but ballooned the
  // copy to full screen width, so the thing that faded in was far bigger than any cover ever is.
  //
  // The two cover-derived geometries exist together or not at all; `zoomBoundOnScreen` picks
  // between them per collapse.
  const zoomGeomCover = useMemo(
    () => (hero && destBound ? computeZoomGeom(hero, { kind: 'cover', bound: destBound }, width, height) : null),
    [hero, destBound, width, height],
  );
  const zoomGeomOffCover = useMemo(
    () => (hero && destBound ? computeZoomGeom(hero, { kind: 'cover-offscreen', bound: destBound }, width, height) : null),
    [hero, destBound, width, height],
  );
  const zoomGeomPage = useMemo(
    () => (hero ? computeZoomGeom(hero, { kind: 'page' }, width, height) : null),
    [hero, width, height],
  );
  /** For the render rather than for a frame of the transition: whether to mount the flying copy at
   *  all, and the layout rect it starts at. Any geometry answers both, and the animated style
   *  overwrites that rect in the same commit. */
  const zoomGeom = zoomGeomCover ?? zoomGeomPage;

  /**
   * Whether the cover is still on screen — i.e. whether a collapse aims at `cover` or at
   * `cover-offscreen`. LATCHED, because every frame of ONE collapse has to answer it the same way.
   * Written only while the page is at rest (`zoom` at the top); from the first frame of a drag it
   * holds whatever it said when the finger went down; a choice read live off the scroll would swap
   * destinations mid-collapse several times a second.
   */
  const zoomBoundOnScreen = useSharedValue(true);
  /** The scroll offset at which the cover is half off the top — past it, it stops being a place
   *  worth flying to and only its size is still worth keeping. Plain JS: the bound and the inset are
   *  both state, so the reaction only ever compares two numbers. */
  const zoomBoundLostAt = destBound ? destBound.y + destBound.height * (1 - ZOOM_BOUND_MIN_VISIBLE) - insets.top : 0;
  useAnimatedReaction(
    () => (zoom.value >= COLLAPSE_ARMED ? detailsScrollOffset.value : null),
    (offset) => {
      if (offset !== null) zoomBoundOnScreen.set(offset <= zoomBoundLostAt);
    },
    [zoomBoundLostAt],
  );

  // THE CONTENT. The whole page, scaled about its own centre (which is the screen centre) and
  // translated onto the source rect, fading in over the first slice of the travel — the library's
  // `ZOOM_FOCUSED_ELEMENT_OPEN_OPACITY_RANGE`, which is what cross-fades it with the real card
  // still sitting underneath the transparent modal.
  //
  // The `- mask` terms are the correction for the mask being an ancestor. The page sits at the
  // mask's origin M, so every point of it is already displaced by M before any transform; since
  // the page is screen-sized its own centre is numerically the screen centre, which makes that
  // displacement a pure translation, and a window-space "scale s about the screen centre, then
  // translate T" is reproduced locally by translating T - M.
  // The back-swipe's drag rides here too: its follow adds to the translate and its shrink
  // multiplies the scale, so a dismissal drag and the collapse it hands into are one motion.
  const zoomPageStyle = useAnimatedStyle(() => {
    const q = Math.max(0, zoom.value); // see zoomMaskStyle
    // Before arming: base layout, so the destination cover measures its true untransformed rect.
    if (!zoomArmed.value) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
    // Which destination this collapse is aimed at, latched at its first frame — see
    // `zoomBoundOnScreen`. All three are the same shape, so nothing below needs a second path.
    const geom = pickZoomGeom(
      zoomSourceAlive.value,
      zoomBoundOnScreen.value,
      zoomGeomNoSource,
      zoomGeomCover,
      zoomGeomOffCover,
      zoomGeomPage,
    );
    const h = (zoomSourceAlive.value ? hero : heroCentred) ?? hero;
    if (!geom || !h) {
      // No source rect (deep link, web): no mask, no alignment — just the small centred zoom.
      // Same three transform entries as every other branch: reanimated wants one stable style
      // shape per view, and this branch and the unarmed one above can both run for one instance.
      return {
        transform: [
          { translateX: dragX.value },
          { translateY: dragY.value },
          { scale: NO_ORIGIN_SCALE + (1 - NO_ORIGIN_SCALE) * q },
        ],
      };
    }
    const box = zoomMaskBox(h, heroShiftX.value, heroShiftY.value, q, width, height);
    // Scale: normally the base content scale modulated by the drag's shrink. Once the finger has
    // let go of a dismissal it becomes the finishing Bézier instead — from the scale the page was
    // released at, down to the collapsed scale, biased by the release velocity.
    const scale = geom.s + (1 - geom.s) * q;
    // The vertical alignment is corrected for how far the details have SCROLLED since the bound was
    // measured (see zoomBoundShift). Moving the destination anchor UP by `shift` moves the
    // translation that lands it on the card DOWN by `s * shift` — the anchor is scaled before it is
    // translated, so the correction is scaled too. Nothing else in here changes: `s` is a ratio of
    // sizes, and the mask travels between the card and the screen, neither of which scrolls.
    const shift = zoomBoundShift(geom, detailsScrollOffset.value);
    // NOTE the compensation uses the UNDRAGGED mask origin. The mask sits at `box + drag` and the
    // page at `target - box` inside it, which puts the page at `target + drag` in window space:
    // mask and content displaced by exactly the same amount, so the window keeps framing the same
    // part of the page however far it is dragged.
    //
    // The homing is NOT in here. It is the mask's alone (`zoomDetach`), because the page is the
    // mask's child and compensating for the mask's origin is what keeps the two locked together —
    // put `home` on this target instead and the page slides out from under its own window, which
    // clips whatever it is meant to be framing.
    return {
      transform: [
        // heroShift is added to the page's own target as well as the mask's origin. The mask offset
        // cancels out of the page's absolute position, so shifting only the mask moves the window
        // without moving what's behind it.
        { translateX: (geom.tx + heroShiftX.value) * (1 - q) - box.left },
        { translateY: (geom.ty + geom.s * shift + heroShiftY.value) * (1 - q) - box.top },
        { scale },
      ],
    };
  }, [zoomGeomNoSource, zoomGeomCover, zoomGeomOffCover, zoomGeomPage, hero, heroCentred]);

  // The two halves of the cross-fade. The page's own opacity is separated from its transform so
  // the thumbnail copy can ride that same transform (it is a sibling INSIDE the transformed page,
  // laid out at the destination bound — which means it starts life exactly on the tapped card and
  // arrives exactly on the page's cover, with no geometry of its own to keep in sync).
  const zoomContentFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    // The destination decides the CLOSE, because it decides whether anything is underneath this
    // page while it leaves — see ZOOM_CONTENT_FADE_CLOSE_OFFCOVER. Picked the same way the copy
    // picks its own range, off the same latched flag, so the two halves of the cross-fade cannot
    // end up describing different destinations.
    const geom = pickZoomGeom(
      zoomSourceAlive.value,
      zoomBoundOnScreen.value,
      zoomGeomNoSource,
      zoomGeomCover,
      zoomGeomOffCover,
      zoomGeomPage,
    );
    // `no-source` draws no copy at all, so the page carries the collapse there whichever surface
    // is leaving; every other destination has a copy arriving, and the reader's arrives later.
    const closing =
      geom?.kind === 'no-source'
        ? ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE
        : geom?.kind === 'cover-offscreen'
          ? ZOOM_CONTENT_FADE_CLOSE_OFFCOVER
          : ZOOM_CONTENT_FADE_CLOSE;
    const range = zoomClosing.value ? closing : ZOOM_CONTENT_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  }, [zoomGeomNoSource, zoomGeomCover, zoomGeomOffCover, zoomGeomPage]);
  const zoomThumbStyle = useAnimatedStyle(() => {
    // Which destination this collapse is aimed at, latched at its first frame — see
    // `zoomBoundOnScreen`. All three are the same shape, so nothing below needs a second path.
    const geom = pickZoomGeom(
      zoomSourceAlive.value,
      zoomBoundOnScreen.value,
      zoomGeomNoSource,
      zoomGeomCover,
      zoomGeomOffCover,
      zoomGeomPage,
    );
    const base = geom?.thumb ?? { x: 0, y: 0, width: 0, height: 0 };
    if (!zoomArmed.value) {
      // Same style SHAPE as the branch below — reanimated wants one per view, and both can run for
      // one instance.
      return {
        left: base.x,
        top: base.y,
        width: base.width,
        height: base.height,
        opacity: 0,
        borderRadius: hero ? hero.radius : 0,
        transform: [{ translateY: 0 }],
      };
    }
    const q = Math.max(0, zoom.value);
    // NOT DRAWN AT ALL for `no-source`. The copy's entire job is to be the shared element between
    // the page and the card — it is what lands ON the card, opaque, while the page underneath has
    // already gone. With the card removed there is nothing to land on, and it would instead sit
    // fully opaque in the middle of the screen at q = 0 and then blink out with the page: a cover
    // appearing from nowhere purely to disappear. Better to never draw it and let the page carry
    // the whole collapse (see ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE) than to fly a picture to a place
    // nothing is arriving at.
    if (geom?.kind === 'no-source') {
      return {
        left: base.x,
        top: base.y,
        width: base.width,
        height: base.height,
        opacity: 0,
        borderRadius: hero ? hero.radius : 0,
        transform: [{ translateY: 0 }],
      };
    }
    const closing = geom?.kind === 'cover-offscreen' ? ZOOM_THUMB_FADE_CLOSE_OFFCOVER : ZOOM_THUMB_FADE_CLOSE;
    const range = zoomClosing.value ? closing : ZOOM_THUMB_FADE_OPEN;
    // The copy has to READ as the thumbnail it came off, corner included — 10pt on a grid card, 6
    // on a History/Activity row (see ZoomOrigin). This
    // rect rides the page's transform, so divide that scale out to hold the on-screen radius
    // steady rather than letting it grow with the page. (The library gets this for free: it moves
    // the real source view, which simply keeps its own radius under the tracked scale.)
    const s = geom ? geom.s + (1 - geom.s) * q : 1;
    let rect = base;
    if (geom && hero && geom.kind === 'cover-offscreen') {
      // FILL THE WINDOW. This destination's copy has no real cover to be the size of — the page's
      // own has scrolled away — so the only thing it can honestly be the size of is the window it
      // is arriving in. Left at the page's scale it shrank far more slowly than the window did
      // (62% of its width at the fade's start, 79% by the end), which reads as a cover sitting
      // inside the frame rather than as the frame becoming the cover.
      //
      // Divide the window's width back out through the page's scale, since this rect is in PAGE
      // coordinates and the page's transform is applied over it. Nothing moves: `end` is centred on
      // the page for this destination, and the page's target puts that centre on the window's
      // centre at every `q` (both run from the card's centre to the screen's, linearly), so a rect
      // kept centred stays centred. The landing is untouched too — at q = 0 the window IS the card,
      // so this resolves to exactly the rect it used to be.
      const onScreen = hero.width + (width - hero.width) * q;
      const w = onScreen / Math.max(s, 0.01);
      const h = w / Math.max(base.width / base.height, 0.01);
      rect = { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
    }
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: interpolate(q, range, [1, 0], Extrapolation.CLAMP),
      borderRadius: (hero ? hero.radius : 0) / Math.max(s, 0.01),
      // The SCROLL CORRECTION, which only `cover` ever has (`zoomBoundShift` returns 0 for the
      // others). The copy is laid out on the destination bound, so this is INSIDE the page, in the
      // same coordinates the bound was measured in, where "the cover moved up by `shift`" is
      // exactly `-shift`. Its counterpart in zoomPageStyle carries the same shift the other way,
      // which is what keeps the copy landing on the card at q = 0 and on the real cover at q = 1.
      //
      // Nothing else moves the copy. `cover-offscreen` used to slide in along its own path from
      // behind the mask edge, on the theory that a picture with nowhere real to start should arrive
      // rather than appear; at any timing that was still legible it read as a second animation
      // riding the collapse. Waiting until the window is cover-card sized (see
      // ZOOM_THUMB_FADE_CLOSE_OFFCOVER) settles it without moving anything.
      transform: [{ translateY: -zoomBoundShift(geom, detailsScrollOffset.value) }],
    };
  }, [zoomGeomCover, zoomGeomOffCover, zoomGeomPage, hero, width, height]);
  // The flying copy draws the series cover: the route's `cover` param is the tapped card's own URL.
  const zoomThumbUri = useResolvedAsset(cover);

  // ── The details top bar — the SHARED TopBar, crossfaded with scroll ──────────────────────────
  // DETAILS MODE ONLY: transparent over the strip (just a floating back button, matching TopBar's
  // own button position), crossfading to the standard opaque bar as the content scrolls up to
  // meet it, and fading out through an expand. The EXPANDED reader keeps the old reader's own
  // ReaderToolbar untouched — fully transparent chrome, exactly the pre-experiment look; the two
  // occupy the same slot and fade through the transition, so it reads as one bar swapping its
  // content. `barSolid` mirrors the crossfade for pointer routing.
  const topBarHeight = useTopBarHeight();
  const barOnOffset = Math.max(1, headerTopInset - (insets.top + topBarHeight));
  const [barSolid, setBarSolid] = useState(false);
  useAnimatedReaction(
    () => detailsScrollOffset.value > barOnOffset - 4,
    (solid, prev) => {
      if (solid !== prev) runOnJS(setBarSolid)(solid);
    },
    [barOnOffset],
  );
  const headerBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(detailsScrollOffset.value, [barOnOffset - 24, barOnOffset + 16], [0, 1], Extrapolation.CLAMP),
  }), [barOnOffset]);
  // The back chevron (TopBarSwitch's `persistent` slot): its COLOR crossfades, theme text over
  // the details, white over the page, and it fades out as a drag carries the strip toward the
  // reader page, which has its own.
  const backPersistStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.4, 0.8], [0, 1], Extrapolation.CLAMP),
  }));
  const backThemeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [0, 1], Extrapolation.CLAMP),
  }));
  const backWhiteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [1, 0], Extrapolation.CLAMP),
  }));

  // The reader FRAME travels only for the strip centering: while collapsed it rises by half its
  // hidden height so the strip window shows the page's vertical CENTER (not its top edge),
  // sliding back to natural position as it expands. A dismissal does not move it either — the
  // collapse moves the whole page, and the reader's dark surface stays put and fades.
  const readerCardStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: (-(height - bandH) / 2) * progress.value }] }),
    [height, bandH],
  );
  // The details page's motion, three coupled pieces:
  //  - headerLayerStyle: the whole details layer (background sheet + content) slides DOWN and off
  //    the screen as the reader expands — the details scroll down out of visibility.
  //  - headerSheetBgStyle: the opaque page background (whose top edge + gradient seam IS the strip
  //    boundary) rides the list's own scroll offset, so the strip behaves as the top of the page:
  //    scrolling down slides the page up over the strip until the seam parks at the screen top;
  //    pulling past the top (negative offset, the native rubber-band) slides the page down 1:1
  //    with the finger, growing the strip — the gradual reveal.
  //  - headerBandStyle: the strip's touch overlay follows the same occlusion, so it never blocks
  //    content once the seam has scrolled past it.
  const headerLayerStyle = useAnimatedStyle(() => {
    const off = detailsScrollOffset.value;
    // Travel far enough to clear the screen from wherever the page's TOPMOST visible artifact
    // currently sits. At rest that's the seam gradient's upper edge (bandH - SHEET_FADE_H — the
    // title reaches up into the seam, so clearing only the background's top would leave the title
    // and half the gradient peeking at the bottom of the expanded reader). Scrolling moves the
    // sheet up by `min(off, bandH)` (headerSheetBgStyle), and the seam rides ABOVE its top edge, so
    // the seam's upper edge keeps rising until the sheet's own travel stops at `bandH` — past the
    // point where it crosses the screen top. Capping this term where the seam merely REACHES the
    // top (bandH - SHEET_FADE_H, as it did) left up to SHEET_FADE_H of gradient at the bottom of
    // the reader for any tap below the first screen of details — every page thumbnail.
    const seamTopRest = bandH - SHEET_FADE_H;
    const travel = height - seamTopRest + Math.min(Math.max(off, 0), bandH);
    return { transform: [{ translateY: (1 - progress.value) * travel }] };
  }, [height, bandH]);
  const headerSheetBgStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: -Math.min(detailsScrollOffset.value, bandH) }] }),
    [bandH],
  );
  const headerBandStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: -Math.min(Math.max(detailsScrollOffset.value, 0), bandH) }] }),
    [bandH],
  );
  // The collapsed reader's heavy fade — "almost like a faded out background image".
  const headerReaderFadeStyle = useAnimatedStyle(() => ({ opacity: 0.55 * progress.value }));
  const readerTintStyle = useAnimatedStyle(() => ({
    opacity: 0.18 * Math.min(1, progress.value / FADE_WINDOW),
  }));
  // The details content's fade/scale, weighted toward the front of a reveal (complete within
  // FADE_WINDOW of the travel), matched by the tint above on the reader.
  const detailsContentStyle = useAnimatedStyle(() => {
    const reveal = Math.min(1, progress.value / FADE_WINDOW);
    return {
      opacity: 0.45 + 0.55 * reveal,
      transform: [{ scale: 0.96 + 0.04 * reveal }],
    };
  });

  // ── The BACKDROP's dim (see lib/series-backdrop.ts) ───────────────────────────────────
  // How much of the screen this page currently covers: the `zoom`, which the back-swipe drives too.
  // Depth 0 ONLY: a drilled layer sits over its parent series inside this same modal, and the tabs
  // behind the whole modal must not respond twice to what is, to them, one open page. Nor a pushed
  // card: nothing shows behind one, and UIKit has taken the screen beneath away regardless.
  useAnimatedReaction(
    () => {
      return zoom.value;
    },
    (covered) => {
      if (depth === 0 && !inPane && !nativePush) seriesReaderDim.set(covered);
    },
    [depth, inPane, nativePush],
  );
  // Belt and braces: nothing may strand the backdrop dimmed if this screen goes away without its
  // exit animation finishing (a deep link replacing the route, a dev reload). The hold's release
  // does that reset, and ALSO tells the watchdog nobody owns the dim any more — the reset above is
  // one JS-thread write against a value the reaction above writes every frame, and on its own it
  // has no way to notice when it loses that race (see lib/pushback-watchdog).
  useEffect(() => {
    if (depth > 0 || inPane || nativePush) return;
    return holdSeriesBackdrop();
  }, [depth, inPane, nativePush]);

  // ── The strip, and the details' intents ─────────────────────────────────
  const paneRef = useRef<ReaderPaneHandle>(null);
  // The strip follows what the reader page records: the pane takes its spot once, at mount, and
  // only a new chapter remounts it.
  const previewStart = target?.start;
  useEffect(() => {
    if (typeof previewStart === 'number') paneRef.current?.goTo(previewStart, false);
  }, [previewStart]);
  const navigation = useNavigation<ClosingNavigation>();
  useEffect(() => {
    // A cancelled swipe brings the page back through the same events, closing: false.
    const offs = [
      navigation.addListener('transitionStart', (e) => closingSV.set(e.data.closing)),
      navigation.addListener('transitionEnd', (e) => {
        if (!e.data.closing) closingSV.set(false);
      }),
      navigation.addListener('gestureCancel', () => closingSV.set(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [navigation, closingSV]);
  // Verify this chapter's collected pages against the page list we already fetched — repairs the
  // ones the source shifted and seeds the indices the heart reads. See use-chapter-reconcile.
  useChapterReconcile(bridgeId, id, visiblePage?.chapterId ?? target?.chapterId, pages);
  // A chapter or a page picked here goes to the reader page; the strip stays where the history says
  // until reading there moves it.
  const openChapterFromDetails = useCallback(
    (v: Chapter) => {
      if (v.id === targetChapterId) {
        openReaderPage();
        return;
      }
      openReaderPage({
        chapterId: v.id,
        chapterName: v.name,
        start: resume?.chapterId === v.id ? (resume.lastPage ?? 0) : 0,
        picked: true,
      });
    },
    [targetChapterId, resume, openReaderPage],
  );
  const openPageFromDetails = useCallback(
    (pageIndex: number) => {
      openReaderPage(target ? { ...target, start: pageIndex, picked: true } : { start: pageIndex, picked: true });
    },
    [openReaderPage, target],
  );
  // The Read button/cover: the strip already sits at the same resume point Read would compute.
  const startReadingFromDetails = useCallback(() => openReaderPage(), [openReaderPage]);

  const scheme = useActiveColorScheme();
  const seriesTitle = series?.title ?? title ?? id ?? 'Reader';

  // Same "<Bridge> / <Title>" the /series TopBar shows (shared truncation rule).
  const topBarSeries = series?.title ?? title;
  const topBarBridgeName = series?.bridge ?? bridge;
  const headerBarTitle = topBarSeries
    ? topBarBridgeName
      ? `${topBarBridgeName} / ${truncateTopBarTitle(topBarSeries)}`
      : truncateTopBarTitle(topBarSeries)
    : (topBarBridgeName ?? '');

  // The reveal tint + the header strip's heavy fade, over the PAGES but UNDER the bottom chrome —
  // they render inside ReaderPane between the readers and the navigator/pill (or after the
  // error/loading placeholder), so a partial reveal never washes out the scrubber and skip
  // buttons the way it briefly did when these sat above the whole pane.
  const dimOverlays = (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.readerTint, readerTintStyle]} />
      {/* The collapsed strip's heavy fade — toward the THEME background (not black), so the
          strip reads as a faded-out image and the title over the seam stays legible in both
          themes. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, headerReaderFadeStyle]}
      />
    </>
  );

  // iOS: the system bar, through the route's options: transparent over the cover, the glass
  // material and the title arriving where the custom bar goes solid, the navigation theme's tint.
  // Only the top instance sets them (they are the route's, shared by every layer), and they mount
  // only while it is top, so a layer that becomes top again re-applies them: Stack.Screen's effect
  // runs on mount, and the toolbar unregisters its item on unmount. Inside a tab the route is the
  // tab stack's own pushed card (useNativePush), whose back button is the system's, the one the
  // tab's leading item morphs into. At the root the route these options reach is the `index` of the
  // nested stack (app/series/_layout), never the contained transparent modal around it:
  // react-native-screens remounts a modal's content when its `headerShown` flips, as the search
  // layer flips it; a nested root has no back of its own, hence the toolbar chevron.
  const nativeBar =
    NATIVE_HEADER && isTop ? (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            headerShadowVisible: false,
            headerBackVisible: nativePush,
            // Not a pushed card, nothing for UIKit to pop: the edge is the page's own back-swipe.
            gestureEnabled: nativePush,
            title: barSolid ? headerBarTitle : '',
            headerTitle: barSolid ? headerBarTitle : '',
            headerBlurEffect: barSolid ? 'systemChromeMaterial' : undefined,
            headerTintColor: navTheme.colors.primary,
          }}
        />
        {!nativePush ? (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Go back" onPress={closeLayer} />
          </Stack.Toolbar>
        ) : null}
      </>
    ) : null;
  // Elsewhere: the shared TopBar (back-less: transparent over the strip, opaque once scrolled)
  // under a persistent chevron above the band overlay, so its taps win.
  const topChrome = (
    <TopBarSwitch
          mode="details"
          persistent={
            NATIVE_HEADER ? null : (
              <Animated.View
                pointerEvents="box-none"
                style={[styles.headerBackWrap, { top: insets.top, height: topBarHeight }, backPersistStyle]}>
                <Pressable
                  testID="series-page.header-back"
                  // A drilled layer's chevron slides it back out to the parent series; the modal
                  // root's pops the route.
                  onPress={closeLayer}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  style={styles.headerBackBtn}>
                  <Animated.View style={backWhiteIconStyle}>
                    <ChevronLeftIcon color="#fff" />
                  </Animated.View>
                  <Animated.View style={[StyleSheet.absoluteFill, styles.headerBackBtn, backThemeIconStyle]}>
                    <ChevronLeftIcon color={theme.text} />
                  </Animated.View>
                </Pressable>
              </Animated.View>
            )
          }
          bars={{
            // Under the native bar (iOS) the details have no custom bar at all.
            details: NATIVE_HEADER ? null : (
              <Animated.View
                testID="series-page.header-topbar"
                pointerEvents={barSolid ? 'box-none' : 'none'}
                style={[styles.headerBarWrap, headerBarStyle]}>
                {/* left: an empty slot — the persistent chevron above IS the back button. */}
                <TopBar title={headerBarTitle} left={<View />} />
              </Animated.View>
            ),
          }}
        />
  );

  return (
    // Plain (transparent) root — the route is a contained transparent modal, so a dismissal can
    // fade the layers out over the screen beneath. The details layer supplies the opaque fill.
    <View style={styles.container}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} hidden={false} verticalBarBehaviorIOS="automatic" />

      {/* THE MASK — the rounded window the page is seen through, growing from the tapped card's
          cover box to the whole screen (see zoomMaskStyle). At rest it IS the screen, so it clips
          nothing that was ever visible. */}
      <LeavingMask committing={edgeCommitting} leave={leaveOnce} style={[styles.zoomMask, zoomMaskStyle]}>
      {/* …THE PAGE inside it, scaled and aligned so its own cover lands on that card box (see
          zoomPageStyle). Transform only — the fade lives on the wrapper below, so the thumbnail
          copy further down can ride this same transform without fading with it. */}
      <Animated.View style={[styles.zoomPage, { width, height }, zoomPageStyle]}>
      {/* …and the page's CONTENT, which is the half of the cross-fade that fades IN. `leaving`
          drops touches the instant an exit starts, so a page on its way out can't be tapped and
          can't swallow a tap meant for the grid behind it. */}
      <Animated.View style={[StyleSheet.absoluteFill, zoomContentFadeStyle]}>

      {/* The details PAGE, in front of the (static) reader: a full-screen layer whose opaque
          background starts at the band, so the strip is the top of the page; a drag toward the
          reader page slides the whole layer off, uncovering the strip already full-screen
          beneath it. */}
      <GestureDetector gesture={detailsGestures}>
        <Animated.View
          testID="series-page.details-card"
          style={[styles.detailsLayer, { width, height }, styles.headerLayer, headerLayerStyle]}>
          {/* The page's opaque background + gradient seam — the strip boundary. It rides the
              list's scroll offset (see headerSheetBgStyle) so it scrolls away under the content
              like any page header, and grows the strip under a pull past the top. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.headerSheetBg,
              { top: bandH, height, backgroundColor: theme.background },
              headerSheetBgStyle,
            ]}>
            {/* Ease-in stops: a two-stop linear gradient shows a visible edge where it starts
                over the reader — ramp in slowly at the top so the strip melts into the page.
                (theme.background is 6-digit hex, so alpha suffixes compose.) */}
            <LinearGradient
              colors={[`${theme.background}00`, `${theme.background}2E`, `${theme.background}9E`, theme.background]}
              locations={[0, 0.45, 0.78, 1]}
              style={styles.sheetFade}
            />
          </Animated.View>
          {/* The content scrolls over the transparent strip window — SeriesBody itself paints
              no background, so the faded reader shows through above the seam. */}
          <Animated.View style={[styles.detailsContent, detailsContentStyle]}>
            {/* Everything below can yield the back-swipe to a horizontal scroller of its own. */}
            <BackSwipeGestureContext.Provider value={detailsBackSwipe}>
            <SeriesDetailsHost
              bridgeId={bridgeId}
              id={id}
              title={title}
              bridge={bridge}
              cover={cover}
              isDirect={isDirect}
              width={width}
              topInset={headerTopInset}
              sharedValues={sharedValues}
              onScrollEndDrag={onDetailsScrollEndDrag}
              onStartReading={startReadingFromDetails}
              onOpenChapter={openChapterFromDetails}
              onOpenPage={openPageFromDetails}
              scrollGesture={detailsScrollGesture}
              scrollEnabled={!swipeLocked}
              onHeroCoverRect={onHeroCoverRect}
              coverAspectSeed={heroAspectSeed}
              saveKeyEnabled={IS_WEB && !!isTop}
            />
            </BackSwipeGestureContext.Provider>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* The strip's dark backing: full screen, never moving. OUTSIDE the strip-centering frame
          below: inside it, the backing rode the frame's translate up and uncovered the screen
          bottom at low progress, a dark bar through the seam gradient whenever a drag held the
          page near the reader side. */}
      <Animated.View pointerEvents="none" style={[styles.readerSurface, { width, height }]} />

      {/* The strip: the reader's page, beneath the details. Its keys stay on the details. */}
      <Animated.View
        testID="series-page.reader-card"
        {...focusSkip}
        style={[styles.readerFrame, { top: 0, width, height }, readerCardStyle]}>
          {error ? (
            <>
              {/* A source or a bridge that is gone is the details page's to say. */}
              {!pagesGone && !missingBridge ? (
                <View style={styles.centerFill}>
                  <RetryBlock message={error} onRetry={refetch} />
                </View>
              ) : null}
              {dimOverlays}
            </>
          ) : !readerReady ? (
            // No "Loading…": the strip is a quiet background (the per-page % indicator, once pages
            // exist, is ReaderPage's and stays).
            dimOverlays
          ) : (
            <ReaderPane
              onVisiblePage={setVisiblePage}
              key={target.chapterId ?? DIRECT_CHAPTER_ID}
              ref={paneRef}
              pages={pages}
              segments={NO_SEGMENTS}
              onRelabel={noop}
              start={target.start}
              width={width}
              height={height}
              bridgeId={bridgeId}
              seriesId={id}
              seriesTitle={seriesTitle}
              seriesCover={series?.cover}
              chapterId={target.chapterId}
              chapterName={target.chapterName}
              picked={!!target.picked}
              chaptered={!isDirect}
              // The reader page records the reading; the strip only shows where it stands.
              recordProgress={false}
              hasPrevChapter={false}
              hasNextChapter={false}
              onCrossChapter={noop}
              onSkipChapter={noop}
              chromeVisible={false}
              onToggleChrome={noop}
              onShowChrome={noop}
              onHoldChrome={noop}
              onZoomChange={noop}
              onScrubActive={noop}
              overlay={dimOverlays}
              // A decorative background: it loads ONLY the page on screen (no warm-ahead, render
              // window of 1).
              standby
              entering={!entranceSettled}
              inLibrary={inLibrary}
              keyboard={false}
              glass={pushSettled}
            />
          )}
      </Animated.View>

      {/* The split's zoom, both ends at the strip's resting rect: the details' strip is the source,
          and the reader page lines up the same stretch of its page with it, so the strip is what
          grows into the reader and what the reader shrinks back into. */}
      {stripZoomHref ? (
        <View pointerEvents="none" style={[styles.stripZoom, { width }]}>
          <ZoomSource href={stripZoomHref} onId={setStripZoomId} style={{ width, height: headerTopInset }} />
        </View>
      ) : null}

      {/* The reader strip's touch surface — tap to read full screen, or drag the details page
          away under the finger (DOWN in paged, LEFT in webtoon — see horizontalReveal). It rides
          the same occlusion as the strip (headerBandStyle), so it scrolls off with the page and
          never blocks content. */}
      <GestureDetector gesture={bandPan}>
        {/* Ends where the content starts (the title reaches up into the seam), so it never
            covers anything tappable. */}
        <Animated.View style={[styles.dockBand, { height: headerTopInset }, headerBandStyle]}>
          <Pressable
            testID="series-page.header-band"
            {...focusSkip}
            onPress={() => openReaderPage()}
            accessibilityRole="button"
            accessibilityLabel="Read full screen"
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </GestureDetector>

      {/* The top chrome rides the page's own slide: drill entrance, edge swipe, dismissal alike. */}
      {nativeBar}
      {topChrome}

      </Animated.View>

      {/* THE FLYING THUMBNAIL — the other half of the cross-fade, and the reason the motion reads
          as a picture opening rather than a screen resizing. The library transforms the REAL
          source element on the screen underneath to track this path; from inside a modal that view
          is untouchable, so this is a copy of the same cover.
          Laid out at the DESTINATION bound and left to ride the page's transform, which is what
          keeps it honest: at rest that transform puts this rect exactly on the tapped card, and at
          the end exactly on the page's own cover. No second geometry to drift out of sync — the
          one thing it does carry of its own is the scroll correction (zoomThumbStyle's translate),
          and that is the SAME correction the transform takes, not a separate answer to it. The
          mask supplies the rounded card silhouette, so it needs no radius of its own. */}
      {hero && zoomGeom && zoomThumbUri && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.zoomThumb,
            {
              left: zoomGeom.thumb.x,
              top: zoomGeom.thumb.y,
              width: zoomGeom.thumb.width,
              height: zoomGeom.thumb.height,
            },
            zoomThumbStyle,
          ]}>
          {/* onLoad/onError are what release the source card's blanking — until this view has
              pixels the real card underneath is what stands in for it. See `blankSource`. */}
          <Image
            source={{ uri: zoomThumbUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            onLoad={onZoomThumbPainted}
            onError={onZoomThumbPainted}
          />
        </Animated.View>
      )}

      </Animated.View>
      </LeavingMask>
    </View>
  );
}

type ClosingNavigation = {
  addListener(type: 'transitionStart' | 'transitionEnd', cb: (e: { data: { closing: boolean } }) => void): () => void;
  addListener(type: 'gestureCancel', cb: () => void): () => void;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Transparent: the route is a contained transparent modal — the details layer is the opaque
    // fill, and a dismissal fades it out over the screen beneath (see dismissFadeStyle).
    backgroundColor: 'transparent',
  },
  // The zoom's window (see zoomMaskStyle). Absolutely positioned because its whole box is
  // animated; `overflow: hidden` is what makes it a mask rather than just a rounded outline.
  zoomMask: {
    // Box comes entirely from zoomMaskStyle (always explicit numbers) — nothing here, so a
    // percentage base can never race the animated one.
    position: 'absolute',
    overflow: 'hidden',
  },
  // The page inside that window — pinned to the SCREEN's size at the call site, never the mask's,
  // so a shrinking window crops it instead of reflowing it.
  zoomPage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // The flying copy of the tapped cover — positioned at the destination bound INSIDE the page, so
  // the page's own transform carries it from the card to that bound (see the render).
  zoomThumb: {
    position: 'absolute',
    overflow: 'hidden',
    // The card's own cover backing (series-card.tsx `coverBoxClip`), so a cover that hasn't
    // decoded yet reads as the same grey plate rather than a hole onto the page underneath.
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  // The reader's frame + clip. No background on either: the dark reader surface is a SEPARATE
  // static full-screen layer BEHIND the frame (readerSurface), so it keeps covering the screen
  // while the strip-centering translate moves the frame, and a dismissal can dissolve it in
  // place while only the page travels.
  readerFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  readerSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: READER_BACKDROP,
  },
  // The top-bar crossfade layers (see headerBarStyle/headerBackStyle): above the band overlay
  // (zIndex 3) so whichever is visible takes the taps.
  headerBarWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
  },
  headerBackWrap: {
    position: 'absolute',
    left: Spacing.three,
    zIndex: 4,
    justifyContent: 'center',
  },
  headerBackBtn: {
    justifyContent: 'center',
  },
  // The seam: hangs above the details page background's top edge, fading the reader strip down
  // into the page — tall enough that the series title sits at its center.
  sheetFade: {
    position: 'absolute',
    top: -SHEET_FADE_H,
    left: 0,
    right: 0,
    height: SHEET_FADE_H,
  },
  readerTint: {
    backgroundColor: '#000',
  },
  // Touch surface over the reader strip (details mode).
  dockBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
  },
  stripZoom: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // The details layer sits in FRONT of the (static) reader backdrop, transparent above its page
  // background so the reader strip shows through.
  headerLayer: {
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  // The details page's opaque fill — its animated top edge (plus the seam gradient hanging above
  // it) IS the strip boundary.
  headerSheetBg: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  detailsContent: {
    flex: 1,
  },
});
