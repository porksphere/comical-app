import { useQuery } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { Stack, useFocusEffect, useIsFocused, useNavigation, useTheme as useNavTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  runOnUI,
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
import { isDesktopPointer, keepZoomLevel } from '@/components/reader/desktop-zoom';
import { focusSkip } from '@/lib/focus-nav';
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
import { TopBar } from '@/components/top-bar';
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
import { DIRECT_CHAPTER_ID, type Chapter } from '@/data/types';
import { useMissingBridge } from '@/hooks/use-bridges';
import { useChapterReconcile } from '@/hooks/use-chapter-reconcile';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { useReaderSequence, type ReaderSequenceParams } from '@/hooks/use-reader-sequence';
import { useReaderSettings, useFitOverride } from '@/hooks/use-reader-settings';
import { withoutRouterParams, withZoomSource, ZoomSource } from '@/components/zoom-source';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { useIsDesktop, useTopBarHeight } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { useTabRoute } from '@/lib/focused-tab';
import { hideNativeTabBar } from '@/lib/native-tab-bar';
import { LinkAppleZoomTarget, tabHref, useLocalSearchParams, useRouter } from '@/lib/nav';
import { BACK_TARGET, msUntilClaimable } from '@/lib/nav-guard';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';
import {
  backSwipePan,
  backSwipeShape,
  backSwipeStayedHorizontal,
  resetBackSwipeShape,
  trackBackSwipeShape,
  BACK_ACTIVATE_DOMINANCE,
  BackSwipeGestureContext,
} from '@/lib/back-swipe';
import { desktopShell } from '@/lib/desktop-shell';
import { trace, traceGate, traceJS, traceThrottled, useGestureTraceEnabled } from '@/lib/gesture-trace';
import { releaseCommitted, releaseCommittedEitherWay } from '@/lib/gesture-release';
import { IOS_PARALLAX_FRACTION } from '@/lib/ios-card-pop';
import { registerDrillSeries, registerOpenSearchLayer, useDrillRelatedSeries } from '@/lib/series-nav';
import { coverSeriesPane, setSeriesPaneTop, useSeriesPaneCovered, useSeriesPaneShowsTop } from '@/lib/series-pane';
import { usePaneTab, usePaneTabLive } from '@/lib/pane-tab';
import { useSeriesPaneWidth } from '@/lib/series-pane-context';
import { holdSeriesBackdrop, seriesReaderDim } from '@/lib/series-backdrop';
import { useDimWindowControls, useWindowThemeColor, watchWindowTopEdge } from '@/lib/window-controls';
import {
  holdZoomingSeries,
  onZoomSurfaceChange,
  resolveZoomTarget,
  takeZoomOrigin,
  zoomSourceHolds,
  type ZoomRect,
} from '@/lib/series-zoom';
import { truncateTopBarTitle } from '@/components/series/series-body';
import { DetailsHint } from '@/components/series/details-hint';
import { SeriesDetailsHost } from '@/components/series/details-host';
import { LeavingMask } from '@/components/series/leaving-mask';
import {
  COLLAPSE_ACTIVATE_PX,
  DISMISS_COMMIT_FRACTION,
  LIFT_COMMIT_FRACTION,
  LIFT_CORNER_RADIUS,
  NO_ORIGIN_SCALE,
  PULL_COMMIT_PX,
  REVEAL_COMMIT_FRACTION,
  SPRING_BACK,
  ZOOM_BACKDROP_FADE_CLOSE,
  ZOOM_BACKDROP_FADE_OPEN,
  ZOOM_BACK_SWIPE_FOLLOW_GRIP,
  ZOOM_BACK_SWIPE_FOLLOW_REACH,
  ZOOM_BOUND_MIN_VISIBLE,
  ZOOM_BOUND_WAIT_MS,
  ZOOM_CONTENT_FADE_CLOSE,
  ZOOM_CONTENT_FADE_CLOSE_NO_SOURCE,
  ZOOM_CONTENT_FADE_CLOSE_OFFCOVER,
  ZOOM_CONTENT_FADE_CLOSE_READER,
  ZOOM_CONTENT_FADE_OPEN,
  ZOOM_DISMISS_DIR_MIN,
  ZOOM_DRAG_FOLLOW_GRIP,
  ZOOM_DRAG_FOLLOW_REACH,
  ZOOM_DRAG_TRAVEL,
  ZOOM_IN_SPRING,
  ZOOM_OUT_SPRING,
  ZOOM_OUT_SPRING_READER,
  ZOOM_RADIUS_CURVE_SWAP_AT,
  ZOOM_RADIUS_ROUNDED_BY_CLOSE,
  ZOOM_RADIUS_ROUNDED_BY_OPEN,
  ZOOM_THUMB_BIAS_RESTORE_MS,
  ZOOM_THUMB_FADE_CLOSE,
  ZOOM_THUMB_FADE_CLOSE_OFFCOVER,
  ZOOM_THUMB_FADE_CLOSE_READER,
  ZOOM_THUMB_FADE_OPEN,
  ZOOM_THUMB_PAINT_WAIT_MS,
  computeZoomGeom,
  pickZoomGeom,
  zoomBoundShift,
  zoomCrossAxisDrag,
  zoomDetach,
  zoomDragFollow,
  zoomHoming,
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
import { SearchLayer } from '@/components/series/search-layer';
import { SplitClip } from '@/components/series/split-clip';
import { type SeriesSplit, handOffSplit, takeSplitHandoff } from '@/components/series/split-handoff';
import { useNativePush, useViewport } from '@/components/series/viewport';

// THE series page: one screen holding BOTH the series details and the reader, either side one
// gesture from the other. Everything that opens a series or opens reading opens this — a browse
// card, a History or Activity row, the card long-press menu's Read, a chapter row, a page
// thumbnail — differing only in which side it lands on. There is no separate reader route.
//
// It opens ON THE DETAILS, with the reader as a faded strip forming the TOP OF THE PAGE — not
// fixed chrome: the strip scrolls away under the content like any page header, through a tall
// gradient seam centered on the series title. The reader itself is already FULL-SCREEN beneath
// that layer (the strip is its window), so revealing it is only ever a matter of moving the
// details layer off — and the axis follows the reader's own, so the transition matches the
// gestures on both sides (see `horizontalReveal`):
//   - PAGED: pull the page down past its top and the details slide DOWN out of visibility (the
//     iOS rubber-band moves content and seam 1:1 with the finger while the reader fades in
//     above; a deep release commits, and Android/web get the same follow via a manual pan).
//   - WEBTOON: a leftward drag anywhere on the details (or on the strip) slides them LEFT off
//     the screen under the finger — vertical belongs to the scroll there, and the collapse is
//     already a rightward drag. A pull past the top still rubber-bands the strip open as an
//     affordance, but never commits (that would fling the details along the wrong axis).
// A strip tap expands in both. In the expanded reader, drag up (paged) or the Details pill brings
// the details back — webtoon reveals by BUTTON ONLY, since a horizontal drag that revealed would
// be the one gesture here going somewhere other than out. Any other drag dismisses, running the
// same collapse into the source card the chevron does (mode-locked per gesture — see the pan
// build). One TopBarSwitch slot crossfades the top chrome between the modes.
//
// The details are `SeriesBody` (components/series/series-body.tsx) — cover hero, action column,
// tag/meta/description, the real chapter list (downloads, versions, read state), page-thumb grid,
// related rails. Three props route its intents back into this screen rather than anywhere else:
// `onStartReading` (Read button → expand the in-place reader), `onOpenChapter` (chapter row →
// swap the reader pane's chapter and expand), `onOpenPage` (direct-series thumbnail → jump the
// pane to that page and expand).
//
// Chaptered series: the screen resolves resume-or-first-chapter itself (same history lookup as
// useStartReading). The NATIVE PAGED reader stitches adjacent chapters into one flat pager
// (see the `run` machinery), so swiping across a boundary is an
// ordinary page turn with an in-place relabel. Explicit jumps (chapter rows, skip buttons) and
// web/webtoon crossings remount the pane seeded at the landing page instead. While the details
// are up the reader is in STANDBY — only the single visible strip page is requested.

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

// The reader surface's tone. Pure black, like every other page — it mirrored the reference's
// `#reader-view { background: #0f0f0f }` until the app's own background stopped doing the same
// (see `Colors.dark.background`), and a reader a shade lighter than the app it opens out of read
// as a mismatch rather than as its own surface.
const READER_BACKDROP = '#000000';

// The visible height of the collapsed reader strip (below the safe area) — a faded-out
// background-image band forming the TOP OF THE DETAILS PAGE (it scrolls away under the content
// like any page header, it is not fixed chrome).
const HEADER_BAND = 200;

// The strip-to-details seam gradient's height. It's tall on purpose: the transition is CENTERED
// ON THE SERIES TITLE — the title (the page's first element) renders mid-gradient over the fading
// strip, X-hero style, so the content top inset is derived from this (see headerTopInset).
const SHEET_FADE_H = 120;

/**
 * How close to the card counts as arrived, for the leave reaction. ZERO — the collapse must be at
 * REST, not merely near.
 *
 * This was 0.02, chosen as "small enough to be invisible", which measures the wrong thing. The gap
 * isn't what you can see of the mask, it's what the app is DOING while the mask is still moving:
 * leaving unmounts the whole series page, pops the route, and un-blanks the source card, and all of
 * that lands on the main thread — the same one the animation draws on. At 0.02 that teardown
 * overlapped the final frames of the motion, so every collapse hitched just as it reached the card,
 * fast swipe or slow, which is precisely where it was reported.
 *
 * At rest the page is already sitting exactly on the card with its content cross-faded to the
 * thumbnail copy — visually indistinguishable from the card underneath. So the teardown still costs
 * the same, and now costs it against a still frame, where a stall has nothing to stutter.
 *
 * Zero is reachable, not a hope: the collapse springs with `overshootClamping`, and Reanimated
 * writes the target exactly when a spring completes. A collapse that gets CANCELLED before arriving
 * never trips this — which is the case the wall-clock backstop is for.
 */
const LEAVE_AT_ZOOM = 0;

/** The two ends of "a collapse is under way". Not symmetric: `ARMED` sits nearer the top so a drag
 *  released short has to actually return home before it may probe again. */
const COLLAPSE_STARTED = 0.995;

const COLLAPSE_ARMED = 0.999;

/** Instances that have already left. See `leaveOnce` for why this lives out here. */
const LEFT = new WeakSet<object>();

/** An instance's pop waiting out the back guard's window — see `routeBackHeld`. */
const HELD_POPS = new WeakMap<object, ReturnType<typeof setTimeout>>();

// Half the title's ~40pt first line — positions the title's CENTER at the gradient's center.
const TITLE_MID = 20;

// The details-content fade (and the reader's matching tint) complete within this fraction of the
// travel — weighted toward the START of a reveal and, symmetrically, the END of a hide.
const FADE_WINDOW = 0.4;

/**
 * One series instance. The SCREEN (`SeriesReaderScreen` below) renders a base instance for the
 * route's own params plus a LAYER per drilled series (a series opened from a series — related
 * rails, nested search results), stacked as plain sibling views inside this one screen.
 *
 * Layers, not navigation, on purpose: the modal is a contained transparent modal, and iOS can
 * neither stack a second one on top (UIKit re-roots the presentation and drops the middle
 * screen's view — the dismissal showed the root tabs) nor keep a covered nested CARD's view
 * alive (UINavigationController detaches it — the dismissal showed a flat backdrop). Sibling
 * views can't be detached by anyone, so the parent series is GUARANTEED live beneath a drilled
 * one: the page-view swipe-away and the edge back-swipe both reveal it for real, exactly like
 * the top-level gestures reveal the browse grid.
 *
 * `depth` 0 is the modal root (leaving = popping the route); a deeper instance zooms in over its
 * parent out of the card that opened it, exactly as the root zooms out of a card on the grid
 * behind the whole modal, and leaves via `onPopLayer` once it has collapsed (or flown) out.
 */
function SeriesReaderInstance({
  params,
  depth,
  onPopLayer,
  isTop,
  nativePush,
  split,
  sequence,
}: {
  params: SeriesReaderParams;
  depth: number;
  onPopLayer: () => void;
  /** A pushed card whose transitions are the system's (see useNativePush). Never for a layer. */
  nativePush: boolean;
  /** Which page of the split this is, if any (see SeriesSplit). */
  split: SeriesSplit;
  /** Whether this instance is the top of the stack — the one keyboard back acts on (web). */
  isTop: boolean;
  /** Present = this instance reads a cross-series sequence instead of a chapter. */
  sequence?: ReaderSequenceRun;
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
  const fitOverride = useFitOverride();

  const {
    id,
    title,
    bridge: bridgeParam,
    bridgeId,
    cover: coverParam,
    direct,
    reader: readerParam,
    chapterId: seedChapterId,
    chapterName: seedChapterName,
    start: seedStart,
    picked: seedPicked,
  } = params;
  const seriesKey = bridgeId && id ? `${bridgeId}:${id}` : null;
  const [settings] = useReaderSettings(seriesKey);
  // Opened straight into the reader (History / Activity), rather than onto the details.
  const readerFirst = readerParam === '1';
  // The details page of the split: reading is the reader page's, pushed over this one.
  const splitDetails = split === 'details';
  // Off iOS the pages of the split draw the move between them (see SplitHandoff): a reader page
  // pushed over its details grows out of their strip, and details brought up in a reader's place
  // slide up over it. On iOS each is a native push over the other (see useNativePush).
  const splitDrawn = !IS_IOS;
  const [splitHandoff] = useState(() =>
    splitDrawn && seriesKey ? takeSplitHandoff(seriesKey, split === 'reader' ? 'strip' : 'reveal') : null,
  );
  const stripFrom = splitHandoff?.kind === 'strip' ? splitHandoff : null;
  const stripReader = stripFrom !== null;
  const revealIn = splitHandoff?.kind === 'reveal';
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // ── The visible page — and, in sequence mode, the visible ENTRY ────────────────────────────
  // Lives at this level because the TOOLBAR is rendered here (the pane reports it up through
  // `onVisiblePage`, already chapter-correct across a stitched crossing), and this high up in the
  // component because the DETAIL identity just below derives from it.
  const [visiblePage, setVisiblePage] = useState<{ pageIndex: number; chapterId: string } | null>(null);
  // The ENTRY the pager currently shows. The pane's flat index IS the sequence index, so this is
  // what the chrome (title, save button, settings sheet) and the details layer describe — the
  // instance's own route params only name the entry the album OPENED on.
  const visibleSequenceEntry = sequence
    ? sequence.entries[Math.min(visiblePage?.pageIndex ?? sequence.index, sequence.entries.length - 1)]
    : undefined;

  // ── The series the DETAILS side describes ──────────────────────────────────────────────────
  // Chapter mode: this instance's own series, always. Sequence mode: the VISIBLE entry's — the
  // album pager never remounts (a series cross must be as seamless as a stitched chapter
  // crossing, which is to say: a plain page turn), so instead of remounting the reader under a
  // new series, the details layer and the series queries RE-POINT by key. A stitched crossing's
  // relabel, one level up.
  const detailBridgeId = sequence ? (visibleSequenceEntry?.bridgeId ?? bridgeId) : bridgeId;
  const detailSeriesId = sequence ? (visibleSequenceEntry?.seriesId ?? id) : id;
  const detailTitle = sequence ? visibleSequenceEntry?.seriesTitle : title;
  const detailIsDirect = sequence ? visibleSequenceEntry?.chapterId === DIRECT_CHAPTER_ID : isDirect;
  const detailBridge = sequence ? undefined : bridge;
  const detailCover = sequence ? undefined : cover;
  const detailKey = `${detailBridgeId ?? ''}:${detailSeriesId ?? ''}`;

  // Sequence mode loads NOTHING about a series up front — no detail, no chapter roster, no
  // library membership. The reader side of an album needs none of it (the chrome describes the
  // visible entry), and an album that wanders through five series must not fetch five series'
  // details on the way. Armed PER SERIES the moment the reveal starts moving (see the reaction
  // beside `progress`): reveal on series A, collapse, cross to B — B stays unfetched until ITS
  // reveal, while A's answer sits in the query cache for an instant re-reveal. Non-sequence
  // instances are armed for their own series from mount, so their ordering contract (detail
  // dispatched at mount) is untouched.
  const [wantedKey, setWantedKey] = useState<string | null>(() => (sequence ? null : detailKey));
  const seriesWanted = wantedKey === detailKey;
  const armSeriesQueries = useCallback(() => setWantedKey(detailKey), [detailKey]);

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Chapter list (chaptered series only) — drives resume-or-first resolution and prev/next
  // adjacency for the reader pane. (The details card's own list rendering — read state, downloads,
  // versions — is SeriesBody's business, not duplicated here.)
  const { data: listData } = useQuery(
    seriesListQuery(ds, mock, detailBridgeId ?? '', detailSeriesId ?? '', false, !detailIsDirect && seriesWanted),
  );
  const chapters = listData?.chapters;

  // Library membership — tells the reader pane whether a read also has to keep the reading log's row
  // up to date (see its `record`). The query lives HERE, not in the pane:
  // the pane re-renders on every page sweep, and useQuery's per-render subscription work (query
  // key hashing) is measurable at that cadence.
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, detailBridgeId ?? '', detailSeriesId ?? ''),
    retry: false,
    // Deferred with the rest of the series queries in sequence mode — it only picks the
    // progress-recording path, and a sequence records no progress.
    enabled: !!detailBridgeId && !!detailSeriesId && seriesWanted,
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
    if (!readerFirst) return null;
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
  // title+cover). The details card's SeriesDetailsHost subscribes to this same query key, so this
  // costs one fetch total.
  const { data: series = null } = useQuery({
    ...seriesDetailQuery(ds, mock, detailBridgeId ?? '', detailSeriesId ?? '', {
      direct: detailIsDirect,
      bridgeName: detailBridge ?? 'Library',
      title: detailTitle,
      cover: detailCover,
    }),
    // Sequence mode: keyed to the VISIBLE entry's series, and nothing fetched until the reveal
    // asks (`seriesWanted`) — sequence chrome describes the visible entry, not this query.
    // `!!detailSeriesId` preserves the option's own guard, which this override replaces.
    enabled: !!detailSeriesId && seriesWanted,
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
  // Nor the split details' strip, a still of the page you are on that nothing reads through.
  const stitched = !isDirect && !sequence && !splitDetails;
  // The committed side of the reveal (declared up here — the stitching queries below gate on
  // it). The screen opens ON the details; see the reveal section further down.
  const [detailsActive, setDetailsActive] = useState(!readerFirst);
  // The level the desktop zoom keeps lasts across page turns and chapters, but not out of the
  // reader: back on the details, or gone, it's put down.
  useEffect(() => {
    if (detailsActive) keepZoomLevel(1);
    return () => keepZoomLevel(1);
  }, [detailsActive]);
  // iOS: the system tab bar stays up over the details, as over any page a tab pushes, and goes
  // with the pages — the reader is full-bleed.
  useEffect(() => {
    if (!NATIVE_HEADER || detailsActive || split) return;
    return hideNativeTabBar();
  }, [detailsActive, split]);
  // The split reader is a page of its own, which stays mounted under the details it pushes: the bar
  // goes only while it is the page on screen.
  useFocusEffect(
    useCallback(() => {
      if (!NATIVE_HEADER || detailsActive || !split) return;
      return hideNativeTabBar();
    }, [detailsActive, split]),
  );
  useWindowThemeColor(detailsActive ? null : READER_BACKDROP, 1);
  // True while a horizontal details gesture (back-swipe or webtoon reveal) is ACTIVE. The pans
  // ride the details scroller's own detector, simultaneous with it — that's the only way they
  // activate over a UIScrollView at all (see makeBackSwipePan) — but simultaneous means the list
  // happily keeps scrolling underneath a swipe that is carrying the whole page away. Freezing
  // the scroller for the duration is the standard fix: one re-render as the gesture takes over,
  // and iOS drops its in-flight tracking the moment scrolling is disabled.
  const [swipeLocked, setSwipeLocked] = useState(false);
  // `detailsActive`, but lagging past the 240ms reveal/collapse animation: the HEAVY mode flips
  // (the standby render window, the image warm-ahead) key off THIS, so page cells mount and lists
  // re-window after the transition has finished instead of chopping it mid-flight. What must NOT
  // key off it is anything that changes the SHAPE of the stitched window — see the adjacent-chapter
  // queries below for what that cost.
  const [detailsSettled, setDetailsSettled] = useState(!readerFirst);
  // Whether the ENTRANCE animation has finished (the zoom spring's completion callback flips it —
  // see startZoom). The zoom scales the WHOLE destination screen behind a growing mask, and a
  // reader-first open whose pages are already cached (a sequence open, a History revisit) would
  // otherwise mount the entire pager — list, cells, warm-ahead — in the very commit the spring
  // starts, on the thread the spring is drawing on. So the pane rides `standby` until this flips:
  // the visible page mounts and paints (it is what the entrance reveals), everything else waits
  // out the flight — the same deferral `detailsSettled` gives the reveal, applied to the open.
  // Starts SETTLED on web and on a pushed card: there is no entrance there to defer behind (see
  // `startZoom`), so the page has nothing to wait out and the pager may mount in the first commit
  // like anything else. Details sliding up over their reader too: they open on that reader's page.
  const [entranceSettled, setEntranceSettled] = useState(IS_WEB || nativePush || revealIn);
  const markEntranceSettled = useCallback(() => setEntranceSettled(true), []);
  const pushSettled = usePushSettled();
  useEffect(() => {
    const t = setTimeout(() => {
      // Traced because this is the largest React commit anywhere near a reveal and it lands 300ms
      // after it — the standby window opens, page cells mount, both lists re-window, all at once,
      // and on iOS that commit runs on the main thread, which is the thread the reveal is drawing
      // on. Keep it: it is the mark that says whether a stutter belongs to the reveal itself or to
      // the work scheduled behind it.
      traceJS('reveal', 'settle', { details: detailsActive });
      setDetailsSettled(detailsActive);
    }, 300);
    return () => clearTimeout(t);
  }, [detailsActive]);
  // EAGER, deliberately — not deferred behind `detailsSettled` like the render window is.
  //
  // A run can only take its previous chapter at the instant it is created (see the window below),
  // so how soon these resolve decides whether the FIRST chapter boundary you read backward across
  // is seamless. Deferring them, as this did for a while, guaranteed they lost that race on every
  // cold open.
  //
  // The cost is two page LISTS — cache-first, and a list is just URLs. It does not mount page cells
  // or warm images: both of those key off `standby`/`detailsSettled` in ReaderPane, unchanged.
  const { data: prevPages, error: prevPagesError } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', prevChapter?.id ?? ''),
    enabled: stitched && !!id && !!prevChapter,
  });
  const { data: nextPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', nextChapter?.id ?? ''),
    enabled: stitched && !!id && !!nextChapter,
  });

  // Declared up here, though nothing sets it until the collapse reaction far below: the stitching
  // underneath has to read it.
  const [collapsing, setCollapsing] = useState(false);

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
  // any other. Standby is excluded like every other image request on this screen.
  useEffect(() => {
    if (!stitched || detailsSettled || !prevChapter || !prevPages?.length) return;
    if (segments.some((s) => s.id === prevChapter.id)) return;
    warmPageImages(prevPages.slice(-1 - WARM_BEHIND));
  }, [stitched, detailsSettled, prevChapter, prevPages, segments]);

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
  useDimWindowControls(!chromeVisible && !detailsActive);
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
    if (Platform.OS !== 'web' || detailsActive || typeof document === 'undefined') return;
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
  }, [detailsActive]);

  // The keyboard's way into the toolbar (lib/keymap's `reader-controls`): Tab shows it and focuses
  // its first control, it stays up while the focus is in it, Tab and Shift+Tab go round inside it,
  // and Escape hands the keys back to the page. Becoming the reader of the top layer drops whatever
  // focus was left behind on the screen it covers, or Space would press that again.
  const chromeId = useId();
  useEffect(() => {
    if (!IS_WEB || !isTop || detailsActive || typeof document === 'undefined') return;
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
  }, [isTop, detailsActive, chromeId, showChrome, holdChromeFor]);

  // Pinch-zoom / an active scrub both suspend the reveal pan (a one-finger drag pans the zoomed
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

  // ── The reveal: reader ⇄ details card ────────────────────────────────────
  // `progress` (0 = reader, 1 = details) is the single source of truth, written on the UI thread
  // by the pans below and animated by `setRevealed`. `detailsActive` mirrors the committed side
  // for everything JS-side (gesture enabling, back handling, status bar). The screen opens ON the
  // details (reader collapsed to the strip) — unless `reader: '1'` brought us here, in which case
  // it opens on the READER and the details are one swipe away, which is the same gesture either
  // entry ends up using. A split page handed the move starts where the other page left it (see
  // SplitHandoff).
  const progress = useSharedValue(stripFrom ? stripFrom.progress : readerFirst || revealIn ? 0 : 1);
  // The details page's internal scroll offset (SeriesBody's list writes it on the UI thread via
  // the same `sharedValues` wiring pull-to-refresh uses) — drives the strip occlusion, the top
  // bar's scroll crossfade, and the pull-past-top reveal.
  const detailsScrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset: detailsScrollOffset }), [detailsScrollOffset]);
  // UI-thread mirror of `detailsActive`, for the worklets below (the iOS pull-follow must stop the
  // instant a commit animation takes over `progress`).
  const detailsActiveSV = useSharedValue(!readerFirst);
  // `dismissing` freezes the collapse pan once an exit animation owns the transition. (It used to
  // sit beside `dismissX`/`dismissY`, the old swipe-away's 2D offsets; the swipe-away drives the
  // collapse itself now, so those are gone and this is what's left of that trio.)
  const dismissing = useSharedValue(false);
  // The iOS pull-past-top follow (the reaction below): whether it currently owns `progress`,
  // and where `progress` stood when the pull engaged (the pull maps relative to it).
  const pullEngagedSV = useSharedValue(false);
  const pullStartSV = useSharedValue(1);
  // This page is on its way out under a system pop — UIKit's zoom dismissal claims the same
  // pull-down at the top that the pull above reads, and a release then must not push the reader
  // onto a page that is leaving. Mirrored from the stack's transition events (see `ClosingNavigation`).
  const closingSV = useSharedValue(false);

  // Arms the deferred series queries (`seriesWanted`, sequence mode) the moment the reveal STARTS
  // moving — not when it commits — so the card the swipe uncovers is already fetching, for the
  // series the swipe is revealing. Non-sequence instances are armed from mount; the arm is a
  // no-op there.
  useAnimatedReaction(
    () => progress.value > 0.02,
    (revealing, was) => {
      if (revealing && !was) runOnJS(armSeriesQueries)();
    },
    [armSeriesQueries],
  );

  // Geometry: the reader strip's height — the top-of-page band the details content starts below.
  // The details layer itself is full-screen (the strip is page, not chrome). Declared up here
  // because it is also the zoom's DESTINATION BOUND (see zoomGeom), and the split's hand-off
  // below reads the strip's rect.
  const bandH = insets.top + HEADER_BAND;
  // Content starts high enough that the series title's center lands on the seam gradient's
  // center — the strip fades into the details THROUGH the title.
  const headerTopInset = bandH - SHEET_FADE_H / 2 - TITLE_MID;
  // The split details' strip as the zoom source of the reader page it pushes (see ZoomSource).
  const tab = useTabRoute();
  const [stripZoomId, setStripZoomId] = useState<string | null>(null);
  const stripZoomHref = useMemo(
    () => (splitDetails && IS_IOS ? (tab ? tabHref(tab, '/series/read', {}) : '/series/read') : null),
    [splitDetails, tab],
  );

  /**
   * Reading STARTED, in the pane — so hand this series to the full-screen route, over the pane.
   *
   * A reader is the one thing on web that still takes the whole window (see components/series-pane),
   * and the details half of this screen is what the pane exists to show. The handover is an ordinary
   * reader-first push — the same params a History row carries — because `openSeriesPane` declines
   * those on purpose; there is no exit hatch here that the rest of the app doesn't already use.
   *
   * The pane is not closed: closing the reader comes back to it as it was, stack and all.
   *
   * The split details page (see SeriesSplit) hands off the same way, to its reader page: on iOS a
   * tab's, which zooms out of the strip while the strip is on screen, and elsewhere one that grows
   * out of the strip itself (see SplitHandoff).
   *
   * Answers false everywhere else, which is every other native page and every narrow viewport, so
   * the reveal below is untouched there.
   */
  const inPane = useSeriesPaneWidth() !== null;
  // Outside the pane, off iOS, the details hand their strip to the reader page (see SplitHandoff).
  const handsStripOff = splitDrawn && splitDetails && !inPane;
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
  const leavePaneToRead = useCallback((at: ReadTarget | null = target): boolean => {
    if (!inPane && !splitDetails) return false;
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
      return true;
    }
    setPaneHandoffs((n) => n + 1);
    if (!splitDetails || inPane) {
      router.push({ pathname: '/series/read', params: next });
      return true;
    }
    // Scrolled mostly away under the details, the strip is no source to grow out of.
    const zoomFrom = detailsScrollOffset.get() < headerTopInset / 2 ? stripZoomId : null;
    router.push({ pathname: '/series', params: withZoomSource(next, zoomFrom) });
    return true;
  }, [
    inPane,
    splitDetails,
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
  // Leaving this instance. The modal ROOT pops the route (deep-linked/full-page-loaded entries
  // on web have no back stack — land on the browse tabs instead of dead-ending); on a pushed card
  // that pop IS the exit, the system's slide (useNativePush). A drilled
  // LAYER never touches navigation: it collapses on the same `zoom` the back-swipe drags
  // (closeLayer — chevron/hardware back), or is removed outright once a gesture has already
  // collapsed it / flown the page out (leaveNow — the parent series is live beneath).
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  /** This instance's key in the module-level latches (LEFT, HELD_POPS) — see `leaveOnce`. */
  const token = useMemo(() => ({}), []);
  // The router drops a second back inside its double-tap window (lib/nav-guard), and a dropped
  // pop at the END of an exit strands the page: gone from view, still on top, LEFT latched
  // against another try. Leaving the reader page for the details and then the details is two
  // backs in a row, so it is the common case, not a corner. A press asks first and does nothing
  // inside the window, like any other back in the app (closeLayer); a gesture has already moved
  // the page, so its pop waits the window out instead.
  const routeBackHeld = useCallback(() => depth === 0 && !inPane && msUntilClaimable(BACK_TARGET) > 0, [depth, inPane]);
  useEffect(() => () => clearTimeout(HELD_POPS.get(token)), [token]);
  const popRoute = useCallback(() => {
    const attempt = () => {
      const wait = inPane ? 0 : msUntilClaimable(BACK_TARGET);
      if (wait > 0) HELD_POPS.set(token, setTimeout(attempt, wait));
      else goBack();
    };
    attempt();
  }, [token, inPane, goBack]);
  const leaveNow = useCallback(() => {
    // Bracketed in the trace with the unmount below, so a recording measures the TEARDOWN — popping
    // the route, unmounting the page, un-blanking the source card — as its own span. It is the last
    // thing that happens on a collapse and the only thing left at that end of it; `frame LONG` lines
    // falling between these two say what it costs, which is the number any attempt to shrink it
    // would have to beat.
    traceJS('leave', 'start', { depth });
    if (depth > 0) onPopLayer();
    else popRoute();
  }, [depth, onPopLayer, popRoute]);
  useEffect(() => () => traceJS('leave', 'unmounted', { depth }), [depth]);
  // The other end of the page's life. Teardown measured 9-44ms and turned out not to be worth
  // attacking; this is the half that hasn't been measured, and it is the larger one — a whole
  // details tree mounts here while the entrance animation plays.
  useEffect(() => traceJS('open', 'mount', { depth }), [depth]);
  // EVERY exit animation ends here rather than calling `leaveNow` directly, because an animation
  // callback is not a promise that it ran: reanimated reports `finished: false` for a curve that
  // got interrupted, and an exit that reached its end state without leaving stranded the page —
  // mounted, invisible or shrunk, and still swallowing touches. So the exits below fire this
  // whether or not the curve finished, AND arm a wall-clock backstop, and this makes the extra
  // calls harmless.
  /**
   * …and this latch is what makes them harmless. It is a PLAIN JS BOX, and that is the fix for a
   * real bug rather than a style preference.
   *
   * It used to be a shared value, on the reasoning that the pan is built during render so nothing
   * its worklets reach may touch a React ref. True of the worklets — but `leaveOnce` is not one.
   * Every caller reaches it through `runOnJS`, so it only ever executes on the JS thread, where a
   * shared value is the wrong instrument: a `.set()` here is not guaranteed visible to a `.get()`
   * in the next JS task, because the value's home is the UI thread. So two exits firing off one
   * frame — the leave reaction and the collapse spring's completion, which by design both mean
   * "arrived" — each read the latch as false and each ran.
   *
   * A device trace caught it exactly:
   *
   *     leave start depth=2 / layer pop from=2 left=1
   *     leave start depth=2 / layer pop from=1 left=0
   *
   * One instance leaving, two pops — so dismissing a series drilled from a search layer took the
   * search layer with it and landed back on the series underneath. Only via the swipe, because the
   * chevron path has a single caller and never exercises the latch at all.
   *
   * Held in a module-level WeakSet keyed on a per-instance token, which is the one shape both lint
   * rules allow here: `useRef` is out because the pan is built during render, and mutating a
   * `useMemo` result is out too — so the memo hands out an identity and the mutation happens in the
   * set. Plain JS, one thread, no cross-runtime visibility to reason about.
   */
  const leaveOnce = useCallback(() => {
    if (LEFT.has(token)) return;
    LEFT.add(token);
    leaveNow();
  }, [token, leaveNow]);
  // NOTE: nothing here tracks "this page is leaving". It used to — `const [leaving, setLeaving] =
  // useState(false)`, flipped from inside the commit — and that re-rendered all of
  // SeriesReaderInstance on the frame the collapse animation started. Profiles measured that render
  // at 40–114ms, and on iOS the UI thread IS the main thread, so the native commits behind it land
  // on the one thread the animation needs. A stutter on every single exit, unreachable by any amount
  // of animation tuning because the animation was never the problem. The two things that flag bought
  // — dropping touches on a page on its way out, and the wall-clock backstop — both live in
  // `LeavingMask` now, which reads `edgeCommitting` itself and re-renders nothing but itself.
  const edgeCommitting = useSharedValue(false);
  // The reader page going back into the strip it grew out of (see SplitHandoff): its bottom edge
  // rises onto the details' strip, and the route pops once there is nothing of it left to see.
  const shrinkToStrip = useCallback(() => {
    if (LEFT.has(token)) return;
    setChromeVisible(false);
    // Freezes the reader's own drags for the way out.
    detailsActiveSV.set(true);
    edgeCommitting.set(true);
    progress.set(
      withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }, () => {
        runOnJS(leaveOnce)();
      }),
    );
  }, [token, detailsActiveSV, edgeCommitting, progress, leaveOnce]);
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

  // JS-side half of a commit — deliberately closes over nothing but state setters (no shared
  // values, no timer refs), so the gesture worklets can `runOnJS` it; the worklets animate
  // `progress` themselves. Landing back in the reader re-shows the chrome (it may have auto-hidden
  // while the details were up) — the effect below re-arms the countdown.
  const commitReveal = useCallback((to: 0 | 1) => {
    // `to` 0 means the READER is now the side on screen. Traced because the reported flash is on
    // that transition specifically, and the question is what the reader side has to show at the
    // instant it becomes visible — see the `reader ready` mark below for the other half.
    traceJS('reveal', 'commit', { toReader: to === 0 });
    if (to === 1 && split === 'reader') {
      leaveReaderForDetails();
      return;
    }
    if (to === 0 && leavePaneToRead()) return;
    setDetailsActive(to === 1);
    if (to === 0) setChromeVisible(true);
  }, [split, leavePaneToRead, leaveReaderForDetails]);
  useEffect(() => {
    if (!detailsActive) scheduleHide();
  }, [detailsActive, scheduleHide]);
  // Full JS-side reveal (pill, grab-handle, hardware back, chapter/page intents).
  const setRevealed = useCallback(
    (to: 0 | 1, at?: ReadTarget) => {
      // Ahead of the 240ms reveal, not just at its commit: in the pane the reader is not where
      // this is going, so playing the reveal first would show a page at pane width and then
      // replace it.
      if (to === 0 && leavePaneToRead(at)) return;
      if (to === 1 && split === 'reader') {
        leaveReaderForDetails();
        return;
      }
      detailsActiveSV.set(to === 1);
      pullEngagedSV.set(false); // the commit animation owns `progress` — stop any live pull-follow
      progress.set(withTiming(to, { duration: 240, easing: Easing.out(Easing.cubic) }));
      commitReveal(to);
    },
    [progress, detailsActiveSV, pullEngagedSV, commitReveal, leavePaneToRead, split, leaveReaderForDetails],
  );
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
    if (revealIn) {
      progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }));
    }
    // Mount-only: an instance takes its hand-off once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The collapsed reader strip is the top of the details PAGE, so its reveal is the page's own
  // overscroll — any pull past the top rides the native rubber-band down, with the whole page
  // (background sheet + content, see headerSheetBgStyle) following the finger and the reader
  // fading in above. No arming/freeze: the content moving WITH the pull is the point.
  //
  // Like the pans, the follow is RELATIVE: it engages only when the offset crosses past the top
  // (capturing `progress` where it stands, so a pull that begins mid-animation continues the
  // motion instead of snapping to the absolute position), and a release that didn't commit
  // ANIMATES back to the details rather than hard-setting. Without the engage gate, the
  // rubber-band bounce still settling after a pull-commit would stomp a quick follow-up
  // collapse animation — the "completes instantly" chop.
  const headerSpan = Math.max(1, height - (insets.top + HEADER_BAND));
  // The details travel VERTICALLY in both reading modes. Webtoon used to reveal them horizontally
  // — they exited left, uncovering the reader — on the theory that vertical finger language
  // belongs to the scroll there. That is still true of the GESTURE, and is why webtoon no longer
  // reveals the details by dragging at all (see the collapse pan): the Details button is the way
  // back. But the button's animation has no axis to match, and having the two modes slide the
  // page in different directions made the same control behave like two different controls.
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
      if (off < 0) {
        if ((prevOff ?? 0) >= 0) {
          pullEngagedSV.set(true);
          pullStartSV.set(progress.value);
        }
        // The split details page only rubber-bands: the reader is the page its release pushes.
        if (pullEngagedSV.value && !splitDetails) {
          progress.set(Math.max(0, Math.min(1, pullStartSV.value + off / headerSpan)));
        }
      } else if (pullEngagedSV.value) {
        pullEngagedSV.set(false);
        if (progress.value < 1) {
          progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        }
      }
    },
    [headerSpan, splitDetails, detailsScrollOffset, detailsActiveSV, pullEngagedSV, pullStartSV, closingSV, progress, scrollTraceGate],
  );
  const onDetailsScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      traceJS('details.scroll', 'endDrag', { y: e.nativeEvent.contentOffset.y, active: detailsActive });
      if (!IS_IOS || !detailsActive) return;
      // The UI-thread release watcher (pullReleaseWatch below) usually lands this commit first;
      // the shared-value mirror is already false then — don't restart its animation. This JS
      // path remains the full fallback when those touches weren't observed.
      if (!detailsActiveSV.get() || closingSV.get()) return;
      if (e.nativeEvent.contentOffset.y <= -PULL_COMMIT_PX) setRevealed(0);
    },
    [detailsActive, detailsActiveSV, closingSV, setRevealed],
  );

  // ── The zoom's shared values ────────────────────────────────────────────────────────────────
  // Hoisted above the gestures because BOTH of them drive the collapse now: the back-swipe and
  // the expanded reader's dismiss. Their comments live with the machinery that reads them.
  // …and the DESTINATION BOUND: this page's own hero cover, measured. The library takes this from a
  // `Transition.Boundary.View` in the destination screen and its whole zoom is built around the
  // pairing — the destination's copy of the picture is what lands on the tapped card, which is why
  // its demo reads as the thumbnail itself expanding. Aligning to anything else (the reader band,
  // as the first cut of this port did) puts unrelated content in the card-shaped window and the
  // connection to the thumbnail is lost.
  // 0 = the thumbnail is sitting on its card and the page is invisible, 1 = the page is up and
  // the thumbnail is gone.
  // A split page handed the move starts up: that move is `progress`'s (see SplitHandoff).
  const zoom = useSharedValue(splitHandoff ? 1 : 0);
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
  const zoomArmed = useSharedValue(false);
  // Which set of cross-fade ranges is in play (see the constants) — an exit uses different ones.
  const zoomClosing = useSharedValue(false);
  /** Whether the close in play is the reader's dismiss, which has its own fade pair (see
   *  ZOOM_THUMB_FADE_CLOSE_READER). Latched by every closing path alongside `zoomClosing`, never
   *  read live off `detailsActiveSV`: a collapse must not swap curves part way through. */
  const zoomReaderClose = useSharedValue(false);
  // The flying copy's IMAGE aspect (w/h), captured from its own onLoad. 0 = not yet known. What
  // the sequence-mode copy morph needs (see zoomThumbStyle): the copy's rect interpolates toward
  // the image's true fit rect, and only the image itself knows its shape.
  const zoomThumbAspect = useSharedValue(0);
  /** The reader dismiss's LAUNCH DIRECTION, as a unit vector, latched the first frame the drag has
   *  enough distance to have one. (0, 0) until then, and cleared by every gesture. */
  const dismissDirX = useSharedValue(0);
  const dismissDirY = useSharedValue(0);
  /** How much of the collapse the flying copy should treat as having happened, 0..1. 1 everywhere
   *  except a reader dismiss dragged back the other way — see that gesture's onUpdate, and
   *  `zoomThumbStyle`, which applies this to the copy's OPACITY alone. */
  const zoomThumbBias = useSharedValue(1);
  /** Which corner curve the window is on. Set by every closing path alongside `zoomClosing`, but
   *  NOT cleared with it — see the reaction below, and `ZOOM_RADIUS_ROUNDED_BY_CLOSE`. */
  const zoomRadiusClosing = useSharedValue(false);
  // Back-swipe (details mode): the native stack's pop gesture, recreated — the route is a
  // contained transparent modal (needed for the reader's dismissal reveal), which doesn't get
  // the real one. A decisive rightward drag ANYWHERE on the details (full-surface, like the
  // platform's full-screen pop) starts the COLLAPSE under the finger, and on release finishes it
  // from wherever it got to. It no longer slides the page off sideways: the drag scales the page
  // down in place, with resistance on the drag axis and a loose follow on the cross axis, exactly
  // as the reader's own swipe-away treats a page — and then hands that scale straight into the
  // gallery collapse. See the drag helpers above; this is the library's zoom/drag.ts model.
  //
  //  · zoom itself is what the finger moves — 1 open, 0 collapsed onto the card.
  //  · dragX/dragY — the resisted follow, added to the page's transform and faded out by the
  //    collapse, so a page released well off to the side still lands exactly on its card.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** See `zoomHoming`. Every path that drives `zoom` sets this first — there is no default that is
   *  right for all of them, and a stale one is a page that converges on the wrong thing. */
  const homeAt = useSharedValue(0);

  /**
   * THE leave trigger: the page having actually reached the card. One reaction for every exit —
   * the chevron, hardware back, the reader's dismiss fling, and the details back-swipe.
   *
   * All four used to leave from their own spring's completion callback, deliberately ignoring
   * `finished` on the grounds that an interrupted collapse is still a collapse and a page that
   * animates out without leaving is stranded. That reasoning holds for a curve interrupted AT its
   * end state. It is exactly wrong for one interrupted at the START — and something opening the
   * page can still be writing `zoom` a moment later (the entrance spring, a late `startZoom` once
   * the hero cover measures — see ZOOM_BOUND_WAIT_MS). Any such write cancels the collapse, the
   * callback fires regardless, and the page vanishes on the frame the finger lifted. Which is
   * precisely the report: close soon after opening and the animation "finishes as soon as I let go".
   *
   * Asking the VALUE instead of the curve removes the whole class. It cannot fire early, because
   * zoom at the card is what leaving means; and it cannot strand the page, because a collapse that
   * gets cancelled before arriving is still covered by the wall-clock backstop above.
   */
  /**
   * Retire the closing corner curve only once the page has actually got back to the top.
   *
   * `zoomClosing` cannot do this job: `settle` clears it on the frame a cancelled swipe releases,
   * which is mid-springback, where the two curves disagree by most of a corner. Waiting for zoom
   * itself puts the flip at q = 1, where both curves give 0 and the swap is invisible.
   */
  useAnimatedReaction(
    () => zoom.value >= ZOOM_RADIUS_CURVE_SWAP_AT,
    (home) => {
      if (home) zoomRadiusClosing.set(false);
    },
  );
  useAnimatedReaction(
    () => edgeCommitting.value && zoom.value <= LEAVE_AT_ZOOM,
    (arrived, was) => {
      if (arrived && !was) runOnJS(leaveOnce)();
    },
  );

  // Collapse/dismiss pan — wraps the expanded reader, on the cross axis of its scroll: the
  // collapse direction (up in paged, right in webtoon) slides the details back in; the opposite
  // direction dismisses — and that dismissal now runs THE SAME GALLERY COLLAPSE the back-swipe and
  // the chevron run: mask closing onto the card, page cross-fading out, the thumbnail copy fading
  // in and landing on it. The finger-follow is free and unclamped in 2D and the release decision
  // reads the cross-axis offset alone — what a dismissal must NOT do is fling out along the
  // gesture's own vector, which had nowhere to land. Built inside
  // useMemo like chapter-navigator's pan (the React Compiler lint can't tell worklets from render
  // code).
  // Never under a mouse: a drag there is a PAN of the page, and a pan that set off the reveal or the
  // dismiss took the reader away mid-read. The desktop has the Details button and Back for those.
  const collapseEnabled = !detailsActive && !readerZoomed && !scrubbing && !(IS_WEB && isDesktopPointer());
  // The split reader's swipe away, paged, on iOS. UIKit's zoom dismissal takes the swipe DOWN (the
  // screen's `gestureEnabled`) and carries the page and the bar back into the strip. It never
  // starts on a swipe up, so that half is this pan's: the page lifts and shrinks under the finger,
  // and a committed release runs the same native pop the back button does.
  const swipeAway = nativePush && split === 'reader' && params.from === 'details' && settings.mode === 'paged';
  const liftY = useSharedValue(0);
  // Each GESTURE is one thing, decided at activation and locked: a drag that sets off toward the
  // details is a reveal (progress only, and paged only); anything else is a dismiss — a free 2D
  // follow in BOTH directions, released on the |cross| decision below, driving the
  // collapse. A new gesture that begins while the page hasn't settled from a previous dismiss drag
  // is always a dismiss — only a settled page reveals the details on a swipe.
  const gestureMode = useSharedValue<0 | 1 | 2>(0); // 0 undecided, 1 reveal, 2 dismiss
  // Where `progress` stood when the gesture locked — drags map RELATIVE to it, so a gesture that
  // begins mid-animation continues the motion from where it is instead of snapping to the drag's
  // absolute position (the "fast-forward" chop under quick successive swipes).
  const progressStartSV = useSharedValue(0);
  const panBeganSV = useSharedValue(false);
  const collapsePan = useMemo(() => {
    // A split reader has no details of its own to drag up. One grown out of their strip drags back
    // into it (see SplitHandoff); any other brings them up with its Details button.
    const revealByDrag = settings.mode === 'paged' && (split !== 'reader' || stripReader);
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
          // detailsActiveSV double-checks `enabled` INSIDE the worklet — RNGH web can keep a
          // rebuilt-disabled recognizer live, and a stale reader pan must never act while the
          // details own the screen (and vice versa for returnPan below).
          if (dismissing.value || detailsActiveSV.value) return;
          const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
          // Lock the gesture's mode at the first REAL movement (web fires its opening updates
          // with translation 0 — deciding on that frame mislabels every drag). A gesture
          // beginning while the page hasn't settled from a previous dismiss drag is always a
          // dismiss gesture.
          if (gestureMode.value === 0) {
            const settled = zoom.value > 0.999 && Math.hypot(dragX.value, dragY.value) <= 1;
            if (!settled) gestureMode.set(2);
            else if (Math.abs(cross) >= 2) {
              // WEBTOON never reveals by dragging — the Details button is the only way back, so
              // every drag here is a dismiss. Its cross axis is horizontal (vertical belongs to
              // the scroll), and a horizontal drag that revealed would be the one gesture on this
              // screen going somewhere other than out.
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
          // direction drives it, since unlike the back-swipe this gesture has no single axis to
          // measure along.
          zoomClosing.set(true);
          zoomReaderClose.set(true);
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
            active: detailsActiveSV.value,
          });
          if (dismissing.value || detailsActiveSV.value) return;
          if (gestureMode.value === 1) {
            const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
            const crossVelocity = settings.mode === 'paged' ? e.velocityY : -e.velocityX;
            // Same projected release as everywhere else, along the direction that OPENS the
            // details (which is negative `cross`).
            const open = releaseCommitted(-cross, -crossVelocity, span * REVEAL_COMMIT_FRACTION);
            detailsActiveSV.set(open);
            progress.set(withTiming(open ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
            runOnJS(commitReveal)(open ? 1 : 0);
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
          // same velocity handoff and the same one-way `edgeCommitting` latch as the back-swipe —
          // see there for why a committed collapse must never be settled back.
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
            // `zoom` actually reaching the card (see the reaction near leaveOnce).
            withSpring(0, { ...ZOOM_OUT_SPRING_READER, overshootClamping: true, velocity: -throwSpeed }),
          );
        })
        // Always fires once the gesture resolves (release OR cancel) — the next gesture decides
        // its own mode fresh.
        .onFinalize((_e, success) => {
          if (swipeAway && !success) liftY.set(withSpring(0, SPRING_BACK));
          // A cancelled dismiss drag never reaches onEnd — don't leave the page part-collapsed.
          // Same `success` test as the back-swipe's, for the same reason.
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
    split,
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
    detailsActiveSV,
    commitReveal,
    homeAt,
    zoom,
    zoomClosing,
    zoomReaderClose,
    dragX,
    dragY,
    edgeCommitting,
  ]);

  // Band pan. The strip (the reader band at the top of the details page) expands the reader the
  // same way the page's own overscroll does: a tap, or a DOWNWARD drag that slides the whole
  // details page down under the finger. (The expanded reader's gestures are collapsePan above.)
  const bandPan = useMemo(() => {
    // The drag axis follows the reveal axis: paged drags the strip DOWN (the details slide down
    // away); horizontal-reveal (webtoon) drags it LEFT (the details exit left). Same relative
    // follow + commit either way.
    const span = headerSpan;
    const pan = Gesture.Pan()
      // The split details' strip takes a tap: what it opens is a page, not a side to drag in.
      .enabled(detailsActive && !(splitDetails && !splitDrawn))
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
        runOnJS(commitReveal)(open ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
    pan.activeOffsetY([-20, 20]).failOffsetX([-15, 15]);
    return pan;
  }, [
    detailsActive,
    splitDetails,
    splitDrawn,
    handsStripOff,
    headerSpan,
    panBeganSV,
    progressStartSV,
    progress,
    detailsActiveSV,
    commitReveal,
  ]);

  // Reveal pan — on the details layer, for platforms without the native rubber-band (the iOS
  // path is the reaction above). Both modes now, since the reveal is vertical everywhere: the
  // details page reveals the reader by moving DOWN, sharing the vertical axis with
  // the details' own scroller, so it activates MANUALLY — only a clearly-downward drag with the
  // content at its top pulls the page down; everything else fails fast and the list scrolls.
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const returnPan = useMemo(() => {
    // Horizontal-reveal mode has no vertical pull-reveal (a downward drag must not slide the
    // page sideways) — the leftward reveal pan below is its gesture.
    return Gesture.Pan()
      .enabled(detailsActive && !IS_IOS)
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
        // detailsActiveSV double-checks `enabled` INSIDE the worklet — RNGH web can keep a
        // rebuilt-disabled recognizer live, and a stale details pan must never act while the
        // reader owns the screen.
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
        runOnJS(commitReveal)(close ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
  }, [
    detailsActive,
    handsStripOff,
    headerSpan,
    panBeganSV,
    progressStartSV,
    progress,
    touchStartX,
    touchStartY,
    detailsScrollOffset,
    detailsActiveSV,
    commitReveal,
  ]);

  // ── The ZOOM: how this instance arrives and leaves ───────────────────────────────────────────
  // Where the page came FROM: the cover box of the card that was tapped, in window coordinates
  // (lib/series-zoom). EVERY instance takes one — a drilled layer is opened from a card in a
  // related rail (or a nested search result), and that is just as much an "open this series" as a
  // tap on the browse grid, so it gets the same entrance rather than a push.
  //
  // Consumed in a state initializer so it's known on the FIRST render — a frame later would start
  // the grow from the wrong geometry. The ENTRANCE keeps this rect; the exit re-aims off it via
  // `heroShift`, because on a last-read list the card has moved by then. Don't freeze the exit to it.
  // A pushed card takes none either: its entrance is the system's slide (useNativePush). Nor a split
  // page handed the move, which draws its own (see SplitHandoff).
  const [zoomSource] = useState(() => (IS_WEB || nativePush || splitHandoff ? null : takeZoomOrigin(id)));
  /**
   * How far the source card has moved since capture, applied only at the collapsed end (scaled by
   * `1 - q`). Kept out of `hero` so `zoomGeom` and its styles never recompute mid-flight; sprung, so
   * a row that moves during a collapse curves the transition to it rather than snapping. Only x/y —
   * a reorder moves a row without resizing it, which keeps `zoomGeom` valid throughout.
   */
  const heroShiftX = useSharedValue(0);
  const heroShiftY = useSharedValue(0);
  // The source rect this page aligns itself to. No image is needed — unlike a classic shared
  // element, nothing is copied or flown; the page is its own transition subject (see zoomMaskStyle).
  const hero = zoomSource?.origin ?? null;
  // The tapped card's shape, handed to the details so its hero cover opens at the same aspect —
  // which is what keeps the zoom's destination bound honest for a bridge whose covers aren't 2:3.
  // See `coverAspect` in SeriesDetailsHost.
  const heroAspectSeed = hero && hero.height > 0 ? hero.width / hero.height : undefined;
  const [destBound, setDestBound] = useState<ZoomRect | null>(null);
  const zoomStartedRef = useRef(false);
  // Blanking the source card is tied to ARMING, not to mount: the wait for the destination
  // measurement happens with everything here invisible, and a card blanked during it would just be
  // a hole in the grid. From arming on it stays blanked for this page's whole life — the copy
  // stands in for it, and the collapse spends most of its length with a half-transparent page over
  // the live grid, which is where showing both would be obvious.
  //
  // …and it also waits for the COPY TO HAVE PIXELS, which is the rest of the same thought. The
  // copy's <Image> only mounts once `zoomGeom` exists, and `zoomGeom` and the arm land in the SAME
  // commit — both hang off the hero rect report below — so the copy is a brand new image view at
  // the moment the animation starts, and a brand new image view has nothing to draw for at least a
  // frame even when the bitmap is already in memory. Blanking the card on that frame left a hole
  // exactly where the eye was: the card gone, the copy not yet there, the page still at opacity 0.
  // That is the flash on tapping a card.
  //
  // Waiting costs nothing, because the two are INTERCHANGEABLE while it waits: the copy is laid out
  // on the tapped card's own rect and drawn from the card's own cover URL (the route's `cover`
  // param IS `entry.cover`), so for those frames the real card showing through the not-yet-painted
  // copy is the correct picture. `blankSource` is called from both ends and acts on whichever is
  // last.
  const zoomReleaseRef = useRef<(() => void) | null>(null);
  const thumbPaintedRef = useRef(false);
  const blankBackstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      zoomReleaseRef.current?.();
      if (blankBackstopRef.current) clearTimeout(blankBackstopRef.current);
    },
    [],
  );
  const blankSource = useCallback(() => {
    if (zoomReleaseRef.current) return;
    if (!zoomStartedRef.current || !thumbPaintedRef.current) return;
    if (blankBackstopRef.current) {
      clearTimeout(blankBackstopRef.current);
      blankBackstopRef.current = null;
    }
    // Blank the ONE card this grew out of — not every card showing this series (see the module).
    // Traced with this instance's DEPTH, which is the piece `zoom hold` in the module can't know:
    // with a series, its tag search and that same series again all mounted at once, the question
    // behind a card coming back unblanked is which of them owned it.
    if (zoomSource && id) {
      traceJS('zoom', 'blank', { depth, src: zoomSource.source });
      zoomReleaseRef.current = holdZoomingSeries(id, zoomSource.source);
    } else {
      traceJS('zoom', 'blank.none', { depth });
    }
  }, [zoomSource, id, depth]);
  /** The copy reported pixels. Wired to its `onError` as well as its `onLoad` — a cover that is
   *  never going to draw is not a reason to keep two of it on screen forever. The load event also
   *  carries the image's intrinsic size, which feeds the sequence-mode copy morph. */
  const onZoomThumbPainted = useCallback(
    (e?: unknown) => {
      const src = (e as ImageLoadEventData | undefined)?.source;
      if (src?.width && src.height) zoomThumbAspect.set(src.width / src.height);
      thumbPaintedRef.current = true;
      blankSource();
    },
    [blankSource, zoomThumbAspect],
  );
  const startZoom = useCallback(() => {
    if (zoomStartedRef.current) return;
    zoomStartedRef.current = true;
    blankSource();
    // The wait is BOUNDED, and the bound is about the collapse rather than the open. Through an
    // open the card ends up behind an opaque page, so a copy that never loads leaves the real card
    // harmlessly underneath it; the collapse is the direction where two of them would show. Long
    // enough that a decode is never cut short, far shorter than any collapse.
    if (!thumbPaintedRef.current) {
      blankBackstopRef.current = setTimeout(() => {
        blankBackstopRef.current = null;
        thumbPaintedRef.current = true;
        blankSource();
      }, ZOOM_THUMB_PAINT_WAIT_MS);
    }
    zoomArmed.set(true);
    // Nothing was dragged: the classic collapse, in the card's coordinates from the first frame.
    homeAt.set(0);
    // WEB has no entrance to play. `zoomSource` is null there (see its declaration), so there is no
    // card for the page to grow out of and the spring was a page scaling up from the middle of
    // nothing — which is what read as a laggy fade rather than as an opening. Land on the open state
    // in one frame instead. The COLLAPSE is untouched: that one follows a finger, so it is a
    // response rather than a flourish, and it still needs `zoom` to travel.
    // A pushed card likewise: the slide in is the system's (useNativePush). And a split page handed
    // the move (see SplitHandoff).
    if (IS_WEB || nativePush || splitHandoff) {
      zoom.set(1);
      traceJS('open', 'entered', { finished: true, instant: true });
      return;
    }
    zoom.set(
      withSpring(1, ZOOM_IN_SPRING, (finished) => {
        // Closes the bracket opened at mount — see the effect below. The span between them is the
        // OPEN: mounting the details tree and playing the entrance, which is the cost any scheme
        // for reusing this page instead of rebuilding it would be buying back.
        trace('open', 'entered', { finished: !!finished });
        // Fires on cancellation too (finished: false) — an interrupted entrance must still open
        // the pane's window, or a dismissal begun mid-entrance would strand it at standby.
        runOnJS(markEntranceSettled)();
      }),
    );
  }, [zoom, zoomArmed, homeAt, blankSource, markEntranceSettled, nativePush, splitHandoff]);
  const onHeroCoverRect = useCallback((rect: ZoomRect) => {
    // Only the FIRST report, and only before the geometry is committed: the cover box re-lays out
    // as its aspect settles, and moving the destination mid-flight would visibly jump. What the
    // latch does NOT freeze is where that box has since scrolled to — the geometry carries the
    // scroll offset separately, on the UI thread (see zoomBoundShift).
    if (zoomStartedRef.current) return;
    setDestBound((prev) => prev ?? rect);
  }, []);
  useEffect(() => {
    if (destBound) startZoom();
  }, [destBound, startZoom]);
  useEffect(() => {
    // No source rect at all (deep link, web): nothing to align to, so don't wait for anything.
    // Reader-first skips the wait too, and for a subtler reason: the details card is translated
    // off-screen at progress 0, so its hero cover would measure a rect that isn't on screen. The
    // computed fallback target — derived from the source rect alone — is the right destination
    // when the destination has nothing to show.
    if (!zoomSource || readerFirst) {
      startZoom();
      return;
    }
    const t = setTimeout(startZoom, ZOOM_BOUND_WAIT_MS);
    return () => clearTimeout(t);
    // Mount-only entrance — `zoomSource` never changes for an instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Silent on failure: no registration, an unmounted card or a timed-out probe all leave the shift
   *  alone, which is the captured rect — never a worse answer than not asking. The run counter drops
   *  a walk still settling when a newer surface change starts its own. */
  const exitProbeRun = useRef(0);
  const refreshExitOrigin = useCallback(() => {
    const from = zoomSource?.origin;
    if (!from || !id) return;
    const run = ++exitProbeRun.current;
    void resolveZoomTarget(id, zoomSource, (fresh) => {
      if (exitProbeRun.current !== run) return;
      heroShiftX.set(withSpring(fresh.x - from.x, ZOOM_OUT_SPRING));
      heroShiftY.set(withSpring(fresh.y - from.y, ZOOM_OUT_SPRING));
    });
  }, [heroShiftX, heroShiftY, id, zoomSource]);

  // The chevron / hardware-back exit, for a drilled layer AND the modal root: shrink back into the
  // card we came from, then leave (leaveNow pops the layer, or the route when depth 0). The
  // route's `animation: 'none'` means this IS the exit animation — without it a tapped back would
  // just blink the screen away.
  const closeLayer = useCallback(() => {
    if (LEFT.has(token) || routeBackHeld()) return;
    if (stripReader) {
      shrinkToStrip();
      return;
    }
    // A pushed card has nothing to shrink into — the pop is the exit (useNativePush).
    if (nativePush) {
      leaveOnce();
      return;
    }
    zoomClosing.set(true);
    zoomReaderClose.set(!detailsActiveSV.value);
    zoomRadiusClosing.set(true);
    edgeCommitting.set(true);
    homeAt.set(0);
    // WEB closes in one frame, the mirror of the entrance: with no source card the collapse has
    // nothing to shrink INTO, so it was a page scaling down toward the middle of a grid it never
    // came from. A gesture's release is different and still springs (see the back-swipe's onEnd and
    // the reader dismiss's): there the finger has already moved the page, and cutting the rest
    // would strand it mid-drag. This one is a click, and a click has no motion to finish.
    zoom.set(IS_WEB ? 0 : withSpring(0, ZOOM_OUT_SPRING));
    // No completion callback: leaving is driven by `zoom` reaching the card (see the reaction near
    // leaveOnce), with the `leaving` backstop above as the safety net.
  }, [
    token,
    edgeCommitting,
    homeAt,
    zoom,
    zoomClosing,
    zoomReaderClose,
    zoomRadiusClosing,
    detailsActiveSV,
    nativePush,
    leaveOnce,
    stripReader,
    shrinkToStrip,
    routeBackHeld,
  ]);

  /**
   * Ask the source card where it is, once per collapse. Hung off `zoom` leaving the top rather than
   * off the gestures — the pan, the back-swipe, the chevron and Android back all move it, and a new
   * exit path can't forget to call it. `probed` starts true so the entrance (`zoom` 0→1) can't trip
   * it; reaching the top arms it.
   */
  const probed = useSharedValue(true);
  useAnimatedReaction(
    () => zoom.value,
    (z) => {
      if (z < COLLAPSE_STARTED && !probed.value) {
        probed.set(true);
        runOnJS(setCollapsing)(true);
        runOnJS(refreshExitOrigin)();
      } else if (z > COLLAPSE_ARMED && probed.value) {
        probed.set(false);
        runOnJS(setCollapsing)(false);
      }
    },
  );

  // Only for the few hundred ms it can matter.
  useEffect(() => {
    if (!collapsing || !zoomSource) return;
    return onZoomSurfaceChange(zoomSource.source, refreshExitOrigin);
  }, [collapsing, refreshExitOrigin, zoomSource]);

  // Android hardware back steps back HOME (the details) before leaving: reader expanded → back
  // collapses it; details up → the instance slides out (a drilled layer back to its parent
  // series, the root back to whatever it was opened over). An album has no home but the
  // collection it came from: its Details open over it, so stepping there would never leave.
  // Layer handlers register after their parent's (mounted later), so BackHandler's LIFO order
  // naturally gives the topmost instance the event. (Android-only API — react-native-web's
  // BackHandler stub rejects addEventListener.) Details under their reader page (see SeriesSplit)
  // stay out of it.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isTop) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!detailsActive && !sequence) setRevealed(1);
      else closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [isTop, detailsActive, sequence, setRevealed, closeLayer]);
  // Desktop back steps home the same way — Escape, the chevron, and the shell's mouse back button
  // (which arrives as Escape, see lib/desktop-commands). Not when the desktop pane beneath this
  // reader already shows this series: its details are right there, so stepping home would show
  // them twice, one over the other. A phone-width browser keeps the one-step exit.
  const isDesktop = useIsDesktop();
  const paneShowsThis = useSeriesPaneShowsTop(`${bridgeId ?? ''}:${id ?? ''}`) && !inPane && depth === 0;
  const backStepsHome = !detailsActive && !sequence && (isDesktop || !!desktopShell()) && !paneShowsThis;
  const revealDetails = useCallback(() => setRevealed(1), [setRevealed]);
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
      if (backStepsHome) revealDetails();
      else closeLayer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTop, backStepsHome, revealDetails, closeLayer]);
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
  // `.enabled(detailsActive)` is a NATIVE gate, matching the offsets. With activation decided inside
  // the recognizer, a worklet check inside the callbacks would come too late to stop one.
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
    // on screen is `.enabled()` on each copy below — a native gate, like the offsets themselves.
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
        zoomReaderClose.set(false);
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
        // ONE resisted distance drives both the size and the position — see the reader's copy.
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
    zoomReaderClose,
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
  // ── NOT gated on `detailsActive`, and that is a performance decision ─────────────────────────
  // It carried `.enabled(detailsActive)` for a while, which looks harmless and is not. Rebuilding a
  // gesture gives it a fresh `gestureId`, and RNGH reacts to that by re-serializing EVERY callback
  // closure into its `animatedHandlers` shared value (GestureDetector/updateHandlers.js), on the JS
  // thread, in a microtask right after the commit. A device CPU profile put that at ~67ms of
  // `createSerializable` — and since this gesture is also the context value the rails read, its new
  // identity dragged another ~99ms of `propagateParentContextChanges` through the details subtree
  // behind it. All of it landing on the frame `detailsActive` flips, which is the frame the settle
  // animation starts on. That is the choppy settle: not the spring, the render under it.
  //
  // It doesn't need the gate anyway. This pan lives inside the details card, and that card drops
  // `pointerEvents` while the reader owns the screen — so it is already receiving no touches, by a
  // native mechanism rather than a config flag. The worklets re-check `detailsActiveSV` on top of
  // that. `traceOn` stays a dep because it changes the gesture's SHAPE (see backSwipePan) and only
  // ever flips from a Settings screen, where a re-serialization costs nothing.
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
      .enabled(detailsActive && IS_IOS)
      .manualActivation(true)
      .onTouchesUp(() => {
        if (!detailsActiveSV.value || !pullEngagedSV.value || closingSV.value) return;
        if (detailsScrollOffset.value <= -PULL_COMMIT_PX) {
          pullEngagedSV.set(false);
          detailsActiveSV.set(false);
          if (!splitDetails) progress.set(withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }));
          runOnJS(commitReveal)(0);
        }
      });
  }, [detailsActive, splitDetails, detailsActiveSV, pullEngagedSV, closingSV, detailsScrollOffset, progress, commitReveal]);
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
  // The measured hero cover (`cover`) is the right one only while the DETAILS are up AND still
  // showing it. Out of the expanded READER it is wrong twice over: the details are slid away, so
  // that rect corresponds to nothing visible, and it is a fixed small box, so the copy sat at one
  // static size over a full-screen page instead of shrinking with it. That case takes `page`.
  //
  // Scrolled PAST the cover it is wrong for the first of those reasons alone — and only the
  // POSITION is wrong. The bound follows the scroll (`zoomBoundShift`), so a collapse begun from
  // halfway down the chapter list aimed at a box hundreds of points above the top edge and dragged
  // the whole page up to meet it: the page scrolling itself away under the finger, which is not a
  // zoom of anything. The cover's SIZE is still exactly right, though — it is what the collapse's
  // scale is derived from, and it is the size the picture ought to arrive at. So that case takes
  // `cover-offscreen`, which keeps the size and centres it: the page swipes away and a cover-sized
  // picture shrinks into the card, the same shrink `cover` gives, just not out of a shared element.
  // Aiming at `page` there instead (which is what this did first) kept the shrink but ballooned the
  // copy to full screen width, so the thing that faded in was far bigger than any cover ever is.
  //
  // `detailsActive` is COMMITTED state, so it only flips when a reveal or collapse finishes — never
  // mid-flight, which is what would make swapping the destination visible. The two cover-derived
  // geometries exist together or not at all; `zoomBoundOnScreen` picks between them per collapse.
  const zoomGeomCover = useMemo(
    () => (hero && detailsActive && destBound ? computeZoomGeom(hero, { kind: 'cover', bound: destBound }, width, height) : null),
    [hero, detailsActive, destBound, width, height],
  );
  const zoomGeomOffCover = useMemo(
    () =>
      hero && detailsActive && destBound
        ? computeZoomGeom(hero, { kind: 'cover-offscreen', bound: destBound }, width, height)
        : null,
    [hero, detailsActive, destBound, width, height],
  );
  const zoomGeomPage = useMemo(
    () => (hero ? computeZoomGeom(hero, { kind: 'page' }, width, height) : null),
    [hero, width, height],
  );
  /**
   * THE substituted hero, for a source that has gone: the card's own size at the screen's centre.
   *
   * Its size is kept and only its POSITION replaced, exactly as `cover-offscreen` keeps the cover's
   * size when it loses its position — the size is what the collapse's scale is derived from, so
   * keeping it keeps the same shrink, and the card's size is still the honest thing for a page that
   * came out of that card to shrink back to. What is not honest is any position on this screen, so
   * it takes the only neutral one there is.
   *
   * It has to be read by EVERY consumer of `hero` on the converging path, not just by the geometry.
   * That was the bug in the first cut: `computeZoomGeom` took the centred rect while `zoomMaskStyle`
   * and `zoomPageStyle` went on calling `zoomMaskBox(hero, …)` with the real one, so the window
   * converged on the card's old slot while the page inside it converged on the middle. Centre-ish
   * cards hid it — the two answers nearly coincide there — and a card down the left edge showed it
   * as a page clipped by a window somewhere else, with its left corners square because that window
   * had run into the screen edge.
   *
   * `zoomDetach` is the reason the centre is exactly right rather than merely neutral: its offset is
   * `span/2 − start − size/2`, which for a centred box is 0 at every `home`. So a no-source collapse
   * sits still under a drag instead of being pulled toward a card, with no special case anywhere.
   */
  const heroCentred = useMemo(
    () => (hero ? { ...hero, x: (width - hero.width) / 2, y: (height - hero.height) / 2 } : null),
    [hero, width, height],
  );
  const zoomGeomNoSource = useMemo(
    () => (heroCentred ? computeZoomGeom(heroCentred, { kind: 'no-source' }, width, height) : null),
    [heroCentred, width, height],
  );
  /** For the render rather than for a frame of the transition: whether to mount the flying copy at
   *  all, and the layout rect it starts at. Any geometry answers both, and the animated style
   *  overwrites that rect in the same commit. */
  const zoomGeom = zoomGeomCover ?? zoomGeomPage;

  /**
   * Whether the cover is still on screen — i.e. whether a collapse aims at `cover` or at
   * `cover-offscreen`. LATCHED, because every frame of ONE collapse has to answer it the same way.
   * Written only while the page is at rest (`zoom` at the top); from the first frame of a drag it
   * holds whatever it said when the finger went down. The `detailsActive` note above is the same
   * guard by other means, and a choice read live off the scroll would break it several times a
   * second.
   */
  const zoomBoundOnScreen = useSharedValue(true);
  /**
   * Whether the card this page came out of is still in its list. LATCHED exactly like
   * `zoomBoundOnScreen` and for the same reason — one collapse must answer it the same way on every
   * frame — but the latch is doing more work here, because the fact itself arrives asynchronously:
   * a surface reports a removal whenever its items change, which can be mid-collapse, and that is
   * precisely when a destination may not be swapped.
   *
   * So it is read while the page is at REST (`zoom` at the top), and the collapse only ever consults
   * what was already settled before it started. Subscribing at rest is what makes that possible, and
   * it is nearly free: `notifyZoomSurfaceChanged` no-ops when nobody is listening, and this is the
   * only listener a page keeps outside a collapse.
   *
   * `undefined` — a surface that cannot say, or has unmounted — deliberately leaves the latch alone
   * rather than reading as gone. See `zoomSourceHolds`.
   *
   * Two guards keep it off the latch mid-flight. The subscription is not held AT ALL while
   * `collapsing` (the same shape as the exit-origin subscription below, and the reason a reorder can
   * re-aim but never re-destine), and since `collapsing` only turns on once `zoom` has fallen past
   * COLLAPSE_STARTED, the frames between a drag beginning and that threshold are covered by reading
   * `zoom` directly.
   *
   * That read is done ON THE UI THREAD, which is the point of the hop below rather than an
   * indulgence: `zoom` is driven by springs in the UI runtime, so it is the only runtime whose read
   * of it is authoritative for the current frame. Membership is JS-side data and stays here; only
   * the guard and the write cross over.
   */
  const zoomSourceAlive = useSharedValue(true);
  useEffect(() => {
    if (collapsing || !zoomSource || !id) return;
    const check = () => {
      const holds = zoomSourceHolds(zoomSource.source, id);
      traceJS('zoom', 'holds', { holds: holds ?? false, known: holds !== undefined });
      // `undefined` is a surface that cannot say — never read as gone. See `zoomSourceHolds`.
      if (holds === undefined) return;
      runOnUI((h: boolean) => {
        'worklet';
        if (zoom.value >= COLLAPSE_ARMED) zoomSourceAlive.set(h);
      })(holds);
    };
    // Also on (re-)subscribe: a cancelled collapse re-arms the page, and this is where it re-reads.
    check();
    return onZoomSurfaceChange(zoomSource.source, check);
  }, [collapsing, id, zoom, zoomSource, zoomSourceAlive]);
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

  // THE MASK. Grows from the source rect to the whole screen, carrying the card's corner radius
  // out to 0. In the library this lives INSIDE the transformed content and undoes the content
  // transform to reach absolute coordinates; here it is the content's PARENT, which gets the same
  // result with none of the compensation math — at the cost of the page needing to undo the
  // mask's own offset (see zoomPageStyle).
  const zoomMaskStyle = useAnimatedStyle(() => {
    // Always explicit numbers, never a percentage fallback from the stylesheet — a mask that is
    // sometimes laid out and sometimes transformed is how the two halves get to disagree.
    // No source rect, or not yet armed: the whole screen, so nothing is clipped.
    // The rect this collapse actually converges on — the card's, or its stand-in once the card has
    // gone. Every reader of it below must pick the same one, or the window and its contents shrink
    // toward different places. See `heroCentred`.
    const h = (zoomSourceAlive.value ? hero : heroCentred) ?? hero;
    if (!h || !zoomArmed.value) {
      return { left: 0, top: 0, width, height, borderRadius: 0, borderCurve: 'continuous' as const };
    }
    // Clamped at the bottom: the close spring is underdamped (damping ratio ~0.85, the library's
    // own figure) and undershoots 0 by a percent or two, which on a raw lerp would mean a mask
    // narrower than the card — and briefly a NEGATIVE width. The top needs no clamp: the open
    // spring is heavily overdamped and never passes 1.
    const q = Math.max(0, zoom.value);
    const home = zoomHoming(homeAt.value, q);
    const box = zoomMaskBox(h, heroShiftX.value, heroShiftY.value, q, width, height);
    return {
      // The drag moves the MASK, not the page inside it. Both have to travel together or the page
      // slides out from under its own window — a rectangle of page hanging in the wrong place,
      // which is exactly what a dragged mask-less collapse looked like. Which is also why the
      // DETACH rides here and only here: everything in the window is placed relative to this
      // origin, so moving it carries the page, the cover and the flying copy along untouched.
      //
      // Both fade out with `home` rather than springing back on release, and that is what makes the
      // landing exact: at q = 0 the homing is 1, so neither contributes anything whatever the finger
      // was doing, and the window is the card's box. The drag's own value is simply left where the
      // release froze it — nothing has to animate it away, so nothing can still be animating it when
      // the page leaves.
      left: box.left + zoomDetach(box.left, box.width, home, width) + dragX.value * (1 - home),
      top: box.top + zoomDetach(box.top, box.height, home, height) + dragY.value * (1 - home),
      width: box.width,
      height: box.height,
      borderRadius:
        h.radius *
        interpolate(
          q,
          [zoomRadiusClosing.value ? ZOOM_RADIUS_ROUNDED_BY_CLOSE : ZOOM_RADIUS_ROUNDED_BY_OPEN, 1],
          [1, 0],
          Extrapolation.CLAMP,
        ),
      borderCurve: 'continuous' as const,
    };
  }, [hero, heroCentred, width, height]);

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
        : zoomReaderClose.value
          ? ZOOM_CONTENT_FADE_CLOSE_READER
          : geom?.kind === 'cover-offscreen'
            ? ZOOM_CONTENT_FADE_CLOSE_OFFCOVER
            : ZOOM_CONTENT_FADE_CLOSE;
    const range = zoomClosing.value ? closing : ZOOM_CONTENT_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  }, [zoomGeomNoSource, zoomGeomCover, zoomGeomOffCover, zoomGeomPage]);
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
    const closing = zoomReaderClose.value
      ? ZOOM_THUMB_FADE_CLOSE_READER
      : geom?.kind === 'cover-offscreen'
        ? ZOOM_THUMB_FADE_CLOSE_OFFCOVER
        : ZOOM_THUMB_FADE_CLOSE;
    const range = zoomClosing.value ? closing : ZOOM_THUMB_FADE_OPEN;
    // The copy has to READ as the thumbnail it came off, corner included — 10pt on a grid card, 6
    // on a History/Activity row (see ZoomOrigin). This
    // rect rides the page's transform, so divide that scale out to hold the on-screen radius
    // steady rather than letting it grow with the page. (The library gets this for free: it moves
    // the real source view, which simply keeps its own radius under the tracked scale.)
    const s = geom ? geom.s + (1 - geom.s) * q : 1;
    let rect = base;

    const ia = zoomThumbAspect.value;
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
    } else if (
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
  }, [zoomGeomCover, zoomGeomOffCover, zoomGeomPage, hero, morphFit, width, height]);
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
  // Only the SCROLL crossfade lives here — the details⇄reader mode handoff is TopBarSwitch's
  // (the bar slot stays statically stuck on top and dissolves between the two faces).
  const headerBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(detailsScrollOffset.value, [barOnOffset - 24, barOnOffset + 16], [0, 1], Extrapolation.CLAMP),
  }), [barOnOffset]);
  // The PERSISTENT back button (TopBarSwitch's `persistent` slot): the same chevron serves both
  // modes from the same spot — it never fades or moves through the details⇄reader handoff, only
  // its COLOR crossfades (theme text over the details, white over the page). In reader mode it
  // follows the auto-hiding chrome (via the shared-value mirror) and a dismissal's chrome curve.
  const chromeVisibleSV = useSharedValue(1);
  useEffect(() => {
    chromeVisibleSV.set(withTiming(chromeVisible ? 1 : 0, { duration: 200 }));
  }, [chromeVisible, chromeVisibleSV]);
  const backPersistStyle = useAnimatedStyle(() => {
    // Details side is always-on; reader side follows the chrome. max() keeps it solid through
    // the transition instead of dipping.
    const detailsSide = interpolate(progress.value, [0.4, 0.8], [0, 1], Extrapolation.CLAMP);
    return { opacity: Math.max(detailsSide, chromeVisibleSV.value) };
  });
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
    // The `min(off, 0)` term cancels the layer's share of an ACTIVE iOS pull: while the native
    // rubber-band is moving the content (and headerSheetBgStyle the seam) down 1:1 already, the
    // pull-driven progress must not ALSO move the layer — only the commit animation (progress
    // moving past the finger-tracked value while the bounce returns to 0) takes it off screen.
    // The split details have no pull-driven progress to cancel: there it held the page still
    // against its own bounce, a frame behind it, which shook the page under the system's
    // swipe-down dismissal. They rubber-band like any native page.
    const cancel = splitDetails ? 0 : Math.min(off, 0);
    return { transform: [{ translateY: (1 - progress.value) * travel + cancel }] };
  }, [height, bandH, splitDetails]);
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
  // How much of the screen this page currently covers. All three ways it can be less than fully
  // covering have to count, or the backdrop would sit dimmed while the page is visibly gone: the
  // `zoom` alone, now that BOTH dismiss gestures drive it — the back-swipe and the reader's
  // swipe-away. This used to carry a second term for the swipe-away, which flung the page along
  // its own vector without touching `zoom`; there is no such vector any more.
  // Depth 0 ONLY: a drilled layer sits over its parent series inside this same modal, and the tabs
  // behind the whole modal must not respond twice to what is, to them, one open page. Nor a pushed
  // card: nothing shows behind one, and UIKit has taken the screen beneath away regardless. Nor a
  // reader page over its details, which own the backdrop (see SplitHandoff).
  useAnimatedReaction(
    () => {
      return zoom.value;
    },
    (covered) => {
      if (depth === 0 && !inPane && !nativePush && !stripReader) seriesReaderDim.set(covered);
    },
    [depth, inPane, nativePush, stripReader],
  );
  // Belt and braces: nothing may strand the backdrop dimmed if this screen goes away without its
  // exit animation finishing (a deep link replacing the route, a dev reload). The hold's release
  // does that reset, and ALSO tells the watchdog nobody owns the dim any more — the reset above is
  // one JS-thread write against a value the reaction above writes every frame, and on its own it
  // has no way to notice when it loses that race (see lib/pushback-watchdog).
  useEffect(() => {
    if (depth > 0 || inPane || nativePush || stripReader) return;
    return holdSeriesBackdrop();
  }, [depth, inPane, nativePush, stripReader]);

  // ── Details-card intents, routed back into the in-place reader ───────────
  const paneRef = useRef<ReaderPaneHandle>(null);
  // The split details' strip follows what the reader page records: the pane takes its spot once,
  // at mount, and only a new chapter remounts it.
  const previewStart = splitDetails ? target?.start : undefined;
  useEffect(() => {
    if (typeof previewStart === 'number') paneRef.current?.goTo(previewStart, false);
  }, [previewStart]);
  // A reader page shows where it stands as its way back STARTS, not in its unmount flush after the
  // pop: the details beneath move their strip while the zoom is still carrying the page down to it,
  // instead of after it has landed on the old one.
  const navigation = useNavigation<ClosingNavigation>();
  useEffect(() => {
    const show = () => {
      if (split === 'reader') paneRef.current?.showProgress();
    };
    // A cancelled swipe brings the page back through the same events, closing: false.
    const offs = [
      navigation.addListener('transitionStart', (e) => {
        closingSV.set(e.data.closing);
        if (e.data.closing) show();
      }),
      navigation.addListener('transitionEnd', (e) => {
        if (!e.data.closing) closingSV.set(false);
      }),
      navigation.addListener('gestureCancel', () => closingSV.set(false)),
      navigation.addListener('beforeRemove', show),
    ];
    return () => offs.forEach((off) => off());
  }, [navigation, split, closingSV]);
  // (`visiblePage` / `visibleSequenceEntry` are declared at the top of the component — the detail
  // identity derives from them.)
  // Verify this chapter's collected pages against the page list we already fetched — repairs the
  // ones the source shifted and seeds the indices the heart reads. See use-chapter-reconcile.
  // Reconcile is chapter machinery — in sequence mode `pages` is the cross-series URI list, which
  // must never be offered as a chapter's page list. (Each entry's chapter was reconciled when it
  // was read normally; the sequence only displays.)
  useChapterReconcile(bridgeId, id, sequence ? undefined : (visiblePage?.chapterId ?? target?.chapterId), pages);
  // Sequence mode: a tap in the revealed details card is a NEW read of the visible entry's
  // series, not a jump within the album — the album's pager runs the sequence and nothing else.
  // It opens as a drilled LAYER (the same slide a related-series card gets), reader-first at the
  // tapped spot, with the album intact underneath; the route push is the fallback for the odd
  // host without a layer stack.
  const openFromSequenceDetails = useCallback(
    (params: Record<string, string>) => {
      if (drillSeries) drillSeries(params);
      else router.push({ pathname: '/series', params });
    },
    [drillSeries, router],
  );
  const openChapterFromDetails = useCallback(
    (v: Chapter) => {
      if (sequence) {
        openFromSequenceDetails({
          id: detailSeriesId ?? '',
          bridgeId: detailBridgeId ?? '',
          title: detailTitle ?? '',
          reader: '1',
          chapterId: v.id,
          ...(v.name ? { chapterName: v.name } : {}),
          start: '0',
          picked: '1',
        });
        return;
      }
      if (v.id !== targetChapterId) {
        const next: ReadTarget = {
          chapterId: v.id,
          chapterName: v.name,
          start: resume?.chapterId === v.id ? (resume.lastPage ?? 0) : 0,
          picked: true,
        };
        // The split details hand the chapter to the reader page and keep the strip where the
        // history says, until reading there moves it.
        if (!splitDetails) {
          setJumpNonce((n) => n + 1); // explicit jump — remount seeded at the target, even in-window
          setOverride(next);
        }
        setRevealed(0, next);
        return;
      }
      setRevealed(0);
    },
    [sequence, openFromSequenceDetails, detailSeriesId, detailBridgeId, detailTitle, targetChapterId, resume, splitDetails, setRevealed],
  );
  const openPageFromDetails = useCallback(
    (pageIndex: number) => {
      if (sequence) {
        // Page grids only exist on DIRECT series' details, so this is a direct open by definition.
        openFromSequenceDetails({
          id: detailSeriesId ?? '',
          bridgeId: detailBridgeId ?? '',
          title: detailTitle ?? '',
          reader: '1',
          direct: '1',
          start: String(pageIndex),
          picked: '1',
        });
        return;
      }
      // Both paths, because the pane is not guaranteed to be mounted: a window still forming (see
      // the run's hold) has no pager to drive, so the target carries the landing page and the pane
      // seeds from it instead. A pane that IS mounted ignores the seed — `start` is read once, at
      // mount — and the direct call is what moves it. The split details move neither: the reader
      // is the page they push.
      const from = override ?? derivedTarget;
      const next: ReadTarget = from ? { ...from, start: pageIndex, picked: true } : { start: pageIndex, picked: true };
      if (!splitDetails) {
        paneRef.current?.goTo(pageIndex, false);
        setOverride(next);
      }
      setRevealed(0, next);
    },
    [sequence, openFromSequenceDetails, detailSeriesId, detailBridgeId, detailTitle, splitDetails, setRevealed, override, derivedTarget],
  );
  // The Read button/cover: the pane already sits at the same resume point Read would compute.
  const startReadingFromDetails = useCallback(() => setRevealed(0), [setRevealed]);

  const scheme = useActiveColorScheme();
  // Sequence mode: the visible ENTRY names the series (the fetched detail only exists after a
  // reveal, and it describes the same series by construction — `detailKey`).
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

  // Same "<Bridge> / <Title>" the /series TopBar shows (shared truncation rule). Detail-side
  // identity, so in sequence mode the details top bar names the VISIBLE entry's series.
  const topBarSeries = series?.title ?? detailTitle;
  const topBarBridgeName = series?.bridge ?? detailBridge;
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

  // ONE statically-stuck top-bar slot serving BOTH modes — TopBarSwitch keeps the details bar
  // (shared TopBar, back-less: transparent over the strip, opaque once scrolled) and the
  // reader's transparent ReaderToolbar (also back-less) mounted together and CROSSFADES between
  // them as the mode flips, while the PERSISTENT back chevron sits above both, in one spot,
  // never fading — only its color dissolves with the mode (the X/Reddit morphing-header
  // treatment). Above the band overlay so its taps win. Rendered in one of two spots below:
  // inside the edge-swipe slide for the modal root, outside it (fading, statically stuck) for a
  // drilled layer.
  // iOS: the system bar is the top chrome of BOTH modes, through the route's options — one bar,
  // so its back button and buttons morph from one face to the other instead of a custom bar
  // fading in under it. Details: transparent over the cover, the glass material and the title
  // arriving where the custom bar went solid, the navigation theme's tint. Reader: transparent
  // over the page, a white title, the save and settings buttons as glass bar items
  // (ReaderNativeToolbar), and the bar follows the chrome's auto-hide through `headerShown` —
  // UIKit slides it away and back. A mounted Stack.Toolbar sets `headerShown: true` on top of
  // these options (expo-router merges its items in over the page's own), so neither toolbar
  // renders its items while the bar is down. Every option is set in both modes:
  // Stack.Screen merges into the route's options, so a key left out would carry the other mode's
  // value over. The custom chevron below is not rendered here: its fade is an animated opacity,
  // which no static style can hold at zero. Only the top instance sets the options
  // (they are the route's, shared by every layer), and the elements mount only while it is top,
  // so a layer that becomes top again re-applies them — Stack.Screen's effect runs on mount, and
  // the toolbar unregisters its item on unmount. Inside a tab the route is the tab stack's own
  // pushed card (useNativePush), whose back
  // button is the system's — the one the tab's leading item morphs into — and whose left-edge pop
  // is on only while the details are up: in the reader it would pop the whole page out from under
  // a page turn. At the root the route these options reach is the `index` of the nested stack
  // (app/series/_layout), never the contained transparent modal around it: react-native-screens
  // remounts a modal's content when its `headerShown` flips, and this page flips it on every
  // details ⇄ reader switch and for the search layer below; a nested root has no back of its own,
  // hence the chevron.
  // In sequence mode the reader's chrome describes the VISIBLE entry — which series the page in
  // front of you belongs to is the one thing this bar must answer there.
  const readerBarTitle = sequence ? (visibleSequenceEntry?.seriesTitle ?? seriesTitle) : seriesTitle;
  const readerBarSubtitle = sequence ? (visibleSequenceEntry?.chapterName ?? '') : (target?.chapterName ?? '');
  // iOS gives it one line, a plain title UIKit lays out and truncates between the back button and
  // the bar buttons: a title view is sized by React at the bar's full width, and UIKit can only
  // centre that over them. Outside a sequence the line is the chapter, which nothing else in the
  // reader names; the series is the page the back button returns to.
  const nativeReaderTitle = sequence ? readerBarTitle : readerBarSubtitle || readerBarTitle;
  const barUp = detailsActive || chromeVisible;
  const nativeBar =
    NATIVE_HEADER && isTop ? (
      <>
        <Stack.Screen
          options={{
            headerShown: barUp,
            headerTransparent: true,
            headerShadowVisible: false,
            headerBackVisible: nativePush,
            // Not a pushed card, nothing for UIKit to pop: the edge is the page's own back-swipe.
            gestureEnabled: nativePush && (detailsActive || (swipeAway && !readerZoomed && !scrubbing)),
            ...(detailsActive
              ? {
                  title: barSolid ? headerBarTitle : '',
                  headerTitle: barSolid ? headerBarTitle : '',
                  headerBlurEffect: barSolid ? 'systemChromeMaterial' : undefined,
                  headerTintColor: navTheme.colors.primary,
                }
              : {
                  title: nativeReaderTitle,
                  headerTitle: nativeReaderTitle,
                  headerBlurEffect: undefined,
                  headerTintColor: '#fff',
                }),
          }}
        />
        {!nativePush && barUp ? (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              icon="chevron.left"
              accessibilityLabel="Go back"
              onPress={backStepsHome ? revealDetails : closeLayer}
            />
          </Stack.Toolbar>
        ) : null}
        {!detailsActive ? (
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
        ) : null}
      </>
    ) : null;
  const topChrome = (
    <TopBarSwitch
          mode={detailsActive ? 'details' : 'reader'}
          persistent={
            NATIVE_HEADER ? null : (
              <Animated.View
                nativeID={`${chromeId}-back`}
                pointerEvents={detailsActive || chromeVisible ? 'box-none' : 'none'}
                style={[styles.headerBackWrap, { top: insets.top, height: topBarHeight }, backPersistStyle]}>
                <Pressable
                  testID="series-page.header-back"
                  // A drilled layer's chevron slides it back out to the parent series; the modal
                  // root's pops the route.
                  onPress={backStepsHome ? revealDetails : closeLayer}
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
            reader: NATIVE_HEADER ? (
              // The bar is the system's (nativeBar); only its shade is still drawn here, so the
              // crossfade into the details keeps carrying it.
              <ReaderBarShade visible={chromeVisible} />
            ) : (
              // The reader's own fully transparent toolbar (with no back of its own — the
              // persistent chevron above serves both modes); its auto-hide rides `visible`.
              <View nativeID={`${chromeId}-bar`} pointerEvents="box-none">
                <CollectPageShortcut
                  enabled={IS_WEB && isTop && !detailsActive}
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
    // fade the layers out over the screen beneath. The details layer supplies the opaque fill.
    <View style={styles.container}>
      {/* While the reader is up the system bars stay horizontal, the opt-out iOS 27 keeps for
          full-screen media: in the vertical bar beside the page they would take its width, and the
          status bar there cannot hide with the chrome. */}
      <StatusBar
        style={settings.mode === 'paged' || detailsActive ? (scheme === 'dark' ? 'light' : 'dark') : 'light'}
        hidden={settings.mode !== 'paged' && !chromeVisible && !detailsActive}
        verticalBarBehaviorIOS={detailsActive ? 'automatic' : 'disabled'}
      />

      <SplitClip travel={stripFrom ? height - stripFrom.stripBottom : null} progress={progress}>
      {/* THE READER'S BACKDROP, while the reader is what's on screen: full screen, never moving,
          fading IN PLACE as the collapse carries the page over it. Outside the mask on purpose —
          inside it, it travelled and scaled along with everything else, which is a swipe-away
          dragging its own background off with it. Details mode keeps its copy inside the page
          (below), where the job is different: it is the dark backing that the transparent strip
          window shows the reader through, so it has to move with the page it belongs to.
          `detailsActive` is committed state, so this never swaps parents mid-collapse — and at
          rest the two positions render identically (the page transform is identity there). */}
      {!detailsActive && (
        <Animated.View
          pointerEvents="none"
          style={[styles.readerSurface, { width, height }, zoomBackdropFadeStyle]}
        />
      )}

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
          background starts at the band, so the strip is the top of the page; the whole layer
          slides off as the reader expands — DOWN in paged mode, LEFT in webtoon (see
          horizontalReveal), uncovering the reader that is already full-screen beneath it. When
          the reader is expanded, the (translated-off) layer must not swallow touches meant for
          the reader beneath it. */}
      {split !== 'reader' && (
      <GestureDetector gesture={detailsGestures}>
        <Animated.View
          testID="series-page.details-card"
          pointerEvents={detailsActive ? 'auto' : 'none'}
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
              // Keyed by the DETAIL series: constant in chapter mode; in sequence mode a series
              // cross remounts just this card (fresh skeleton state for the new series) while the
              // reader around it never blinks — the card is off-screen at progress 0 anyway.
              key={detailKey}
              bridgeId={detailBridgeId}
              id={detailSeriesId}
              title={detailTitle}
              bridge={detailBridge}
              cover={detailCover}
              defer={!seriesWanted}
              isDirect={detailIsDirect}
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
              saveKeyEnabled={IS_WEB && !!isTop && detailsActive}
            />
            </BackSwipeGestureContext.Provider>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      )}

      {/* The reader's dark surface — static: full screen, never moving,
          fading in place while a dismissal carries the page over it. It lives OUTSIDE the
          strip-centering frame below: inside it, the surface rode the frame's translate up with
          the reader and uncovered the screen bottom at low progress — the underlying screen
          showed through the seam gradient as a dark bar whenever a drag held the transition
          near the reader side. */}
      {detailsActive && <Animated.View pointerEvents="none" style={[styles.readerSurface, { width, height }]} />}

      {/* The reader, beneath the details: full screen, in three layers — a static fading surface
          above, the traveling page subtree, and the chrome that fades with it. The collapse/
          dismiss pan wraps the whole cell (the scrubber and a zoomed page disable it). */}
      <GestureDetector gesture={collapsePan}>
        <Animated.View
          testID="series-page.reader-card"
          // Under the details its chrome still shows through the seam; the keys stay on the details.
          {...(detailsActive ? focusSkip : null)}
          style={[styles.readerFrame, { top: 0, width, height }, readerCardStyle]}>
          <Animated.View style={[styles.readerClip, readerClipStyle]}>
          {error ? (
            <>
              {pagesGone && !missingBridge ? (
                !detailsActive && (
                  <View testID="series-page.reader.removed" style={[styles.centerFill, styles.readerNotice]}>
                    <ThemedText type="small" style={styles.readerNoticeText}>
                      {`${detailBridge || 'The source'} no longer has this series, and this chapter isn't downloaded, so it can't be opened.`}
                    </ThemedText>
                  </View>
                )
              ) : !missingBridge ? (
                <View style={styles.centerFill}>
                  <RetryBlock message={error} onRetry={refetch} />
                </View>
              ) : (
                // The details page already says it, and shows through this card's top while it's up.
                !detailsActive && (
                  <View style={styles.centerFill}>
                    <BridgeMissingNotice
                      bridge={missingBridge}
                      message={`${missingBridge.name} isn't installed and this chapter isn't downloaded, so it can't be opened.`}
                      testID="series-page.reader.bridgeMissing"
                    />
                  </View>
                )
              )}
              {dimOverlays}
            </>
          ) : !readerReady ? (
            <>
              {/* No "Loading…" while the details are up — the strip is a quiet background there
                  (the per-page % indicator, once pages exist, is ReaderPage's and stays). */}
              {!detailsActive && (
                <View style={styles.centerFill}>
                  <ThemedText style={styles.loadingText}>Loading…</ThemedText>
                </View>
              )}
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
              recordProgress={!sequence && !splitDetails}
              hasPrevChapter={!sequence && !!prevChapter}
              hasNextChapter={!sequence && !!nextChapter}
              nextChapterName={nextChapter?.name}
              onCrossChapter={goAdjacentChapter}
              onSkipChapter={(delta) => {
                showChrome();
                goAdjacentChapter(delta, 'first');
              }}
              chromeVisible={chromeVisible && !detailsActive}
              onToggleChrome={toggleChrome}
              onShowChrome={showChrome}
              onHoldChrome={holdChrome}
              onZoomChange={setReaderZoomed}
              onScrubActive={onScrubActive}
              overlay={dimOverlays}
              // Details mode: the reader is a decorative background strip — load ONLY the page
              // on screen (no warm-ahead, render window of 1). Expanding flips this (a beat
              // after the transition settles — see detailsSettled) and the normal prefetch
              // pipeline resumes.
              standby={detailsSettled || !entranceSettled}
              entering={!entranceSettled}
              inLibrary={inLibrary}
              keyboard={isTop && !detailsActive}
              glass={pushSettled}
            />
          )}
            {/* The Details pill — the guaranteed collapse path in both modes (webtoon's expanded
                reader owns vertical drags, and no longer reveals by dragging at all). Not on a
                desktop: its details are the pane's, or the chevron's (`backStepsHome`), and the
                full-screen card the pill reveals is the phone's layout. Nor on iOS's reader page
                pushed from the details, whose back button goes to them. */}
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <DetailsHint
                visible={
                  chromeVisible &&
                  !detailsActive &&
                  !isDesktop &&
                  !desktopShell() &&
                  !(split === 'reader' && params.from === 'details')
                }
                onPress={() => setRevealed(1)}
              />
            </View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* The split's zoom, both ends at the strip's resting rect: the details' strip is the source,
          and the reader page lines up the same stretch of its page with it, so the strip is what
          grows into the reader and what the reader shrinks back into. */}
      {stripZoomHref ? (
        <View pointerEvents="none" style={[styles.stripZoom, { width }]}>
          <ZoomSource href={stripZoomHref} onId={setStripZoomId} style={{ width, height: headerTopInset }} />
        </View>
      ) : null}
      {split === 'reader' && nativePush ? (
        <View pointerEvents="none" style={[styles.stripZoom, { top: (height - bandH) / 2, width }]}>
          <LinkAppleZoomTarget>
            <View collapsable={false} style={{ width, height: headerTopInset }} />
          </LinkAppleZoomTarget>
        </View>
      ) : null}

      {/* The reader strip's touch surface — tap to read full screen, or drag the details page
          away under the finger (DOWN in paged, LEFT in webtoon — see horizontalReveal). It rides
          the same occlusion as the strip (headerBandStyle), so it scrolls off with the page and
          never blocks content. */}
      {detailsActive && (
        <GestureDetector gesture={bandPan}>
          {/* Ends where the content starts (the title reaches up into the seam), so it never
              covers anything tappable. */}
          <Animated.View style={[styles.dockBand, { height: headerTopInset }, headerBandStyle]}>
            <Pressable
              testID="series-page.header-band"
              {...focusSkip}
              onPress={() => setRevealed(0)}
              accessibilityRole="button"
              accessibilityLabel="Read full screen"
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </GestureDetector>
      )}

      {/* ONE statically-stuck top-bar slot serving BOTH modes (see `topChrome` above) — every
          instance's bar rides its own slide (drill entrance, edge swipe, dismissal alike). */}
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
      </SplitClip>
    </View>
  );
}

/**
 * The route component: the base series instance for the route's params, plus one LAYER per
 * drilled series (see SeriesReaderInstance's header for why layers, not navigation). The drill
 * itself arrives through the nested layout's context ref — series cards anywhere inside the
 * series page stack call it (popping the nested stack back to this screen first when they're
 * on the search/downloads sub-pages, see useDrillRelatedSeries). Only the topmost instance takes
 * touches; the ones beneath stay live purely as the see-through under its gestures.
 */
type DrillEntry = { key: number } & ({ kind: 'series'; params: SeriesReaderParams } | { kind: 'search' });

// memo: pushing/popping a layer re-renders the wrapper below — without this, every mounted
// instance (each a whole series page) re-renders along with it for nothing.
const MemoSeriesReaderInstance = memo(SeriesReaderInstance);

/** The root `series/index`: the details page of the split (see SeriesSplit). */
export default function SeriesReaderScreen() {
  return <SeriesRoute split="details" />;
}

/** A tab's `series/index`: on iOS, the details page of the split (see SeriesSplit). */
export function SeriesTabScreen() {
  return <SeriesRoute split="details" />;
}

/** `series/read`, the root's and a tab's: the reader page of the split. */
export function SeriesReadScreen() {
  return <SeriesRoute split="reader" />;
}

function SeriesRoute({ split: routeSplit }: { split: SeriesSplit }) {
  const params = useLocalSearchParams<SeriesReaderParams & ReaderSequenceParams>();
  const router = useRouter();
  const { width } = useViewport();
  const inPane = useSeriesPaneWidth() !== null;
  const nativePush = useNativePush();
  // A details page under its reader is still mounted (see app/series/_layout) and must stop
  // answering keys and back. iOS covers it with a real card, and reads `isTop` for its bar.
  const routeFocused = useIsFocused() || IS_IOS;
  const [drills, setDrills] = useState<DrillEntry[]>([]);
  // The pane stays mounted under a full-screen series page opened from it (see lib/series-pane).
  useEffect(() => (inPane ? undefined : coverSeriesPane()), [inPane]);
  const covered = useSeriesPaneCovered() && inPane;

  // ── Sequence mode (`seq=1`): the reader pages over a COLLECTION's saved pages ──
  // The screen's share is deliberately small: resolve the album (use-reader-sequence) and mount
  // ONE instance for its whole life — never re-keyed, so the pager inside it never remounts and a
  // series cross stays what it physically is: a page turn. Which series the chrome describes, and
  // whose details its Details button opens, is the INSTANCE's business — it re-points them to the
  // visible entry, the way a stitched crossing relabels (see ReaderSequenceRun).
  const seq = useReaderSequence(params);
  // A reading link that reached the details route (a deep link) still gets the reader page.
  const split: SeriesSplit = seq || params.reader === '1' ? 'reader' : routeSplit;
  const seqEntries = seq?.entries;
  const seqUris = seq?.uris;
  const seqStartId = params.seqStart;
  // The tapped tile's entry (a cold deep link whose seqStart no longer exists falls back to the
  // first entry rather than failing). Stable: the album roster is latched for the open's life.
  const seqStartIndex = useMemo(() => {
    if (!seqEntries?.length) return 0;
    const at = seqStartId ? seqEntries.findIndex((e) => e.id === seqStartId) : -1;
    return at >= 0 ? at : 0;
  }, [seqEntries, seqStartId]);
  const seqEntry = seqEntries?.[seqStartIndex];
  const seqRun = useMemo<ReaderSequenceRun | undefined>(
    () =>
      seqUris && seqEntries?.length
        ? { uris: seqUris, entries: seqEntries, index: seqStartIndex }
        : undefined,
    [seqUris, seqEntries, seqStartIndex],
  );
  // The instance's route-level identity: the entry the album OPENED on — an ordinary reader-first
  // open, the same params a History row pushes, minus a chapter seed (the sequence, not a
  // chapter, is the page list). It never changes mid-album; the visible entry drives the rest.
  const seqParams = useMemo<SeriesReaderParams>(
    () =>
      seqEntry
        ? {
            id: seqEntry.seriesId,
            bridgeId: seqEntry.bridgeId,
            title: seqEntry.seriesTitle,
            reader: '1',
            ...(seqEntry.chapterId === DIRECT_CHAPTER_ID && { direct: '1' }),
          }
        : {},
    [seqEntry],
  );
  // A sequence that resolves to nothing (every page un-saved elsewhere, a dead deep link) has
  // nothing to show — leave rather than strand a spinner.
  const seqEmpty = !!seq && seq.resolved && seq.entries.length === 0;
  useEffect(() => {
    if (seqEmpty) router.back();
  }, [seqEmpty, router]);
  const nextKey = useRef(1);
  // The stack's shape, in the trace. A layer bug is by definition about which of several mounted
  // pages is reacting, and a recording had no way to say what was even mounted.
  const drill = useCallback((p: Record<string, string>) => {
    setDrills((d) => {
      traceJS('layer', 'push.series', { depth: d.length + 1 });
      return [...d, { key: nextKey.current++, kind: 'series', params: p as SeriesReaderParams }];
    });
  }, []);
  const openSearch = useCallback(() => {
    setDrills((d) => {
      traceJS('layer', 'push.search', { depth: d.length + 1 });
      return [...d, { key: nextKey.current++, kind: 'search' }];
    });
  }, []);
  const popLayer = useCallback(() => {
    setDrills((d) => {
      traceJS('layer', 'pop', { from: d.length, left: d.length - 1 });
      return d.slice(0, -1);
    });
  }, []);
  // The handlers are a stack whose top answers, and another tab's pane stays mounted while hidden —
  // so only the one you can see holds them, re-taking the top when its tab comes back. Two things
  // say "hidden": a pane in a tab that isn't the active one, and — since every tab's stack keeps
  // its own series page — a copy in a tab that isn't the focused one. A page left open in another
  // tab is blurred, not gone, and while it held the top, a tag tapped on the page you could see
  // opened the search layer on the one you couldn't.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  // A pushed card holds neither: a related series pushes another card there, and the tag search
  // pushes its route (see useNativePush) — a handler left registered would turn both into layers.
  const live = usePaneTabLive() && focused && !nativePush;
  useEffect(() => (live ? registerDrillSeries(drill) : undefined), [drill, live]);
  useEffect(() => (live ? registerOpenSearchLayer(openSearch) : undefined), [openSearch, live]);
  // The IN-TREE push parallax, now serving the SEARCH layer alone: how much it covers what's under
  // it (0 off-screen, 1 fully arrived). The layer publishes it; everything beneath drifts left
  // against it, the way UIKit moves an outgoing screen. Drilled SERIES layers no longer write it —
  // they zoom out of the card that opened them rather than sliding in, and a parent shoved sideways
  // under something expanding in place read as two contradictory motions (the same reason the tabs
  // behind the whole modal lost their parallax — see lib/series-backdrop.ts). Search still
  // slides in from the edge, so it still gets the push treatment.
  //
  // One value serves any depth even though it only ever describes the top layer: the sole item a
  // reader can see beneath the top one is the item directly beneath it. Deeper items are fully
  // covered, so their reading it is invisible either way.
  const layerCover = useSharedValue(0);
  const layerParallax = useAnimatedStyle(
    () => ({ transform: [{ translateX: -IOS_PARALLAX_FRACTION * width * layerCover.value }] }),
    [width],
  );
  const top = drills.length - 1;
  // …and the push is only ON while the thing on top is the one that pushes. A drilled series zooms
  // out of its card, so everything under it holds still; when it closes, whatever it was covering
  // is exactly where it was left. Without this gate the layers beneath would SNAP sideways the
  // moment a series was drilled from search results, riding a value the search layer had parked
  // at 1 and the series would never move again.
  // Nor in the desktop pane, where the search arrives without a slide to drift against (see
  // SearchLayer) — and the pane doesn't clip, so the page would be shoved out over the rail.
  const pushed = !inPane && top >= 0 && drills[top].kind === 'search' ? layerParallax : null;
  const topEntry = top >= 0 ? drills[top] : null;
  const topParams = !topEntry ? params : topEntry.kind === 'series' ? topEntry.params : null;
  const topKey = topParams ? `${topParams.bridgeId ?? ''}:${topParams.id ?? ''}` : null;
  const paneTab = usePaneTab();
  useEffect(() => (inPane ? setSeriesPaneTop(paneTab, topKey) : undefined), [inPane, paneTab, topKey]);
  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.container, pushed]}
        pointerEvents={drills.length === 0 ? 'auto' : 'none'}>
        {seq ? (
          seqRun && seqEntry ? (
            // ONE instance, never re-keyed: the pager inside lives for the whole album, so a
            // series cross is a plain page turn — the instance re-points chrome and details to
            // the visible entry itself.
            <MemoSeriesReaderInstance
              params={seqParams}
              depth={0}
              onPopLayer={popLayer}
              isTop={drills.length === 0 && !covered && routeFocused}
              nativePush={nativePush}
              split="reader"
              sequence={seqRun}
            />
          ) : (
            // Cold deep link: the collection query hasn't answered yet (a warm cache resolves
            // synchronously and never shows this).
            <View style={styles.seqLoading}>
              <ActivityIndicator color="#fff" />
            </View>
          )
        ) : (
          <MemoSeriesReaderInstance
            params={params}
            depth={0}
            onPopLayer={popLayer}
            isTop={drills.length === 0 && !covered && routeFocused}
            nativePush={nativePush}
            split={split}
          />
        )}
      </Animated.View>
      {drills.map((d, i) => (
        <Animated.View
          key={d.key}
          // The top layer is the one moving; it must not also ride the parallax it publishes.
          style={i === top ? StyleSheet.absoluteFill : [StyleSheet.absoluteFill, pushed]}
          pointerEvents={i === top ? 'auto' : 'none'}>
          {d.kind === 'series' ? (
            <MemoSeriesReaderInstance
              params={d.params}
              depth={i + 1}
              onPopLayer={popLayer}
              isTop={i === top && !covered && routeFocused}
              nativePush={false}
              split="details"
            />
          ) : (
            <SearchLayer onPopLayer={popLayer} coverSV={layerCover} isTop={i === top && !covered && routeFocused} />
          )}
        </Animated.View>
      ))}
    </View>
  );
}

/** The stack events a series page follows its own way out by — see `closingSV` and `showProgress`. */
type ClosingNavigation = {
  addListener(type: 'transitionStart' | 'transitionEnd', cb: (e: { data: { closing: boolean } }) => void): () => void;
  addListener(type: 'gestureCancel' | 'beforeRemove', cb: () => void): () => void;
};

const styles = StyleSheet.create({
  // Sequence resolving on a cold deep link — the reader's black, so the instance that replaces it
  // doesn't flash a background change.
  seqLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
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
