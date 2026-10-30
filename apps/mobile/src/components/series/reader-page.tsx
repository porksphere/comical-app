import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
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
import { usePushSettled } from '@/components/reader/chapter-navigator';
import { isDesktopPointer, keepZoomLevel } from '@/components/reader/desktop-zoom';
import { isTypingTarget } from '@/lib/key-hold';
import { claimReaderScope, isKey, keyActionOf } from '@/lib/keybindings';
import { TAB_KEY_ACTIONS } from '@/lib/keymap';
import { ReaderBarShade, ReaderToolbar, TRAILING_SLOT_W } from '@/components/reader/reader-toolbar';
import { ZOOM_CONTROL_W, ZoomControl, useZoomControlShown } from '@/components/reader/zoom-control';
import { CollectPageControl, CollectPageShortcut } from '@/components/reader/collect-page-control';
import { SettingsControl } from '@/components/reader/settings-panel';
import { ReaderNativeToolbar } from '@/components/reader/reader-native-toolbar';
import { RetryBlock } from '@/components/retry-block';
import { BridgeMissingNotice } from '@/components/bridge-missing';
import { ThemedText } from '@/components/themed-text';
import { TopBarSwitch } from '@/components/top-bar-switch';
import { Spacing } from '@/constants/theme';
import { seriesGoneReason } from '@/data/api';
import { warmPageImages } from '@/data/warm-pages';
import {
  chapterPagesQuery,
  directPagesQuery,
  historyQuery,
  inLibraryQuery,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID } from '@/data/types';
import { useMissingBridge } from '@/hooks/use-bridges';
import { useChapterReconcile } from '@/hooks/use-chapter-reconcile';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { useReaderSettings, useFitOverride } from '@/hooks/use-reader-settings';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useIsDesktop, useTopBarHeight } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { hideNativeTabBar } from '@/lib/native-tab-bar';
import { LinkAppleZoomTarget, useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import { BACK_ACTIVATE_DOMINANCE } from '@/lib/back-swipe';
import { desktopShell } from '@/lib/desktop-shell';
import { trace, traceGate, traceJS, traceThrottled } from '@/lib/gesture-trace';
import { releaseCommitted, releaseCommittedEitherWay } from '@/lib/gesture-release';
import { useDrillRelatedSeries } from '@/lib/series-nav';
import { useSeriesPaneShowsTop } from '@/lib/series-pane';
import { holdSeriesBackdrop, seriesReaderDim } from '@/lib/series-backdrop';
import { useDimWindowControls, useWindowThemeColor, watchWindowTopEdge } from '@/lib/window-controls';
import { DetailsHint } from '@/components/series/details-hint';
import { LeavingMask } from '@/components/series/leaving-mask';
import {
  COLLAPSE_ACTIVATE_PX,
  DISMISS_COMMIT_FRACTION,
  LIFT_COMMIT_FRACTION,
  LIFT_CORNER_RADIUS,
  NO_ORIGIN_SCALE,
  REVEAL_COMMIT_FRACTION,
  SPRING_BACK,
  ZOOM_BACKDROP_FADE_CLOSE,
  ZOOM_BACKDROP_FADE_OPEN,
  ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE,
  ZOOM_CONTENT_FADE_CLOSE_READER,
  ZOOM_CONTENT_FADE_OPEN,
  ZOOM_DISMISS_DIR_MIN,
  ZOOM_DRAG_FOLLOW_GRIP,
  ZOOM_DRAG_FOLLOW_REACH,
  ZOOM_DRAG_TRAVEL,
  ZOOM_OUT_SPRING_READER,
  ZOOM_THUMB_BIAS_RESTORE_MS,
  ZOOM_THUMB_FADE_CLOSE_READER,
  ZOOM_THUMB_FADE_OPEN,
  computeZoomGeom,
  zoomDragFollow,
  zoomMaskBox,
  zoomThrowSpeed,
} from '@/components/series/page-motion';
import { ReaderPane, type ReaderPaneHandle, WARM_BEHIND } from '@/components/series/reader-pane';
import {
  NO_SEGMENTS,
  type ReadTarget,
  type ReaderSequenceRun,
  type Segment,
  type SeriesReaderParams,
} from '@/components/series/reader-types';
import { SplitClip } from '@/components/series/split-clip';
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

const CHROME_HIDE_MS = 3000;

/** What Tab can land on in the reader's toolbar. */
const FOCUSABLE = 'button, a[href], input, [tabindex]:not([tabindex="-1"])';

// CI-speed override: Maestro steps can outlast the auto-hide, and hidden chrome drops out of the
// accessibility tree.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';

/** A mouse this close to the top of the reader brings the toolbar up, the way a video player's
 *  controls come up under the pointer. A little deeper than the toolbar itself, so the reveal starts
 *  on the way into it. */
const CHROME_HOVER_EDGE = 80;

/** How long a toolbar brought up by hovering outlasts the pointer leaving it. */
const CHROME_HOVER_HIDE_MS = 500;

/**
 * The longest a NEW stitched window will wait for the previous chapter's page list before being
 * created without it (see the `run` machinery).
 *
 * A ceiling, not a delay — both page lists are requested in the same commit, so what is actually
 * being waited on is the gap between two responses already in flight, and a boundary visited before
 * (every neighbour list is fetched eagerly and the query cache is persisted) resolves in the same
 * render and waits for nothing. What the ceiling buys is the case that can't be waited out: a
 * source that is slow or gone. There it spends this much of the "Loading…" already on screen and
 * then goes on without it, rather than holding the reader on a request that may never land.
 */
const PREV_WINDOW_GRACE_MS = 600;

const IS_WEB = Platform.OS === 'web';

const IS_IOS = Platform.OS === 'ios';

/**
 * The reader page of a series, opened from its details, or straight from a reading link, a History
 * row or a collection's saved pages, where it reads the whole album as one `sequence`. It grows out
 * of whatever opened it, the details' strip or a card, and its way back goes to the details
 * (`leaveReaderForDetails`).
 */
export function SeriesReaderPage({
  params,
  depth,
  onPopLayer,
  isTop,
  nativePush,
  sequence,
}: {
  params: SeriesReaderParams;
  depth: number;
  onPopLayer: () => void;
  /** A pushed card whose transitions are the system's (see useNativePush). Never for a layer. */
  nativePush: boolean;
  /** Whether this instance is the top of the stack — the one keyboard back acts on (web). */
  isTop: boolean;
  /** Present = this instance reads a cross-series sequence instead of a chapter. */
  sequence?: ReaderSequenceRun;
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const { width, height } = useViewport();
  const insets = useSafeAreaInsets();
  const mock = useMockActive();
  const fitOverride = useFitOverride();

  const {
    id,
    title,
    bridge: bridgeParam,
    bridgeId,
    cover: coverParam,
    direct,
    chapterId: seedChapterId,
    chapterName: seedChapterName,
    start: seedStart,
    picked: seedPicked,
  } = params;
  const seriesKey = bridgeId && id ? `${bridgeId}:${id}` : null;
  const [settings] = useReaderSettings(seriesKey);
  // Off iOS this page draws the move from its details itself: it grows out of their strip and
  // shrinks back into it, and details brought up in its place slide up over it (see SplitHandoff).
  // On iOS each is a native push over the other (see useNativePush).
  const splitDrawn = !IS_IOS;
  const [splitHandoff] = useState(() => (splitDrawn && seriesKey ? takeSplitHandoff(seriesKey, 'strip') : null));
  const stripFrom = splitHandoff?.kind === 'strip' ? splitHandoff : null;
  const stripReader = stripFrom !== null;
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // ── The visible page — and, in sequence mode, the visible ENTRY ────────────────────────────
  // Lives at this level because the TOOLBAR is rendered here (the pane reports it up through
  // `onVisiblePage`, already chapter-correct across a stitched crossing), and this high up in the
  // component because the identity just below derives from it.
  const [visiblePage, setVisiblePage] = useState<{ pageIndex: number; chapterId: string } | null>(null);
  // The ENTRY the pager currently shows. The pane's flat index IS the sequence index, so this is
  // what the chrome (title, save button, settings sheet) and its Details describe — the instance's
  // own route params only name the entry the album OPENED on.
  const visibleSequenceEntry = sequence
    ? sequence.entries[Math.min(visiblePage?.pageIndex ?? sequence.index, sequence.entries.length - 1)]
    : undefined;

  // ── The series Details opens ───────────────────────────────────────────────────────────────
  // Chapter mode: this instance's own. Sequence mode: the VISIBLE entry's, since the album pager
  // never remounts: a series cross must be as seamless as a stitched chapter crossing, which is to
  // say a plain page turn.
  const detailBridgeId = sequence ? (visibleSequenceEntry?.bridgeId ?? bridgeId) : bridgeId;
  const detailSeriesId = sequence ? (visibleSequenceEntry?.seriesId ?? id) : id;
  const detailTitle = sequence ? visibleSequenceEntry?.seriesTitle : title;
  const detailIsDirect = sequence ? visibleSequenceEntry?.chapterId === DIRECT_CHAPTER_ID : isDirect;

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Chapter list (chaptered series only) — drives resume-or-first resolution and prev/next
  // adjacency for the reader pane. A sequence loads nothing about a series: its chrome describes
  // the visible entry, and an album that wanders through five series must not fetch five series'
  // details on the way.
  const { data: listData } = useQuery(seriesListQuery(ds, mock, bridgeId ?? '', id ?? '', false, !isDirect && !sequence));
  const chapters = listData?.chapters;

  // Library membership — tells the reader pane whether a read also has to keep the reading log's row
  // up to date (see its `record`). The query lives HERE, not in the pane:
  // the pane re-renders on every page sweep, and useQuery's per-render subscription work (query
  // key hashing) is measurable at that cadence.
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, bridgeId ?? '', id ?? ''),
    retry: false,
    enabled: !!bridgeId && !!id && !sequence,
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
  // Reader-first entries seed this from their params, which is what makes the pages query live on
  // the very first commit — no waiting on history, and the request goes out ahead of detail.
  const [override, setOverride] = useState<ReadTarget | null>(() => {
    const parsed = Number(seedStart);
    const at = Number.isFinite(parsed) ? parsed : 0;
    const picked = seedPicked === '1';
    if (seedChapterId) return { chapterId: seedChapterId, chapterName: seedChapterName, start: at, picked };
    if (direct === '1') return { start: at, picked };
    return null;
  });
  // Sequence mode: the target is the sequence itself. `chapterId` is deliberately ABSENT — it
  // would otherwise arm the chapter-pages query, the preferred-group effect, chapter adjacency and
  // the pane's remount key, all of which are chapter machinery a sequence doesn't have. Per-entry
  // chapter identity lives on the VISIBLE entry (see visibleSequenceEntry below), not the target.
  const inSequence = !!sequence;
  const sequenceTarget = useMemo<ReadTarget | null>(
    () => (sequence ? { start: sequence.index } : null),
    // The mount index seeds the pager once; later index changes ride the pager itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once, see above
    [inSequence],
  );
  const target = sequenceTarget ?? override ?? derivedTarget;
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
    data: chapterPagesData = null,
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
    enabled: !!id && (isDirect || !!target) && !sequence,
  });
  // In sequence mode the sequence IS the page list — the chapter query above never runs.
  const pages = sequence ? sequence.uris : chapterPagesData;
  // Series detail for the toolbar/settings gear (placeholder-seeded from the forwarded
  // title+cover). The details beneath subscribe to this same query key, so this costs one fetch.
  const { data: series = null } = useQuery({
    ...seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
    // `!!id` preserves the option's own guard, which this override replaces.
    enabled: !!id && !sequence,
  });
  // ORDERING, and why this query sits HERE rather than at the top of the component. React Query
  // dispatches on mount effects, which run in hook order, so declaration order IS request order
  // for anything enabled on the first commit. The row a reader opens from seeds the target from
  // its own params, so the pages query is live on the first commit and, being declared above, is
  // dispatched first: the page History and Activity tapped to keep reading, then the rest. That
  // matters on device, where the on-device runtime serves everything through one in-process
  // transport and order of arrival is order of service.

  const error = !sequence && queryError ? (queryError as Error).message || 'Failed to load pages' : null;
  // The bridge's own error for a bridge that isn't there is a server path and a Retry that can't work.
  const missingBridge = useMissingBridge(sequence ? undefined : bridgeId);
  const pagesGone = !sequence && seriesGoneReason(queryError) !== undefined;

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
  // `landing` defaults to whichever keeps PAGING continuous: forward
  // lands on page 1, backward on the last page. The navigator's skip buttons pass 'first'.
  // This is the EXPLICIT-jump path (skip buttons, webtoon advance, cold-window edge fallbacks) —
  // it bumps `jumpNonce` so the pane remounts seeded at the landing page. Stitched paged
  // crossings never come through here; they relabel in place (see relabelFromPager).
  const [jumpNonce, setJumpNonce] = useState(0);
  const goAdjacentChapter = useCallback(
    (delta: 1 | -1, landing: 'first' | 'last' = delta === 1 ? 'first' : 'last') => {
      const chapterTo = delta === 1 ? nextChapter : prevChapter;
      if (!chapterTo) return;
      setJumpNonce((n) => n + 1);
      setOverride({ chapterId: chapterTo.id, chapterName: chapterTo.name, start: landing === 'last' ? 'last' : 0 });
    },
    [nextChapter, prevChapter],
  );

  // ── Stitching: the reader's window ───────────────────────────────────────
  // Adjacent chapters' page lists, subscribed eagerly (cache-first; a list is just URLs) so the
  // reader can stitch them into ONE flat list — crossing a chapter boundary is then an ordinary
  // page turn with an in-place relabel, no remount.
  // Every reader stitches now. It was native-paged-only for as long as the pager was the only list
  // that could take a chapter joining in front of the reader without lurching — the others were
  // left crossing chapters by jumping, which is why they never had the paged reader's peek of the
  // page you are about to reach, and why they needed sentinels and buttons to do what scrolling
  // should. The native readers are LegendLists that anchor on the item; the web ones hold the page
  // on screen by key themselves.
  const stitched = !isDirect && !sequence;
  // The level the desktop zoom keeps lasts across page turns and chapters, but not out of the
  // reader.
  useEffect(() => () => keepZoomLevel(1), []);
  // iOS: the system tab bar goes with the pages, which are full-bleed. This page stays mounted
  // under details it pushes, so the bar goes only while it is the page on screen.
  useFocusEffect(
    useCallback(() => {
      if (!NATIVE_HEADER) return;
      return hideNativeTabBar();
    }, []),
  );
  useWindowThemeColor(READER_BACKDROP, 1);
  // Whether the ENTRANCE animation has finished (the zoom spring's completion callback flips it —
  // see startZoom). The zoom scales the WHOLE destination screen behind a growing mask, and a
  // reader-first open whose pages are already cached (a sequence open, a History revisit) would
  // otherwise mount the entire pager — list, cells, warm-ahead — in the very commit the spring
  // starts, on the thread the spring is drawing on. So the pane rides `standby` until this flips:
  // the visible page mounts and paints (it is what the entrance reveals), everything else waits
  // out the flight.
  // Starts SETTLED on web and on a pushed card: there is no entrance there to defer behind (see
  // `startZoom`), so the page has nothing to wait out and the pager may mount in the first commit
  // like anything else.
  const [entranceSettled, setEntranceSettled] = useState(IS_WEB || nativePush);
  const markEntranceSettled = useCallback(() => setEntranceSettled(true), []);
  const pushSettled = usePushSettled();
  // EAGER, deliberately — not deferred behind `standby` like the render window is.
  //
  // A run can only take its previous chapter at the instant it is created (see the window below),
  // so how soon these resolve decides whether the FIRST chapter boundary you read backward across
  // is seamless. Deferring them, as this did for a while, guaranteed they lost that race on every
  // cold open.
  //
  // The cost is two page LISTS — cache-first, and a list is just URLs. It does not mount page cells
  // or warm images: both of those key off `standby` in ReaderPane.
  const { data: prevPages, error: prevPagesError } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', prevChapter?.id ?? ''),
    enabled: stitched && !!id && !!prevChapter,
  });
  const { data: nextPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', nextChapter?.id ?? ''),
    enabled: stitched && !!id && !!nextChapter,
  });

  const { goBack, routeBackHeld, leaveOnce, hasLeft } = usePageLeave({ depth, onPopLayer });
  // ── The ZOOM: how this page arrives and leaves ───────────────────────────────────────────────
  // Up here, though nothing moves it until much further down: the stitching underneath has to read
  // `collapsing`. Where it lands is this page's own (`zoomGeom` below).
  const {
    edgeCommitting,
    zoom,
    zoomArmed,
    zoomClosing,
    zoomRadiusClosing,
    dragX,
    dragY,
    homeAt,
    zoomThumbAspect,
    hero,
    heroShiftX,
    heroShiftY,
    onZoomThumbPainted,
    startZoom,
    closeLayer: collapseIntoCard,
    collapsing,
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
    handedOff: !!splitHandoff,
    markEntranceSettled,
    leaveOnce,
    routeBackHeld,
    hasLeft,
  });

  // The stitched window — the RUN: a segment only joins once its pages are loaded (no holes); it
  // only ever grows AT THE TAIL during one continuous run; landing outside the run starts a fresh
  // one, bumping `runKey` so the pane remounts and seeds from `start` instead of re-anchoring.
  //
  // ── The HEAD of a live run, and why it may grow again ────────────────────────────────────────
  // For a while nothing could ever be added in front of the current position, and the reason was
  // the pager: a FlatList's position is a raw pixel offset and its render window is a range of
  // indices derived from that offset, so putting a chapter in front of the current one moved every
  // page after it by a whole chapter while the offset stayed put. The correction that followed —
  // find the anchored key, scroll there — arrived at the right place with nothing mounted, because
  // the window had been computed from the old position. THAT was the flash on this screen, chased
  // twice from the wrong end (first blamed on the adjacent-chapter queries being deferred, then on
  // their being eager; the arrival TIME was never the problem, the head insert was).
  //
  // The pager is a LegendList now, which holds item sizes BY KEY and anchors a data change on the
  // item rather than on an offset or a view (`maintainVisibleContentPosition={{ data: true }}` —
  // see paged-reader.tsx for the full why). A chapter arriving at the head is absorbed with the
  // page under the reader's thumb left exactly where it is, so the head can grow again: reading
  // backward stays a page turn chapter after chapter instead of turning into a jump at the second
  // boundary.
  //
  // The hold below stays anyway. A window that is right when it is BUILT never has to anchor
  // anything, and the cheapest correction is the one that doesn't happen.
  //
  // ── …and why the window is worth WAITING a beat for ─────────────────────────────────────────
  // Creation being the only moment a run can take its previous chapter makes that moment worth
  // getting right. A run created the instant this chapter's own pages land is a run created into
  // a race: the neighbour's list was requested in the same commit and is usually a beat behind, so
  // the window came out one chapter short and the boundary it was short of was the one the reader
  // was parked on — swipe back from page 1 and there was nothing there to swipe to.
  //
  // So a NEW run holds for the previous chapter's list, and the pane holds with it (`readerReady`
  // below) rather than mounting onto a window that is about to be wrong. Not indefinitely: the
  // hold is capped at PREV_WINDOW_GRACE_MS, past which the run is created without it and the
  // backward boundary falls back to the pager's off-the-end hand-off (paged-reader's `edgeTurn`),
  // which crosses by jumping rather than by turning. The cap is what keeps a slow or dead source
  // from holding the reader: it can cost a moment of the "Loading…" that was already on screen,
  // never the page itself.
  //
  // What it must NOT become is a wait for something already in hand — every neighbour list is
  // fetched eagerly and persisted, so the second visit to a boundary resolves in the same render
  // and holds for nothing at all.
  const [run, setRun] = useState<{ key: number; segs: Segment[] }>({ key: 0, segs: [] });
  // The grace clock, armed the moment a run COULD be created (this chapter's pages are in) and
  // belonging to that chapter, so navigating re-arms it. Keyed by string rather than timestamped so
  // nothing here has to read a clock during render. A chapter whose grace has run out stays run out
  // for the life of this screen, deliberately: by then its neighbour's list has either arrived — in
  // which case it is cached and the next run takes it with no wait at all — or it is not coming,
  // and waiting a second time would buy the same nothing twice.
  const graceKey = pages && stitched ? (targetChapterId ?? DIRECT_CHAPTER_ID) : null;
  const [graceOverFor, setGraceOverFor] = useState<string | null>(null);
  useEffect(() => {
    if (!graceKey) return;
    const t = setTimeout(() => setGraceOverFor(graceKey), PREV_WINDOW_GRACE_MS);
    return () => clearTimeout(t);
  }, [graceKey]);
  const { segments, runKey } = useMemo(() => {
    if (!pages || !stitched) return { segments: NO_SEGMENTS, runKey: run.key };
    const currentId = targetChapterId ?? DIRECT_CHAPTER_ID;
    const prevSeg: Segment | null =
      targetChapterId && prevChapter && prevPages?.length
        ? { id: prevChapter.id, name: prevChapter.name, pages: prevPages }
        : null;
    const nextSeg: Segment | null =
      targetChapterId && nextChapter && nextPages?.length
        ? { id: nextChapter.id, name: nextChapter.name, pages: nextPages }
        : null;

    const at = run.segs.findIndex((s) => s.id === currentId);
    if (at === -1) {
      // The hold (see above). It waits on the RESPONSE, not on a usable segment: a chapter that
      // comes back with no pages, or a request that comes back an error, has answered — there is
      // nothing further to wait for and the run is created without it. `NO_SEGMENTS` — one stable
      // array, not a fresh `[]` — because this return feeds the adjust-state-on-render below, and
      // a new identity every render is an infinite loop.
      //
      // Not knowing yet whether there IS a previous chapter counts as waiting, and that case is
      // not exotic — it is how RESUMING works. A resumed target comes from the reading history,
      // which is local and instant, so the pages request goes out (and can come back) while the
      // chapter LIST is still in flight; until that list lands there is no `prevChapter` to have a
      // page list for, and a run built in that gap is built blind. The same grace covers it.
      const awaitingPrev =
        !!targetChapterId && (!chapters || (!!prevChapter && prevPages === undefined && !prevPagesError));
      if (awaitingPrev && graceOverFor !== currentId) return { segments: NO_SEGMENTS, runKey: run.key };
      const segs: Segment[] = [];
      if (prevSeg) segs.push(prevSeg);
      segs.push({ id: currentId, name: target?.chapterName, pages });
      if (nextSeg) segs.push(nextSeg);
      // Bump the key only when there was a real run to leave, so the very first window doesn't
      // count as a remount.
      return { segments: segs, runKey: run.key + (run.segs.length ? 1 : 0) };
    }
    // Extend at either end. The TAIL is free by construction (nothing before it moves). The HEAD is
    // the list's job, and the reason this file can ask for it at all — see the note above.
    //
    // ── The wobble, and why it isn't a reason to stop asking ─────────────────────────────────────
    // Growing the head of the CONTINUOUS strip visibly nudged the content: a trace caught the window
    // gaining 13 rows, the content height gaining 7427, and the offset gaining 7400 — 27px of drift
    // — then 78 against 36 on the next frame as those rows measured. The obvious reading was that
    // variable row heights make this irreducible (a correction computed against an estimate that
    // isn't true yet), and the obvious fix was to stop growing the head where sizes are unknown.
    //
    // That reading was wrong, and the version number is why. This app was pinned to legend-list
    // 3.3.2; 3.3.3 fixes precisely these two things — "row measurements are applied together in a
    // batch, so item positions don't sometimes move after rendering" and "prepending items with
    // maintainVisibleContentPosition was sometimes flashing the wrong items for one frame". Holding
    // a viewport still across a prepend of unmeasured rows is what the list is FOR; ours simply
    // couldn't yet. So the head grows in both readers, and the fix lives at the version.
    const stale = run.segs[at]!;
    const refreshCurrent = stale.pages !== pages || stale.name !== target?.chapterName;
    // Not while a dismiss is in flight. Growing the strip is the expensive edit in here — the head
    // grow above measures a whole window of new rows and corrects the offset against them — and a
    // neighbour's page list arriving happens to land mid-gesture often, because the same tap that
    // opened the reader requested it. Traced at 187ms of stalled UI thread inside a held collapse,
    // spent extending a reading window the reader is on its way out of. The current chapter still
    // refreshes: that one is what's on screen.
    const addPrev = !collapsing && !!prevSeg && at === 0;
    const addNext = !collapsing && !!nextSeg && run.segs[run.segs.length - 1]!.id === currentId;
    if (!refreshCurrent && !addPrev && !addNext) return { segments: run.segs, runKey: run.key };
    const segs = run.segs.slice();
    if (refreshCurrent) segs[at] = { id: currentId, name: target?.chapterName, pages };
    if (addPrev) segs.unshift(prevSeg);
    if (addNext) segs.push(nextSeg);
    return { segments: segs, runKey: run.key };
  }, [
    run,
    pages,
    stitched,
    targetChapterId,
    target?.chapterName,
    chapters,
    prevChapter,
    prevPages,
    prevPagesError,
    nextChapter,
    nextPages,
    graceOverFor,
    collapsing,
  ]);
  // Catch the run state up DURING render (React's adjust-state-on-render pattern — the merge
  // above returns `run.segs` by identity when there's nothing to add, which is what stops this
  // from looping). `!pages` (a chapter still loading) renders no window at all, but must not wipe
  // the run — the pager is unmounted then and comes back to the same one.
  if (pages && stitched && (segments !== run.segs || runKey !== run.key)) {
    setRun({ key: runKey, segs: segments });
  }

  // Ready to read: the target's own pages, AND — where the pager is stitched — the window they go
  // in. Holding the pane back for the window is the point of the hold above: a pane mounted onto a
  // one-chapter window reads `initialPage` there and then, and no later arrival can move it.
  const readerReady = !!target && !!pages && (!stitched || segments.length > 0);

  // What the reader side has to render, and WHEN it got it. A flash on the first reveal is a
  // question about ordering — whether the reader becomes the visible side before it has pages, and
  // for how long — and that is only answerable against the reveal mark on the same clock. Both
  // halves are traced rather than reasoned about because the difference between "300ms of Loading"
  // and "one frame with nothing opaque behind it" is invisible in source and obvious in a
  // recording.
  useEffect(() => {
    traceJS('reader', 'ready', {
      ready: readerReady,
      target: !!target,
      pages: pages?.length ?? 0,
      segs: segments.length,
    });
  }, [readerReady, target, pages, segments]);

  // The backward jump's destination, warmed. Wherever the previous chapter is not in the reader's
  // window — the window couldn't take it — going back lands on that chapter's LAST page, and the pane's own
  // warm-ahead can't reach it: that walks the window, and this page is outside it by definition. So
  // the screen warms the few pages the jump can land on, and the crossing arrives on an image like
  // any other.
  useEffect(() => {
    if (!stitched || !prevChapter || !prevPages?.length) return;
    if (segments.some((s) => s.id === prevChapter.id)) return;
    warmPageImages(prevPages.slice(-1 - WARM_BEHIND));
  }, [stitched, prevChapter, prevPages, segments]);

  // A stitched crossing settled: flush of the OLD chapter's progress already happened in the pane;
  // this just relabels which chapter is "current" WITHOUT remounting (the pane's key is the run,
  // not the chapter, and the window merge above finds the new current already in `run.segs`).
  const relabelFromPager = useCallback((chapterId: string, chapterName: string | undefined, page: number) => {
    // Marked so a boundary adjustment can be told apart from the window growing around it — the
    // two land within a frame or two of each other and want different fixes. See the vertical
    // reader's `window`/`scroll` marks.
    traceJS('reader', 'relabel', { page });
    setOverride({ chapterId, chapterName, start: page });
  }, []);

  // ── Chrome auto-hide ───────────────────────────────────────────────────────
  // A reader page growing out of the strip fades its chrome in as it opens (see SplitHandoff).
  const [chromeVisible, setChromeVisible] = useState(!stripReader);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeHeldRef = useRef(false);
  // Who is holding it up: a control in use, and the keyboard's focus — kept apart so one letting go
  // doesn't drop the other's hold.
  const chromeHolds = useRef(new Set<'control' | 'focus'>());
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
  // Set while the toolbar is up only because a mouse is near it; anything that shows the toolbar
  // on purpose clears it, and with it the quick hide.
  const hoverShownRef = useRef(false);
  const zoomControlShown = useZoomControlShown();
  const showChrome = useCallback(() => {
    hoverShownRef.current = false;
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  const holdChromeFor = useCallback(
    (holder: 'control' | 'focus', hold: boolean) => {
      hoverShownRef.current = false;
      if (hold) chromeHolds.current.add(holder);
      else chromeHolds.current.delete(holder);
      chromeHeldRef.current = chromeHolds.current.size > 0;
      if (hold) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      } else {
        setChromeVisible(true);
        scheduleHide();
      }
    },
    [scheduleHide],
  );
  const holdChrome = useCallback((hold: boolean) => holdChromeFor('control', hold), [holdChromeFor]);
  useDimWindowControls(!chromeVisible);
  const toggleChrome = useCallback(() => {
    hoverShownRef.current = false;
    setChromeVisible((v) => {
      const nextVisible = !v;
      if (nextVisible) scheduleHide();
      else if (hideTimer.current) clearTimeout(hideTimer.current);
      return nextVisible;
    });
  }, [scheduleHide]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelLeave = () => {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = null;
    };
    const near = () => {
      cancelLeave();
      setChromeVisible((visible) => {
        if (visible && !hoverShownRef.current) return visible;
        hoverShownRef.current = true;
        if (hideTimer.current) clearTimeout(hideTimer.current);
        return true;
      });
    };
    const away = () => {
      if (!hoverShownRef.current || leaveTimer) return;
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (!hoverShownRef.current) return;
        hoverShownRef.current = false;
        setChromeVisible(false);
      }, CHROME_HOVER_HIDE_MS);
    };
    const onEdge = (inside: boolean) => (inside ? near() : away());
    const unwatch = watchWindowTopEdge(CHROME_HOVER_EDGE, onEdge);
    if (unwatch) {
      return () => {
        cancelLeave();
        unwatch();
      };
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.buttons === 0) onEdge(e.clientY < CHROME_HOVER_EDGE);
    };
    window.addEventListener('pointermove', onMove, true);
    return () => {
      cancelLeave();
      window.removeEventListener('pointermove', onMove, true);
    };
  }, []);

  // The keyboard's way into the toolbar (lib/keymap's `reader-controls`): Tab shows it and focuses
  // its first control, it stays up while the focus is in it, Tab and Shift+Tab go round inside it,
  // and Escape hands the keys back to the page. Becoming the reader of the top layer drops whatever
  // focus was left behind on the screen it covers, or Space would press that again.
  const chromeId = useId();
  useEffect(() => {
    if (!IS_WEB || !isTop || typeof document === 'undefined') return;
    const parts = () =>
      [`${chromeId}-back`, `${chromeId}-bar`]
        .map((part) => document.getElementById(part))
        .filter((el): el is HTMLElement => !!el);
    const inside = (el: Element | null) => !!el && parts().some((part) => part.contains(el));
    const controls = () =>
      parts()
        .flatMap((part) => [...(part.matches(FOCUSABLE) ? [part] : []), ...part.querySelectorAll<HTMLElement>(FOCUSABLE)])
        .filter((el) => el.getClientRects().length > 0);
    const stale = document.activeElement;
    if (stale instanceof HTMLElement && stale !== document.body && !inside(stale)) stale.blur();
    const releaseScope = claimReaderScope();

    const onKeyDown = (e: KeyboardEvent) => {
      // A digit must not throw away the chapter being read for another tab.
      if (keyActionOf(e, TAB_KEY_ACTIONS)) return e.stopPropagation();
      const active = document.activeElement;
      if (active instanceof HTMLElement && inside(active)) {
        // Not the shell's mouse Back, which arrives as a synthetic Escape (lib/desktop-commands)
        // and means back.
        if (e.key === 'Escape' && e.isTrusted) {
          e.preventDefault();
          active.blur();
        } else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
          const ring = controls();
          const at = ring.indexOf(active);
          if (ring.length === 0) return;
          e.preventDefault();
          ring[(at + (e.shiftKey ? -1 : 1) + ring.length) % ring.length].focus();
        }
        return;
      }
      if (!isKey(e, 'reader-controls') || isTypingTarget(e.target)) return;
      e.preventDefault();
      showChrome();
      requestAnimationFrame(() => controls()[0]?.focus());
    };
    let focusHeld = false;
    const onFocusChange = () => {
      const held = inside(document.activeElement);
      if (held === focusHeld) return;
      focusHeld = held;
      holdChromeFor('focus', held);
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
      releaseScope();
      if (focusHeld) holdChromeFor('focus', false);
    };
  }, [isTop, chromeId, showChrome, holdChromeFor]);

  // Pinch-zoom / an active scrub both suspend the collapse/dismiss pan (a one-finger drag pans the zoomed
  // page; a scrub owns the finger).
  const [readerZoomed, setReaderZoomed] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubActive = useCallback(
    (active: boolean) => {
      setScrubbing(active);
      holdChrome(active);
    },
    [holdChrome],
  );

  // ── The strip handoff ──────────────────────────────────────────────────────────
  // `progress` is how far the page has gone back into the details' strip: 0 is the reader, 1 the
  // strip. Only a page grown out of the strip moves it (see SplitHandoff), starting where the
  // details left the move.
  const progress = useSharedValue(stripFrom ? stripFrom.progress : 0);
  // Freezes the reader's own drags once an exit animation owns the page.
  const dismissing = useSharedValue(false);
  // The details' strip: what the reader grows out of and shrinks back into.
  const bandH = insets.top + HEADER_BAND;
  // The strip's resting height as SeriesDetailsPage draws it: the rect UIKit's zoom grows out of.
  const stripZoomH = bandH - SHEET_FADE_H / 2 - TITLE_MID;
  // The reader page going back into the strip it grew out of (see SplitHandoff): its bottom edge
  // rises onto the details' strip, and the route pops once there is nothing of it left to see.
  const shrinkToStrip = useCallback(() => {
    if (hasLeft()) return;
    setChromeVisible(false);
    // Freezes the reader's own drags for the way out.
    dismissing.set(true);
    edgeCommitting.set(true);
    progress.set(
      withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }, () => {
        runOnJS(leaveOnce)();
      }),
    );
  }, [hasLeft, dismissing, edgeCommitting, progress, leaveOnce]);
  const drillSeries = useDrillRelatedSeries();
  const leaveReaderForDetails = useCallback(() => {
    if (stripReader) {
      shrinkToStrip();
      return;
    }
    // A sequence's Details are the VISIBLE entry's, opened over the album, which waits underneath
    // where it was: a drilled layer on the root route, a pushed card in a tab.
    if (sequence) {
      const entry: Record<string, string> = {
        id: detailSeriesId ?? '',
        bridgeId: detailBridgeId ?? '',
        title: detailTitle ?? '',
        ...(detailIsDirect && { direct: '1' }),
      };
      if (drillSeries) drillSeries(entry);
      else router.push({ pathname: '/series', params: entry });
      return;
    }
    // Back to the details that pushed it, when they are still there: a reloaded web page has
    // nothing beneath it.
    if (params.from === 'details' && router.canGoBack()) {
      router.back();
      return;
    }
    const next: Record<string, string> = {};
    for (const k of ['id', 'title', 'bridge', 'bridgeId', 'cover', 'direct'] as const) {
      const v = params[k];
      if (typeof v === 'string') next[k] = v;
    }
    if (!splitDrawn) {
      router.push({ pathname: '/series', params: next });
      return;
    }
    // In its place: the details slide up over this reader (see SplitHandoff).
    if (seriesKey) handOffSplit(seriesKey, { kind: 'reveal' });
    router.replace({ pathname: '/series', params: next });
  }, [
    stripReader,
    shrinkToStrip,
    sequence,
    detailSeriesId,
    detailBridgeId,
    detailTitle,
    detailIsDirect,
    drillSeries,
    params,
    router,
    splitDrawn,
    seriesKey,
  ]);

  // The split's move, drawn by the page that arrives (see SplitHandoff).
  useEffect(() => {
    if (stripFrom) {
      const { covered } = stripFrom;
      progress.set(
        withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }, () => {
          runOnJS(markEntranceSettled)();
          runOnJS(covered)();
        }),
      );
      // A frame in, so the chrome fades in with the page rather than landing with its first paint.
      const frame = requestAnimationFrame(() => setChromeVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    // Mount-only: an instance takes its hand-off once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // How far a drag back into the strip travels.
  const headerSpan = Math.max(1, height - bandH);

  // ── The reader's own zoom values (the rest are usePageZoom's) ─────────────────────────────
  /** The reader dismiss's LAUNCH DIRECTION, as a unit vector, latched the first frame the drag has
   *  enough distance to have one. (0, 0) until then, and cleared by every gesture. */
  const dismissDirX = useSharedValue(0);
  const dismissDirY = useSharedValue(0);
  /** How much of the collapse the flying copy should treat as having happened, 0..1. 1 everywhere
   *  except a reader dismiss dragged back the other way — see that gesture's onUpdate, and
   *  `zoomThumbStyle`, which applies this to the copy's OPACITY alone. */
  const zoomThumbBias = useSharedValue(1);

  // Collapse/dismiss pan — wraps the reader, on the cross axis of its scroll: a paged reader grown
  // out of the details' strip goes back into it on a drag up; anything else dismisses — and that
  // dismissal runs THE SAME GALLERY COLLAPSE the chevron runs: mask closing onto the card, page
  // cross-fading out, the thumbnail copy fading
  // in and landing on it. The finger-follow is free and unclamped in 2D and the release decision
  // reads the cross-axis offset alone — what a dismissal must NOT do is fling out along the
  // gesture's own vector, which had nowhere to land. Built inside
  // useMemo like chapter-navigator's pan (the React Compiler lint can't tell worklets from render
  // code).
  // Never under a mouse: a drag there is a PAN of the page, and a pan that set off the return or the
  // dismiss took the reader away mid-read. The desktop has the Details button and Back for those.
  const collapseEnabled = !readerZoomed && !scrubbing && !(IS_WEB && isDesktopPointer());
  // The split reader's swipe away, paged, on iOS. UIKit's zoom dismissal takes the swipe DOWN (the
  // screen's `gestureEnabled`) and carries the page and the bar back into the strip. It never
  // starts on a swipe up, so that half is this pan's: the page lifts and shrinks under the finger,
  // and a committed release runs the same native pop the back button does.
  const swipeAway = nativePush && params.from === 'details' && settings.mode === 'paged';
  const liftY = useSharedValue(0);
  // Each GESTURE is one thing, decided at activation and locked: a drag up on a paged reader grown
  // out of the details' strip is a return into it (progress only); anything else is a dismiss — a
  // free 2D follow in BOTH directions, released on the |cross| decision below, driving the
  // collapse. A new gesture that begins while the page hasn't settled from a previous dismiss drag
  // is always a dismiss — only a settled page goes back into the strip on a swipe.
  const gestureMode = useSharedValue<0 | 1 | 2>(0); // 0 undecided, 1 into the strip, 2 dismiss
  // Where `progress` stood when the gesture locked — drags map RELATIVE to it, so a gesture that
  // begins mid-animation continues the motion from where it is instead of snapping to the drag's
  // absolute position (the "fast-forward" chop under quick successive swipes).
  const progressStartSV = useSharedValue(0);
  const collapsePan = useMemo(() => {
    // Only a reader grown out of the details' strip drags back into it (see SplitHandoff); any other
    // brings them up with its Details button.
    const revealByDrag = settings.mode === 'paged' && stripReader;
    const dismissSpan = settings.mode === 'paged' ? height : width;
    const span = settings.mode === 'paged' ? headerSpan : width;
    {
      const collapseGate = traceGate();
      const pan = Gesture.Pan()
        .enabled(collapseEnabled)
        .onBegin(() => {
          trace('reader.collapse', 'BEGAN');
        })
        .onUpdate((e) => {
          traceThrottled(collapseGate, 60, 'reader.collapse', 'update', {
            tx: e.translationX,
            ty: e.translationY,
            mode: gestureMode.value,
          });
          if (dismissing.value) return;
          const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
          // Lock the gesture's mode at the first REAL movement (web fires its opening updates
          // with translation 0 — deciding on that frame mislabels every drag). A gesture
          // beginning while the page hasn't settled from a previous dismiss drag is always a
          // dismiss gesture.
          if (gestureMode.value === 0) {
            const settled = zoom.value > 0.999 && Math.hypot(dragX.value, dragY.value) <= 1;
            if (!settled) gestureMode.set(2);
            else if (Math.abs(cross) >= 2) {
              // WEBTOON never goes back to the details by dragging — the Details button is the
              // only way, so every drag here is a dismiss. Its cross axis is horizontal (vertical
              // belongs to the scroll), and a horizontal drag that went to the details would be the
              // one gesture on this screen going somewhere other than out.
              gestureMode.set(revealByDrag && cross <= 0 ? 1 : 2);
              progressStartSV.set(progress.value);
            } else return; // no meaningful movement yet
          }
          if (gestureMode.value === 1) {
            progress.set(Math.min(1, Math.max(0, progressStartSV.value + -cross / span)));
            return;
          }
          // A pushed card's only swipe-away is `swipeAway`'s. Otherwise the drag is still claimed, so
          // nothing beneath scrolls on it, but it moves nothing and releases to nothing.
          if (nativePush) {
            if (swipeAway) {
              const reach = ZOOM_DRAG_FOLLOW_REACH * height * ZOOM_DRAG_TRAVEL;
              liftY.set(zoomDragFollow(Math.max(0, -e.translationY), reach, ZOOM_DRAG_FOLLOW_GRIP));
            }
            return;
          }
          // The follow: both axes, feeding the collapse instead of a fling. Distance in ANY
          // direction drives it, since unlike an edge swipe this gesture has no single axis to
          // measure along.
          zoomClosing.set(true);
          zoomRadiusClosing.set(true);
          homeAt.set(-1);
          const travel = dismissSpan * ZOOM_DRAG_TRAVEL;
          const pull = Math.hypot(e.translationX, e.translationY);
          // ONE resisted distance drives both the size and the position, so the spring is the only
          // thing limiting either and they cannot stop at different moments.
          const held = zoomDragFollow(pull, ZOOM_DRAG_FOLLOW_REACH * travel, ZOOM_DRAG_FOLLOW_GRIP);
          zoom.set(1 - Math.min(1, held / travel));
          // Scaling the vector by the resisted/raw ratio, rather than resisting each axis, keeps
          // the page moving along the finger's own direction — this gesture has no primary axis to
          // resist along.
          const hold = pull > 0 ? held / pull : 0;
          dragX.set(e.translationX * hold);
          dragY.set(e.translationY * hold);

          // The COPY follows the FORWARD progress, not the raw distance — because this gesture
          // measures with a hypot, and a hypot cannot tell "further out" from "back through the
          // start and out the other side". Swipe down, come back up past where you began, keep
          // going up: the hypot rises again, so the page shrinks again, and the copy used to fade
          // back in with it. Nothing about that second shrink is an approach to the card.
          //
          // Projecting onto the launch direction separates the two: the projection falls to zero as
          // the finger returns and stays there past it, so the cover fades out on the way back and
          // does not return. Continuous by construction — the bias reaches 0 exactly where the
          // finger reaches its origin, where the copy is transparent anyway — so nothing blinks.
          if (dismissDirX.value === 0 && dismissDirY.value === 0 && pull >= ZOOM_DISMISS_DIR_MIN) {
            dismissDirX.set(e.translationX / pull);
            dismissDirY.set(e.translationY / pull);
          }
          // Before a direction is latched there is nothing to be going the wrong way relative to, so
          // all of the travel counts as forward. Without this the first few pixels of EVERY drag
          // project onto (0, 0) and read as fully reversed — invisible in practice (the copy is at
          // ~1% there) but a lie the moment anyone changes the fade ranges.
          const aimed = dismissDirX.value !== 0 || dismissDirY.value !== 0;
          const forward = aimed
            ? Math.max(0, e.translationX * dismissDirX.value + e.translationY * dismissDirY.value)
            : pull;
          const heldForward = zoomDragFollow(forward, ZOOM_DRAG_FOLLOW_REACH * travel, ZOOM_DRAG_FOLLOW_GRIP);
          zoomThumbBias.set(held > 0 ? heldForward / held : 1);
        })
        .onEnd((e) => {
          trace('reader.collapse', 'END', {
            mode: gestureMode.value,
            vx: e.velocityX,
            vy: e.velocityY,
            dismissing: dismissing.value,
          });
          if (dismissing.value) return;
          if (gestureMode.value === 1) {
            const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
            const crossVelocity = settings.mode === 'paged' ? e.velocityY : -e.velocityX;
            // Same projected release as everywhere else, along the direction that OPENS the
            // details (which is negative `cross`).
            if (releaseCommitted(-cross, -crossVelocity, span * REVEAL_COMMIT_FRACTION)) {
              runOnJS(leaveReaderForDetails)();
            } else {
              progress.set(withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }));
            }
            return;
          }
          if (nativePush) {
            if (!swipeAway) return;
            if (releaseCommitted(-e.translationY, -e.velocityY, height * LIFT_COMMIT_FRACTION)) {
              runOnJS(leaveReaderForDetails)();
              // Back to full size while the pop runs, so the page is where the strip expects it
              // when the zoom lands there.
              liftY.set(withTiming(0, { duration: 250, easing: Easing.out(Easing.cubic) }));
            } else {
              liftY.set(withSpring(0, SPRING_BACK));
            }
            return;
          }
          // The release decision — the shared projection (lib/gesture-release), judged along the
          // direction the page actually travelled, since this one can be thrown off either side.
          //
          // The FINGER's travel, not `dragX/dragY`. Those were the same number until the follow
          // gained its past-floor resistance, and reading them now would make the threshold
          // unreachable: the follow tops out around 160px while DISMISS_COMMIT_FRACTION wants half
          // the span (196px in webtoon, 426px in paged), so a deliberate slow swipe could never
          // commit and only a flick's velocity would dismiss at all. What the user swiped is the
          // question; how far the page was allowed to move in reply is not.
          const crossOffset = settings.mode === 'paged' ? e.translationY : e.translationX;
          const crossVelocityRaw = settings.mode === 'paged' ? e.velocityY : e.velocityX;
          if (!releaseCommittedEitherWay(crossOffset, crossVelocityRaw, dismissSpan * DISMISS_COMMIT_FRACTION)) {
            zoomClosing.set(false);
            zoom.set(withSpring(1, SPRING_BACK));
            dragX.set(withSpring(0, SPRING_BACK));
            dragY.set(withSpring(0, SPRING_BACK));
            return;
          }
          // …and the collapse finishes from wherever the drag left it, into the card. Same springs,
          // same velocity handoff and the same one-way `edgeCommitting` latch as the details page's
          // back-swipe — see there for why a committed collapse must never be settled back.
          dismissing.set(true);
          edgeCommitting.set(true);
          // Whatever the drag did, the page is landing on the card now and must have a picture when
          // it gets there. Timed rather than set: released mid-reversal the copy is at zero, and
          // snapping the bias back would put the cover on screen in one frame.
          zoomThumbBias.set(withTiming(1, { duration: ZOOM_THUMB_BIAS_RESTORE_MS }));
          // Homing starts NOW, from where the finger left it (see `zoomHoming`). The drag values
          // stay frozen at their release positions — `home` is what retires them, on the collapse's
          // own clock, so nothing is still moving them when it lands.
          homeAt.set(Math.max(0.001, zoom.value));
          const throwSpeed = zoomThrowSpeed(Math.hypot(e.velocityX, e.velocityY), dismissSpan, zoom.value);
          zoom.set(
            // overshootClamping: there is nothing past "collapsed", so the spring must not travel
            // through 0 and settle back up to it. No completion callback — leaving is driven by
            // `zoom` actually reaching the card (see the leave reaction in usePageZoom).
            withSpring(0, { ...ZOOM_OUT_SPRING_READER, overshootClamping: true, velocity: -throwSpeed }),
          );
        })
        // Always fires once the gesture resolves (release OR cancel) — the next gesture decides
        // its own mode fresh.
        .onFinalize((_e, success) => {
          if (swipeAway && !success) liftY.set(withSpring(0, SPRING_BACK));
          // A cancelled dismiss drag never reaches onEnd — don't leave the page part-collapsed.
          // Same `success` test as the details page's back-swipe, for the same reason.
          if (gestureMode.value === 2 && !success) {
            zoomClosing.set(false);
            zoom.set(withSpring(1, SPRING_BACK));
            dragX.set(withSpring(0, SPRING_BACK));
            dragY.set(withSpring(0, SPRING_BACK));
            zoomThumbBias.set(withTiming(1, { duration: ZOOM_THUMB_BIAS_RESTORE_MS }));
          }
          gestureMode.set(0);
          // The next drag gets its own launch direction; a stale one would judge it against a
          // gesture that is over.
          dismissDirX.set(0);
          dismissDirY.set(0);
        });
      // The back-swipe's ACTIVATION-side dominance (lib/back-swipe), applied to whichever axis this
      // mode dismisses along: paged drags across the pages' axis (vertical), webtoon across the
      // scroll's (horizontal). The activation half, not the strict release angle — this pan has no
      // release-time second look, so its one gate has to stay generous enough to catch real drags.
      // The DISTANCE stays this surface's own: nothing here is racing a scroller for the claim, so
      // it can afford to ask for more travel before it takes the gesture.
      const cross = Math.round(COLLAPSE_ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);
      if (swipeAway) {
        // Up only, and out of the way the moment a drag heads down: that one is UIKit's.
        pan.activeOffsetY(-COLLAPSE_ACTIVATE_PX).failOffsetY(cross).failOffsetX([-cross, cross]);
      } else if (settings.mode === 'paged') {
        pan.activeOffsetY([-COLLAPSE_ACTIVATE_PX, COLLAPSE_ACTIVATE_PX]).failOffsetX([-cross, cross]);
      } else {
        pan.activeOffsetX([-COLLAPSE_ACTIVATE_PX, COLLAPSE_ACTIVATE_PX]).failOffsetY([-cross, cross]);
      }
      return pan;
    }
  }, [
    settings.mode,
    collapseEnabled,
    nativePush,
    stripReader,
    swipeAway,
    liftY,
    leaveReaderForDetails,
    width,
    height,
    zoomRadiusClosing,
    dismissDirX,
    dismissDirY,
    zoomThumbBias,
    headerSpan,
    gestureMode,
    progressStartSV,
    progress,
    dismissing,
    homeAt,
    zoom,
    zoomClosing,
    dragX,
    dragY,
    edgeCommitting,
  ]);

  // No destination to measure: the computed target, derived from the source rect alone, is where
  // the page lands (see zoomGeom).
  useEffect(() => {
    startZoom();
  }, [startZoom]);

  // The chevron / hardware-back exit: back into the strip this page grew out of, or else into the
  // card it came from.
  const closeLayer = useCallback(() => {
    if (stripReader) {
      if (!routeBackHeld()) shrinkToStrip();
      return;
    }
    collapseIntoCard();
  }, [stripReader, routeBackHeld, shrinkToStrip, collapseIntoCard]);

  // Android hardware back steps back HOME, to the details, before leaving. An album has no home
  // but the collection it came from: its Details open over it, so stepping there would never
  // leave. (Android-only API — react-native-web's BackHandler stub rejects addEventListener.)
  useEffect(() => {
    if (Platform.OS !== 'android' || !isTop) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sequence) closeLayer();
      else leaveReaderForDetails();
      return true;
    });
    return () => sub.remove();
  }, [isTop, sequence, leaveReaderForDetails, closeLayer]);
  // Desktop back steps home the same way — Escape, the chevron, and the shell's mouse back button
  // (which arrives as Escape, see lib/desktop-commands). Not when the desktop pane beneath this
  // reader already shows this series: its details are right there, so stepping home would show
  // them twice, one over the other. A phone-width browser keeps the one-step exit.
  const isDesktop = useIsDesktop();
  const paneShowsThis = useSeriesPaneShowsTop(`${bridgeId ?? ''}:${id ?? ''}`) && depth === 0;
  const backStepsHome = !sequence && (isDesktop || !!desktopShell()) && !paneShowsThis;
  // Escape is the chevron. Only the TOP layer answers: every layer beneath is a whole series page
  // with its own reader, and when each one listened, the reader's fallback popped the route — the
  // whole stack, from three layers up.
  useEffect(() => {
    if (!IS_WEB || !isTop || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      if (backStepsHome) leaveReaderForDetails();
      else closeLayer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop, backStepsHome, leaveReaderForDetails, closeLayer]);
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
  // The page has no cover of its own to land on: it grows out of the card at full size and shrinks
  // back into it (`page`), or, once the card has gone, into the screen's centre (`no-source`).
  const zoomGeom = useMemo(
    () => (hero ? computeZoomGeom(hero, { kind: 'page' }, width, height) : null),
    [hero, width, height],
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
  // A dismissal's drag rides here too: its follow adds to the translate and its shrink multiplies
  // the scale, so the drag and the collapse it hands into are one motion.
  const zoomPageStyle = useAnimatedStyle(() => {
    const q = Math.max(0, zoom.value); // see zoomMaskStyle
    // Before arming: base layout.
    if (!zoomArmed.value) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
    // Latched at the collapse's first frame (see `zoomSourceAlive`); both are the same shape.
    const geom = zoomSourceAlive.value ? zoomGeom : (zoomGeomNoSource ?? zoomGeom);
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
        { translateY: (geom.ty + heroShiftY.value) * (1 - q) - box.top },
        { scale },
      ],
    };
  }, [zoomGeomNoSource, zoomGeom, hero, heroCentred]);

  // The two halves of the cross-fade. The page's own opacity is separated from its transform so
  // the thumbnail copy can ride that same transform (it is a sibling INSIDE the transformed page,
  // laid out at the destination bound — which means it starts life exactly on the tapped card and
  // arrives exactly on the page's cover, with no geometry of its own to keep in sync).
  const zoomContentFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    // `no-source` draws no copy at all, so the page carries the whole collapse there; anywhere else
    // a copy is arriving. Read off the same latched flag as the copy's own range, so the two halves
    // of the cross-fade cannot describe different destinations.
    const geom = zoomSourceAlive.value ? zoomGeom : (zoomGeomNoSource ?? zoomGeom);
    const closing = geom?.kind === 'no-source' ? ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE : ZOOM_CONTENT_FADE_CLOSE_READER;
    const range = zoomClosing.value ? closing : ZOOM_CONTENT_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  }, [zoomGeomNoSource, zoomGeom]);
  // See ZOOM_BACKDROP_FADE_CLOSE / _OPEN — same shape as the content fade, its own ranges.
  const zoomBackdropFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    const range = zoomClosing.value ? ZOOM_BACKDROP_FADE_CLOSE : ZOOM_BACKDROP_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  });
  // Sequence mode only: the copy IS the page's own image (not a series cover standing in for a
  // card), so its rect MORPHS — from the tile-shaped `thumb` rect at q = 0, where cover-fit
  // reproduces the tile's crop exactly, to the image's TRUE fit rect at q = 1, where cover-fit in
  // an image-aspect rect ≡ contain, i.e. pixel-identical to the page rendered beneath it. Without
  // the morph the copy stays tile-shaped for the whole flight, and through the cross-fade window
  // the SAME image is drawn twice a few percent apart (a 2:3 cover-crop over an image-aspect
  // contain) — a double exposure that reads as blur. Chapter-mode zooms keep the fixed rect: their
  // copy is the series cover, deliberately a different picture from the page dissolving off it.
  // Only where the page actually RENDERS at the contain rect, which is per image now that the fit
  // is an axis: a picture whose contain-limiting axis is the fitted one sits at contain (a normal
  // page under fit-width on a phone, a strip under fit-height); the other kind is scrolled or
  // rested zoomed, and a copy morphing onto the contain rect would land beside it.
  const morphFit = sequence ? (fitOverride ?? settings.pageFit) : null;
  const zoomThumbStyle = useAnimatedStyle(() => {
    // Latched at the collapse's first frame (see `zoomSourceAlive`).
    const geom = zoomSourceAlive.value ? zoomGeom : (zoomGeomNoSource ?? zoomGeom);
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
      };
    }
    const range = zoomClosing.value ? ZOOM_THUMB_FADE_CLOSE_READER : ZOOM_THUMB_FADE_OPEN;
    // The copy has to READ as the thumbnail it came off, corner included — 10pt on a grid card, 6
    // on a History/Activity row (see ZoomOrigin). This
    // rect rides the page's transform, so divide that scale out to hold the on-screen radius
    // steady rather than letting it grow with the page. (The library gets this for free: it moves
    // the real source view, which simply keeps its own radius under the tracked scale.)
    const s = geom ? geom.s + (1 - geom.s) * q : 1;
    let rect = base;

    const ia = zoomThumbAspect.value;
    if (
      morphFit &&
      ia > 0 &&
      (morphFit === 'fit-width' ? ia >= width / height : morphFit === 'fit-height' ? ia <= width / height : ia <= 1)
    ) {
      // The image's contain rect, centred — in PAGE coordinates, which for a screen-sized page
      // are screen coordinates.
      const screenAspect = width / height;
      const fw = ia >= screenAspect ? width : height * ia;
      const fh = ia >= screenAspect ? width / ia : height;
      const fx = (width - fw) / 2;
      const fy = (height - fh) / 2;
      rect = {
        x: base.x + (fx - base.x) * q,
        y: base.y + (fy - base.y) * q,
        width: base.width + (fw - base.width) * q,
        height: base.height + (fh - base.height) * q,
      };
    }
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      // The bias applies HERE and nowhere else: the copy keeps tracking the real collapse in size
      // and position (it is still riding a page that is genuinely shrinking), it just doesn't claim
      // to be arriving anywhere. Rewinding `q` for the fade alone is what says that. See
      // `zoomThumbBias` — 1 for every gesture but a reversed reader dismiss, so this is the
      // identity everywhere else.
      opacity: interpolate(1 - (1 - q) * zoomThumbBias.value, range, [1, 0], Extrapolation.CLAMP),
      borderRadius: (hero ? hero.radius : 0) / Math.max(s, 0.01),
    };
  }, [zoomGeomNoSource, zoomGeom, hero, morphFit, width, height]);
  // What the flying copy DRAWS. A series open flies the series cover (the route's `cover` param is
  // the tapped card's own URL). A SEQUENCE open grew out of a page TILE, so the copy is that
  // page's image — the MOUNT entry's URI (already latched in sequenceTarget), which is the very
  // URL the tile rendered from the same query cache, so the copy has pixels immediately. Mount,
  // not visible: the collapse lands back on the tile that opened this, and the picture that lands
  // there must be that tile's own.
  const seqMountIndex = sequence && typeof sequenceTarget?.start === 'number' ? sequenceTarget.start : 0;
  const zoomThumbUri = useResolvedAsset(
    sequence ? sequence.uris[seqMountIndex] || sequence.entries[seqMountIndex]?.sourceUrl : cover,
  );

  const topBarHeight = useTopBarHeight();
  // The PERSISTENT back button (TopBarSwitch's `persistent` slot). It follows the auto-hiding
  // chrome (via the shared-value mirror), and on the way into the details' strip it stays up and
  // turns from white over the page to the theme's text colour.
  const chromeVisibleSV = useSharedValue(1);
  useEffect(() => {
    chromeVisibleSV.set(withTiming(chromeVisible ? 1 : 0, { duration: 200 }));
  }, [chromeVisible, chromeVisibleSV]);
  const backPersistStyle = useAnimatedStyle(() => {
    // Solid once the page is most of the way into the strip, whatever the chrome is doing; max()
    // keeps it from dipping on the way.
    const detailsSide = interpolate(progress.value, [0.4, 0.8], [0, 1], Extrapolation.CLAMP);
    return { opacity: Math.max(detailsSide, chromeVisibleSV.value) };
  });
  const backThemeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [0, 1], Extrapolation.CLAMP),
  }));
  const backWhiteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [1, 0], Extrapolation.CLAMP),
  }));

  // The reader FRAME travels only into the strip: on the way it rises by half its hidden height,
  // so the strip shows the page's vertical CENTRE, not its top edge. A dismissal does not move it
  // either — the collapse moves the whole page, and the reader's dark surface stays put and fades.
  // The split reader's swipe up rides it too (`liftY`), as UIKit's swipe down does the whole screen:
  // up with the finger, smaller, with rounding corners.
  const readerCardStyle = useAnimatedStyle(() => {
    const lift = liftY.value;
    return {
      transform: [
        { translateY: (-(height - bandH) / 2) * progress.value - lift },
        { scale: 1 - lift / (height * ZOOM_DRAG_TRAVEL) },
      ],
    };
  }, [height, bandH]);
  const readerClipStyle = useAnimatedStyle(() => ({ borderRadius: Math.min(LIFT_CORNER_RADIUS, liftY.value) }));
  // The collapsed reader's heavy fade — "almost like a faded out background image".
  const headerReaderFadeStyle = useAnimatedStyle(() => ({ opacity: 0.55 * progress.value }));
  const readerTintStyle = useAnimatedStyle(() => ({
    opacity: 0.18 * Math.min(1, progress.value / FADE_WINDOW),
  }));

  // ── The BACKDROP's dim (see lib/series-backdrop.ts) ───────────────────────────────────
  // How much of the screen this page currently covers: `zoom`, which the dismiss drives too.
  // Depth 0 ONLY: a drilled layer sits over its parent series inside this same modal, and the tabs
  // behind the whole modal must not respond twice to what is, to them, one open page. Nor a pushed
  // card: nothing shows behind one, and UIKit has taken the screen beneath away regardless. Nor a
  // reader page over its details, which own the backdrop (see SplitHandoff).
  useAnimatedReaction(
    () => {
      return zoom.value;
    },
    (covered) => {
      if (depth === 0 && !nativePush && !stripReader) seriesReaderDim.set(covered);
    },
    [depth, nativePush, stripReader],
  );
  // Belt and braces: nothing may strand the backdrop dimmed if this screen goes away without its
  // exit animation finishing (a deep link replacing the route, a dev reload). The hold's release
  // does that reset, and ALSO tells the watchdog nobody owns the dim any more — the reset above is
  // one JS-thread write against a value the reaction above writes every frame, and on its own it
  // has no way to notice when it loses that race (see lib/pushback-watchdog).
  useEffect(() => {
    if (depth > 0 || nativePush || stripReader) return;
    return holdSeriesBackdrop();
  }, [depth, nativePush, stripReader]);

  const paneRef = useRef<ReaderPaneHandle>(null);
  // A reader page shows where it stands as its way back STARTS, not in its unmount flush after the
  // pop: the details beneath move their strip while the zoom is still carrying the page down to it,
  // instead of after it has landed on the old one.
  const navigation = useNavigation<ClosingNavigation>();
  useEffect(() => {
    const show = () => paneRef.current?.showProgress();
    const offs = [
      navigation.addListener('transitionStart', (e) => {
        if (e.data.closing) show();
      }),
      navigation.addListener('beforeRemove', show),
    ];
    return () => offs.forEach((off) => off());
  }, [navigation]);
  // Verify this chapter's collected pages against the page list we already fetched — repairs the
  // ones the source shifted and seeds the indices the heart reads. See use-chapter-reconcile.
  // Reconcile is chapter machinery — in sequence mode `pages` is the cross-series URI list, which
  // must never be offered as a chapter's page list. (Each entry's chapter was reconciled when it
  // was read normally; the sequence only displays.)
  useChapterReconcile(bridgeId, id, sequence ? undefined : (visiblePage?.chapterId ?? target?.chapterId), pages);

  const scheme = useActiveColorScheme();
  // Sequence mode: the visible ENTRY names the series.
  const seriesTitle = sequence
    ? (visibleSequenceEntry?.seriesTitle ?? series?.title ?? 'Reader')
    : (series?.title ?? title ?? id ?? 'Reader');

  // What the toolbar's save button acts on. In sequence mode this is the visible ENTRY — its own
  // series and chapter coordinates, not the instance's (they only match at rest, by the screen's
  // re-keying); in chapter mode it is the visible page of the current chapter.
  const pageAction = sequence
    ? visibleSequenceEntry && {
        bridgeId: visibleSequenceEntry.bridgeId,
        seriesId: visibleSequenceEntry.seriesId,
        seriesTitle: visibleSequenceEntry.seriesTitle,
        chapterId: visibleSequenceEntry.chapterId,
        ...(visibleSequenceEntry.chapterName !== undefined && {
          chapterName: visibleSequenceEntry.chapterName,
        }),
        pageIndex: visibleSequenceEntry.pageIndex,
        ...(visibleSequenceEntry.pageCount !== undefined && {
          pageCount: visibleSequenceEntry.pageCount,
        }),
        ...((pages?.[visiblePage?.pageIndex ?? sequence.index] || visibleSequenceEntry.sourceUrl) !==
          undefined && {
          sourceUrl: pages?.[visiblePage?.pageIndex ?? sequence.index] || visibleSequenceEntry.sourceUrl,
        }),
      }
    : visiblePage && {
        bridgeId,
        seriesId: id,
        seriesTitle,
        chapterId: visiblePage.chapterId,
        ...(target?.chapterName !== undefined && { chapterName: target.chapterName }),
        pageIndex: visiblePage.pageIndex,
        ...(pages && { pageCount: pages.length }),
        ...(pages?.[visiblePage.pageIndex] !== undefined && {
          sourceUrl: pages[visiblePage.pageIndex],
        }),
      };

  // A sequence entry's page stands alone; the chapter reader can be showing a spread.
  const sourceUrlOf = (i: number) => (sequence ? pageAction?.sourceUrl : pages?.[i]);
  const pagesOnScreen =
    sequence || !visiblePage
      ? undefined
      : () =>
          paneRef.current?.pagesOnScreen(visiblePage.chapterId, visiblePage.pageIndex) ?? {
            pages: [visiblePage.pageIndex],
            rtl: false,
          };

  // The strip handoff's tint and heavy fade, over the PAGES but UNDER the bottom chrome: they
  // render inside ReaderPane between the readers and the navigator/pill (or after the
  // error/loading placeholder), so a handoff part way never washes out the scrubber and skip
  // buttons.
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

  // iOS: the system bar is the reader's top chrome, through the route's options: transparent over
  // the page, a white title, the save and settings buttons as glass bar items (ReaderNativeToolbar),
  // following the chrome's auto-hide through `headerShown`, so UIKit slides it away and back. A
  // mounted Stack.Toolbar sets `headerShown: true` on top of these options (expo-router merges its
  // items in over the page's own), so no toolbar renders its items while the bar is down. Only the
  // top instance sets the options (they are the route's, shared by every layer), and the elements
  // mount only while it is top, so a layer that becomes top again re-applies them. Pushed over the
  // details the back button is the system's. A reader that is the root's first page reaches the
  // `index` of the nested stack (app/series/_layout), never the contained transparent modal around
  // it, whose content react-native-screens remounts when its `headerShown` flips; a nested root
  // has no back of its own, hence the chevron.
  // In sequence mode the reader's chrome describes the VISIBLE entry — which series the page in
  // front of you belongs to is the one thing this bar must answer there.
  const readerBarTitle = sequence ? (visibleSequenceEntry?.seriesTitle ?? seriesTitle) : seriesTitle;
  const readerBarSubtitle = sequence ? (visibleSequenceEntry?.chapterName ?? '') : (target?.chapterName ?? '');
  // iOS gives it one line, a plain title UIKit lays out and truncates between the back button and
  // the bar buttons: a title view is sized by React at the bar's full width, and UIKit can only
  // centre that over them. Outside a sequence the line is the chapter, which nothing else in the
  // reader names; the series is the page the back button returns to.
  const nativeReaderTitle = sequence ? readerBarTitle : readerBarSubtitle || readerBarTitle;
  const nativeBar =
    NATIVE_HEADER && isTop ? (
      <>
        <Stack.Screen
          options={{
            headerShown: chromeVisible,
            headerTransparent: true,
            headerShadowVisible: false,
            headerBackVisible: nativePush,
            // UIKit's interactive dismissal only where it is the reader's swipe away (`swipeAway`);
            // anywhere else the reader's own drags own the screen.
            gestureEnabled: nativePush && swipeAway && !readerZoomed && !scrubbing,
            title: nativeReaderTitle,
            headerTitle: nativeReaderTitle,
            headerBlurEffect: undefined,
            headerTintColor: '#fff',
          }}
        />
        {!nativePush && chromeVisible ? (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              icon="chevron.left"
              accessibilityLabel="Go back"
              onPress={backStepsHome ? leaveReaderForDetails : closeLayer}
            />
          </Stack.Toolbar>
        ) : null}
        <ReaderNativeToolbar
          bridgeId={pageAction ? pageAction.bridgeId : bridgeId}
          seriesId={pageAction ? pageAction.seriesId : id}
          seriesTitle={pageAction ? pageAction.seriesTitle : seriesTitle}
          chapterId={pageAction?.chapterId}
          chapterName={pageAction?.chapterName}
          pageIndex={pageAction?.pageIndex ?? 0}
          pageCount={pageAction?.pageCount}
          sourceUrlOf={sourceUrlOf}
          pagesOnScreen={pagesOnScreen}
          seriesKey={seriesKey}
          barShown={chromeVisible}
          onHoldChrome={holdChrome}
          onPress={showChrome}
        />
      </>
    ) : null;
  const topChrome = (
    <TopBarSwitch
      mode="reader"
      persistent={
        NATIVE_HEADER ? null : (
          <Animated.View
            nativeID={`${chromeId}-back`}
            pointerEvents={chromeVisible ? 'box-none' : 'none'}
            style={[styles.headerBackWrap, { top: insets.top, height: topBarHeight }, backPersistStyle]}>
            <Pressable
              testID="series-page.header-back"
              onPress={backStepsHome ? leaveReaderForDetails : closeLayer}
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
        reader: NATIVE_HEADER ? (
          // The bar is the system's on iOS (nativeBar); only its shade is still drawn here.
          <ReaderBarShade visible={chromeVisible} />
        ) : (
          // The reader's own fully transparent toolbar, with no back of its own: the persistent
          // chevron above is the back button. Its auto-hide rides `visible`.
          <View nativeID={`${chromeId}-bar`} pointerEvents="box-none">
            <CollectPageShortcut
              enabled={IS_WEB && isTop}
              bridgeId={pageAction ? pageAction.bridgeId : bridgeId}
              seriesId={pageAction ? pageAction.seriesId : id}
              seriesTitle={pageAction ? pageAction.seriesTitle : seriesTitle}
              chapterId={pageAction?.chapterId}
              chapterName={pageAction?.chapterName}
              pageIndex={pageAction?.pageIndex ?? 0}
              pageCount={pageAction?.pageCount}
              sourceUrlOf={sourceUrlOf}
              pagesOnScreen={pagesOnScreen}
            />
            <ReaderToolbar
              title={readerBarTitle}
              subtitle={readerBarSubtitle}
              visible={chromeVisible}
              onBack={goBack}
              hideBack
              trailingWidth={zoomControlShown ? TRAILING_SLOT_W + Spacing.two + ZOOM_CONTROL_W : undefined}
              right={
                <>
                  {zoomControlShown && <ZoomControl onPress={showChrome} />}
                  <CollectPageControl
                    bridgeId={pageAction ? pageAction.bridgeId : bridgeId}
                    seriesId={pageAction ? pageAction.seriesId : id}
                    seriesTitle={pageAction ? pageAction.seriesTitle : seriesTitle}
                    chapterId={pageAction?.chapterId}
                    chapterName={pageAction?.chapterName}
                    pageIndex={pageAction?.pageIndex ?? 0}
                    pageCount={pageAction?.pageCount}
                    sourceUrlOf={sourceUrlOf}
                    pagesOnScreen={pagesOnScreen}
                    onPress={showChrome}
                  />
                  {/* Held up while the menu is open: it is anchored to the gear, and the
                      toolbar fading out from under it would leave it pointing at nothing. */}
                  <SettingsControl seriesKey={seriesKey} onOpenChange={holdChrome} />
                </>
              }
            />
          </View>
        ),
      }}
    />
  );

  return (
    // Plain (transparent) root — the route is a contained transparent modal, so a dismissal can
    // fade the layers out over the screen beneath. The reader's surface supplies the opaque fill.
    <View style={styles.container}>
      {/* While the reader is up the system bars stay horizontal, the opt-out iOS 27 keeps for
          full-screen media: in the vertical bar beside the page they would take its width, and the
          status bar there cannot hide with the chrome. */}
      <StatusBar
        style={settings.mode === 'paged' ? (scheme === 'dark' ? 'light' : 'dark') : 'light'}
        hidden={settings.mode !== 'paged' && !chromeVisible}
        verticalBarBehaviorIOS="disabled"
      />

      <SplitClip travel={stripFrom ? height - stripFrom.stripBottom : null} progress={progress}>
      {/* THE READER'S BACKDROP: full screen, never moving, fading IN PLACE as the collapse carries
          the page over it. Outside the mask on purpose — inside it, it travelled and scaled along
          with everything else, which is a swipe-away dragging its own background off with it. */}
      <Animated.View pointerEvents="none" style={[styles.readerSurface, { width, height }, zoomBackdropFadeStyle]} />

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

      {/* The reader: full screen, in three layers — a static fading surface above, the traveling
          page subtree, and the chrome that fades with it. The collapse/dismiss pan wraps the whole
          cell (the scrubber and a zoomed page disable it). */}
      <GestureDetector gesture={collapsePan}>
        <Animated.View
          testID="series-page.reader-card"
          style={[styles.readerFrame, { top: 0, width, height }, readerCardStyle]}>
          <Animated.View style={[styles.readerClip, readerClipStyle]}>
          {error ? (
            <>
              {pagesGone && !missingBridge ? (
                <View testID="series-page.reader.removed" style={[styles.centerFill, styles.readerNotice]}>
                  <ThemedText type="small" style={styles.readerNoticeText}>
                    {`${bridge || 'The source'} no longer has this series, and this chapter isn't downloaded, so it can't be opened.`}
                  </ThemedText>
                </View>
              ) : !missingBridge ? (
                <View style={styles.centerFill}>
                  <RetryBlock message={error} onRetry={refetch} />
                </View>
              ) : (
                <View style={styles.centerFill}>
                  <BridgeMissingNotice
                    bridge={missingBridge}
                    message={`${missingBridge.name} isn't installed and this chapter isn't downloaded, so it can't be opened.`}
                    testID="series-page.reader.bridgeMissing"
                  />
                </View>
              )}
              {dimOverlays}
            </>
          ) : !readerReady ? (
            <>
              <View style={styles.centerFill}>
                <ThemedText style={styles.loadingText}>Loading…</ThemedText>
              </View>
              {dimOverlays}
            </>
          ) : (
            <ReaderPane
              onVisiblePage={setVisiblePage}
              // Stitched, the pane is keyed by the RUN (plus the explicit-jump nonce), so a boundary
              // crossing's relabel does NOT remount it — only leaving the run (chapter list tap,
              // skip button, cold-window fallback) does. Direct and sequence reads stay keyed by
              // chapter.
              key={stitched ? `run:${runKey}:${jumpNonce}` : `${target.chapterId ?? DIRECT_CHAPTER_ID}:${jumpNonce}`}
              ref={paneRef}
              pages={pages}
              segments={segments}
              onRelabel={relabelFromPager}
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
              // A sequence has no chapter roster: no skip buttons, no cross-chapter paging, and —
              // below — no progress writes (a sequence hop is browsing, not a read position, and
              // recording it would clobber the real one).
              chaptered={!isDirect && !sequence}
              recordProgress={!sequence}
              hasPrevChapter={!sequence && !!prevChapter}
              hasNextChapter={!sequence && !!nextChapter}
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
              overlay={dimOverlays}
              // Only the page on screen loads (no warm-ahead, render window of 1) until the
              // entrance settles; the normal prefetch pipeline resumes after.
              standby={!entranceSettled}
              entering={!entranceSettled}
              inLibrary={inLibrary}
              keyboard={isTop}
              glass={pushSettled}
            />
          )}
            {/* The Details pill — the guaranteed way to the details (webtoon's reader owns vertical
                drags, and never goes back to them by dragging). Not on a desktop: its details are
                the pane's, or the chevron's (`backStepsHome`). Nor on a reader page opened from
                the details, whose back goes to them. */}
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <DetailsHint
                visible={chromeVisible && !isDesktop && !desktopShell() && params.from !== 'details'}
                onPress={leaveReaderForDetails}
              />
            </View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* UIKit's zoom out of the details' strip lands on the same stretch of this page: the strip's
          resting rect, centred, as `readerCardStyle` centres the page in the strip on the way back. */}
      {nativePush ? (
        <View pointerEvents="none" style={[styles.stripZoom, { top: (height - bandH) / 2, width }]}>
          <LinkAppleZoomTarget>
            <View collapsable={false} style={{ width, height: stripZoomH }} />
          </LinkAppleZoomTarget>
        </View>
      ) : null}

      {/* The top bar (see `topChrome` above) rides the page's own motion, entrance and dismissal
          alike. */}
      {nativeBar}
      {topChrome}

      </Animated.View>

      {/* THE FLYING THUMBNAIL — the other half of the cross-fade, and the reason the motion reads
          as a picture opening rather than a screen resizing. The library transforms the REAL
          source element on the screen underneath to track this path; from inside a modal that view
          is untouchable, so this is a copy of the same cover.
          Laid out at the DESTINATION bound and left to ride the page's transform, which is what
          keeps it honest: at rest that transform puts this rect exactly on the tapped card. No
          second geometry to drift out of sync. The mask supplies the rounded card silhouette, so
          it needs no radius of its own. */}
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
      </SplitClip>
    </View>
  );
}

type ClosingNavigation = {
  addListener(type: 'transitionStart', cb: (e: { data: { closing: boolean } }) => void): () => void;
  addListener(type: 'beforeRemove', cb: () => void): () => void;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Transparent: the route is a contained transparent modal, and a dismissal fades the page out
    // over the screen beneath.
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
  readerClip: {
    flex: 1,
    overflow: 'hidden',
  },
  readerSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: READER_BACKDROP,
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
  readerTint: {
    backgroundColor: '#000',
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
  readerNotice: {
    paddingHorizontal: Spacing.five,
  },
  readerNoticeText: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  loadingText: {
    color: '#fff',
  },
});
