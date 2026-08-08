import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, type ComposedGesture } from 'react-native-gesture-handler';
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
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { LinearGradient } from 'expo-linear-gradient';

import { ChevronUpIcon } from '@/components/icons/ui-icons';
import { ChapterNavigator } from '@/components/reader/chapter-navigator';
import { PagedReader, type PagedReaderHandle, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { SettingsControl } from '@/components/reader/settings-panel';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { TopBarSwitch } from '@/components/top-bar-switch';
import { Spacing } from '@/constants/theme';
import { resolveAssetSourceCached } from '@/data/api';
import {
  chapterPagesQuery,
  directPagesQuery,
  historyQuery,
  inLibraryQuery,
  queryKeys,
  seriesDetailQuery,
  seriesListQuery,
} from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type Chapter } from '@/data/types';
import { useReaderSettings } from '@/hooks/use-reader-settings';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { LARGE_SCREEN_BREAKPOINT, useTopBarHeight } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';

import { backSwipePan, backSwipeStayedHorizontal, BACK_ACTIVATE_DOMINANCE, BackSwipeGestureContext } from '@/lib/back-swipe';
import { trace, traceGate, traceJS, traceThrottled, useGestureTraceEnabled } from '@/lib/gesture-trace';
import { releaseCommitted, releaseCommittedEitherWay } from '@/lib/gesture-release';
import { IOS_CARD_SHADOW, IOS_CARD_SPRING, IOS_PARALLAX_FRACTION } from '@/lib/ios-card-pop';
import { registerDrillSeries, registerOpenSearchLayer } from '@/lib/series-nav';
import { seriesReaderDim } from '@/lib/series-backdrop';
import { holdZoomingSeries, takeZoomOrigin, type ZoomRect } from '@/lib/series-zoom';
import SearchScreen from '../search';
import { SeriesBody, truncateTopBarTitle } from '@/components/series/series-body';

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
// CI-speed override: Maestro steps can outlast the auto-hide, and hidden chrome drops out of the
// accessibility tree.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';
const WARM_BEHIND = 2;
const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
// The reader surface's tone (the reference's `#reader-view`: #0f0f0f, not pure black).
const READER_BACKDROP = '#0f0f0f';
// How far a release must be PROJECTED (see lib/gesture-release — every commit decision on this
// screen and in the search layer now asks the same question) before it counts as committed.
//
// Two values, because there are two kinds of decision here and they deserve different bars:
//
//   REVEAL — which of the two sides of this ONE screen you end up on. Both outcomes are cheap and
//     instantly reversible, so the bar stays low: a quarter of the travel. Combined with a real
//     momentum term that means a release still moving toward the other side takes you there, which
//     is what a two-state toggle should do and what the old flick cutoff kept refusing to do — a
//     quick flick under 900px/s used to be ignored entirely.
//
//   DISMISS — throwing the screen away. Half the travel, matching a pushed card, and NOT a matter
//     of taste: once velocity counts for its real worth instead of being a cliff, a quarter is a
//     hair-trigger that a barely-moving release would clear. A reveal can afford to be wrong; a
//     dismissal cannot. With lib/gesture-release's 0.3s horizon this makes the dismissal rule
//     `translation + velocity * 0.3 > width / 2` — which is, term for term, what react-native-screens
//     runs for a native iOS stack pop (RNSScreenStack.mm, handleSwipe).
/** How far the expanded reader's own dismiss drag travels before it takes the gesture. Larger than
 *  the back-swipe's, and allowed to be: this one isn't racing a scroll view for the claim on its
 *  axis, so it can ask for a deliberate drag rather than a decisive one. */
const COLLAPSE_ACTIVATE_PX = 20;
const REVEAL_COMMIT_FRACTION = 0.25;
const DISMISS_COMMIT_FRACTION = 0.5;
// The reveal pull: how far past the details list's top the rubber-band must be pulled, at
// release, to expand the reader. Roughly usePullToRefresh's trigger feel.
const PULL_COMMIT_PX = 80;
// How far from the LEFT edge a touch may start and still count as the back-swipe (the native
// stack pop gesture, recreated — a transparent modal doesn't get the real one).
const SPRING_BACK = { duration: 300, dampingRatio: 1 } as const;
// The visible height of the collapsed reader strip (below the safe area) — a faded-out
// background-image band forming the TOP OF THE DETAILS PAGE (it scrolls away under the content
// like any page header, it is not fixed chrome).
const HEADER_BAND = 200;
// The strip-to-details seam gradient's height. It's tall on purpose: the transition is CENTERED
// ON THE SERIES TITLE — the title (the page's first element) renders mid-gradient over the fading
// strip, X-hero style, so the content top inset is derived from this (see headerTopInset).
const SHEET_FADE_H = 120;
// The SEARCH layer's slide is UIKit's card push/pop, reproduced — see lib/ios-card-pop.ts for the
// numbers and, more importantly, the two mistakes they exist to stop being made again.
// ── The ZOOM entrance (see lib/series-zoom) ──────────────────────────────────────────────────
// A port of react-native-screen-transitions' `navigation.zoom({ target: 'bound' })` — the
// transition React Navigation's "building custom screen transitions" post demonstrates. See
// zoomMaskStyle / zoomPageStyle for the mechanism; these are its tuning constants, kept at the
// library's own values so the motion matches rather than merely resembles.
//
// Springs, from the library's `Specs.Zoom`. Very stiff and very heavily damped — the travel is
// carried by the mask and the scale, not by bounce.
// `Specs.DefaultSpec` — heavily overdamped (damping ratio ~4.6), so the open unfolds rather than
// springs. This is the spec the post configures for the opening direction.
const ZOOM_IN_SPRING = {
  stiffness: 1000,
  damping: 500,
  mass: 3,
  overshootClamping: false,
  // Reanimated's default is 2 — two UNITS PER SECOND, sized for springs on pixel values where
  // velocities run in the hundreds. These drive a 0..1 progress whose entire travel is one unit,
  // so the default lets the tail get cut off early. The library carries 0.02 on both specs,
  // behind a @ts-expect-error for the Reanimated v3 types, which is how it fell out of the port.
  restSpeedThreshold: 0.02,
} as const;
// `Specs.FlingSpec` — and this is the one that was wrong. The post configures the CLOSE direction
// with FlingSpec, a deliberately loose spring; I had ported `Specs.Zoom.close` instead, which is
// a different, much stiffer pair (1100/98/3, damping ratio 0.85, ω 19). Its envelope decays with
// a ~60ms time constant, so a drag released at 70% of the way open finished the remaining travel
// in about a tenth of a second — which is exactly "completes instantly". FlingSpec's ω is 13 on a
// third of the mass, giving a ~85ms constant and roughly triple the visible travel time, with a
// touch of overshoot (the mask clamps at 0, so an undershoot past the card can't show).
const ZOOM_OUT_SPRING = {
  damping: 23.5,
  stiffness: 170,
  mass: 1,
  overshootClamping: false,
  restSpeedThreshold: 0.02,
} as const;
// The cross-fade, verbatim from the library's four opacity ranges. The ARRIVING PAGE fades in
// (`ZOOM_FOCUSED_ELEMENT_*`) while a COPY OF THE TAPPED THUMBNAIL, flying the same path, fades out
// (`ZOOM_UNFOCUSED_ELEMENT_*` — there it is the real source element on the screen underneath,
// transformed to track; from inside a modal we can't touch that view, so we fly a copy). The two
// overlap: for the first third of an open you are looking at the thumbnail, not the page.
// Close uses different ranges than open — the outgoing page holds longer and the thumbnail is
// brought back earlier, so the picture is already there before the page dissolves off it.
const ZOOM_CONTENT_FADE_OPEN = [0, 0.28];
const ZOOM_CONTENT_FADE_CLOSE = [0.13, 0.7];
const ZOOM_THUMB_FADE_OPEN = [0.08, 0.32];
const ZOOM_THUMB_FADE_CLOSE = [0.7, 1];
// The reader's static backdrop gets its OWN, earlier close — it is not part of what's being
// carried away, it is the surface being uncovered, so matching the page's curve held it opaque
// through the first third of the collapse and kept the grid hidden long after the page had
// visibly left. Starts going immediately and is gone by the halfway point. Opening is unchanged
// (it shares the content's range), since that direction was already right.
const ZOOM_BACKDROP_FADE_CLOSE = [0.45, 0.98];
// `computeContentTransformGeometry`'s aspect rule: below this difference the source and the
// destination bound are close enough to shape that the scale COVERS (max), above it the scale
// CONTAINS (min) and the mask does the cropping instead.
const ZOOM_ASPECT_EPSILON = 0.1;
// No source card (deep link, web, a card recycled away before we could measure it): there is no
// rect to align to, so the page does a small centred zoom instead. Still not a slide.
const NO_ORIGIN_SCALE = 0.92;
// How long the entrance will wait for the destination page to report its hero cover's rect before
// giving up and using the computed fallback target. Invisible while it waits — the page is still
// at opacity 0, so all that shows is the untouched grid.
const ZOOM_BOUND_WAIT_MS = 220;
// The DRAG. A dismissal drag doesn't slide the page off — it runs the COLLAPSE under the finger:
// the same mask, transform and cross-fade the chevron plays, just with its progress on the end of
// a thumb, finishing from wherever it was let go.
//
// The follow is the library's zoom/drag.ts resistance, verbatim — a rubber-banded travel along the
// drag axis and a loose one across it. What is NOT ported is that file's separate shrink
// (`resolveZoomDragScale`) and release curve (`resolveZoomDismissContentScale`): those exist
// because there the transition progress stays pinned at 1 for the whole drag, so the shrink has to
// be a second, parallel scale that a Bézier then hands back to the collapse. Driving the progress
// directly makes both unnecessary — and here actively wrong, since our collapsed content scale is
// ~0.91, above that file's 0.5 drag floor, so the two would fight over which way to scale.
const ZOOM_PRIMARY_DRAG_TRANSLATION_SCALE = 0.8;
const ZOOM_PRIMARY_DRAG_RESISTANCE = 2;
const ZOOM_HORIZONTAL_DRAG_DISTANCE_SCALE = 1.5;
const ZOOM_CROSS_AXIS_DRAG_TRANSLATION_SCALE = 0.35;
const ZOOM_CROSS_AXIS_DRAG_RESISTANCE = 0.05;
// How far the finger has to travel, as a fraction of screen width, to drive the collapse all the
// way home. The commit threshold is much lower — this only sets how fast the page shrinks under
// a drag that keeps going.
const ZOOM_DRAG_TRAVEL = 0.9;
// The collapse carries on at the speed the finger was moving — but only up to a point, and this cap
// is not cosmetic.
//
// `zoom` is a 0..1 progress over `span * ZOOM_DRAG_TRAVEL` points, so a release converts to
// progress-per-second by dividing by ~350 on a phone. A hard flick at 3000px/s is therefore ~8.5
// units/sec, which crosses the entire collapse in about a tenth of a second — and ZOOM_OUT_SPRING
// is underdamped (ζ ≈ 0.9), so a velocity that large drives `zoom` straight THROUGH 0 into negative
// within a frame or two. Every style reads `Math.max(0, zoom.value)`, so the animation is visually
// finished before it has played: it reads as the page vanishing, not collapsing.
//
// This was always latent, but the old release rule only committed a flick above 900px/s, so it was
// rare. Once the projected release (lib/gesture-release) started committing any decent throw, it
// became the common case. 3.5 ≈ the rate of a brisk swipe across the full span, so an ordinary
// release still continues at its own speed and only genuine flicks are reined in.
const ZOOM_THROW_MAX = 3.5;
function zoomThrowSpeed(pxPerSecond: number, span: number): number {
  'worklet';
  return Math.min(ZOOM_THROW_MAX, Math.abs(pxPerSecond) / Math.max(1, span * ZOOM_DRAG_TRAVEL));
}
// Back-swipe activation lives in lib/back-swipe.ts — shared with the SEARCH layer below, because
// the one thing that must never differ between two surfaces both pretending to have a back-swipe
// is what counts as one.

/** `resolveZoomPrimaryDragTranslation` — exponential resistance along the drag's own axis. */
function zoomPrimaryDrag(translation: number, dimension: number): number {
  'worklet';
  const direction = translation < 0 ? -1 : 1;
  const baseDistance = Math.max(1, dimension);
  const normalized = Math.abs(translation) / baseDistance;
  const resistance = ZOOM_PRIMARY_DRAG_RESISTANCE * 0.85;
  const resisted = (baseDistance * (1 - Math.exp(-resistance * normalized))) / resistance;
  return direction * Math.min(baseDistance, resisted * ZOOM_PRIMARY_DRAG_TRANSLATION_SCALE);
}

/** `resolveZoomHorizontalDragTranslation` — the primary axis, when that axis is horizontal. */
function zoomHorizontalDrag(translation: number, dimension: number): number {
  'worklet';
  return zoomPrimaryDrag(translation, dimension) * ZOOM_HORIZONTAL_DRAG_DISTANCE_SCALE;
}

/** `resolveZoomCrossAxisDragTranslation` — the off-axis, which follows loosely and never leads. */
function zoomCrossAxisDrag(translation: number, dimension: number): number {
  'worklet';
  const direction = translation < 0 ? -1 : 1;
  const baseDistance = Math.max(1, dimension);
  const normalized = Math.abs(translation) / baseDistance;
  const resisted =
    (baseDistance * (1 - Math.exp(-ZOOM_CROSS_AXIS_DRAG_RESISTANCE * normalized))) /
    ZOOM_CROSS_AXIS_DRAG_RESISTANCE;
  return direction * Math.min(baseDistance, resisted * ZOOM_CROSS_AXIS_DRAG_TRANSLATION_SCALE);
}

// Wall-clock backstop for a collapse whose animation callback never arrives (see closeLayer).
// Generous: the close spring is stiff but a spring has no fixed duration to key off.
const ZOOM_OUT_BACKSTOP_MS = 900;
/** How close to the card counts as arrived, for the leave reaction. Above ZOOM_OUT_SPRING's
 *  `restSpeedThreshold` so a settled collapse always trips it, small enough to be invisible. */
const LEAVE_AT_ZOOM = 0.02;
// Half the title's ~40pt first line — positions the title's CENTER at the gradient's center.
const TITLE_MID = 20;
// The details-content fade (and the reader's matching tint) complete within this fraction of the
// travel — weighted toward the START of a reveal and, symmetrically, the END of a hide.
const FADE_WINDOW = 0.4;

// Warm expo-image's cache around the read position. Deduped through a module-level memo, and only
// http(s) sources are prefetched — a resolved local/data URI is already there.
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

/** One chapter's worth of pages inside the native pager's stitched flat list — what makes a
 *  boundary swipe an ordinary page turn instead of a bounce-and-remount. */
type Segment = { id: string; name?: string; pages: string[] };

/** Same params a series card forwards to `/series` (see series-card.tsx buildHref) — including
 *  the percent-encoded bridge name / cover, decoded the same way series.tsx does. */
type SeriesReaderParams = {
  id?: string;
  title?: string;
  bridge?: string;
  bridgeId?: string;
  cover?: string;
  /** '1' for a direct (chapterless) series — its pages ARE the series. */
  direct?: string;
  /** '1' opens straight into the READER rather than the details — how History and Activity enter,
   *  since a row there is a "carry on reading" action. A swipe up brings the details in, exactly
   *  as it does after expanding from a browse open. */
  reader?: string;
  /** Reader-first entries seed the read position directly instead of resolving it from history:
   *  the row already knows where it left off, and this is what lets the pages request go out on
   *  the first commit (see the fetch ordering below). */
  chapterId?: string;
  chapterName?: string;
  start?: string;
};

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
}: {
  params: SeriesReaderParams;
  depth: number;
  onPopLayer: () => void;
}) {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mock = useMockActive();
  const [settings] = useReaderSettings();

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
  } = params;
  // Opened straight into the reader (History / Activity), rather than onto the details.
  const readerFirst = readerParam === '1';
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

  // Chapter list (chaptered series only) — drives resume-or-first resolution and prev/next
  // adjacency for the reader pane. (The details card's own list rendering — read state, downloads,
  // versions — is SeriesBody's business, not duplicated here.)
  const { data: listData } = useQuery(seriesListQuery(ds, mock, bridgeId ?? '', id ?? '', false, !isDirect));
  const chapters = listData?.chapters;

  // Library membership — picks the reader pane's progress-recording path (library series →
  // chapter progress, everything else → the reading log). The query lives HERE, not in the pane:
  // the pane re-renders on every page sweep, and useQuery's per-render subscription work (query
  // key hashing) is measurable at that cadence.
  const { data: inLibrary } = useQuery({
    ...inLibraryQuery(ds, mock, bridgeId ?? '', id ?? ''),
    retry: false,
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
    if (seedChapterId) return { chapterId: seedChapterId, chapterName: seedChapterName, start: at };
    if (direct === '1') return { start: at };
    return null;
  });
  const target = override ?? derivedTarget;
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
  // Series detail for the toolbar/settings gear (placeholder-seeded from the forwarded
  // title+cover). The details card's SeriesDetailsHost subscribes to this same query key, so this
  // costs one fetch total.
  const { data: series = null } = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
  );
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

  // ── Stitching (native paged mode): the pager's window ────────────────────
  // Adjacent chapters' page lists, subscribed eagerly (cache-first; a list is just URLs) so the
  // native paged reader can stitch them into ONE flat pager — swiping across a chapter boundary
  // is then an ordinary page turn with an in-place relabel, no remount.
  const stitched = !IS_WEB && settings.mode === 'paged' && !isDirect;
  // The committed side of the reveal (declared up here — the stitching queries below gate on
  // it). The screen opens ON the details; see the reveal section further down.
  const [detailsActive, setDetailsActive] = useState(!readerFirst);
  // True while a horizontal details gesture (back-swipe or webtoon reveal) is ACTIVE. The pans
  // ride the details scroller's own detector, simultaneous with it — that's the only way they
  // activate over a UIScrollView at all (see makeBackSwipePan) — but simultaneous means the list
  // happily keeps scrolling underneath a swipe that is carrying the whole page away. Freezing
  // the scroller for the duration is the standard fix: one re-render as the gesture takes over,
  // and iOS drops its in-flight tracking the moment scrolling is disabled.
  const [swipeLocked, setSwipeLocked] = useState(false);
  // `detailsActive`, but lagging past the 240ms reveal/collapse animation: the HEAVY mode flips
  // (the standby render window, the adjacent-chapter fetches) key off THIS, so page cells mount
  // and lists re-window after the transition has finished instead of chopping it mid-flight.
  const [detailsSettled, setDetailsSettled] = useState(!readerFirst);
  useEffect(() => {
    const t = setTimeout(() => setDetailsSettled(detailsActive), 300);
    return () => clearTimeout(t);
  }, [detailsActive]);
  // Deferred while the details are up (standby): the strip needs nothing beyond its visible
  // page, and a window prepend arriving under the strip re-anchors the pager — a visible pop on
  // an otherwise settled image. Expanding enables them and the window builds for real reading.
  const { data: prevPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', prevChapter?.id ?? ''),
    enabled: stitched && !detailsSettled && !!id && !!prevChapter,
  });
  const { data: nextPages } = useQuery({
    ...chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', nextChapter?.id ?? ''),
    enabled: stitched && !detailsSettled && !!id && !!nextChapter,
  });

  // The stitched window — the RUN: a segment only joins once its pages are loaded (no holes); it
  // only ever GROWS during one continuous run (appending at the tail keeps the pager's offset
  // valid — dropping from the HEAD instead shifts every offset and flashes the pager black);
  // landing outside the run starts a fresh one, bumping `runKey` so the pane remounts and seeds
  // from `start` instead of re-anchoring.
  const [run, setRun] = useState<{ key: number; segs: Segment[] }>({ key: 0, segs: [] });
  const { segments, runKey } = useMemo(() => {
    if (!pages || !stitched) return { segments: [] as Segment[], runKey: run.key };
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
      const segs: Segment[] = [];
      if (prevSeg) segs.push(prevSeg);
      segs.push({ id: currentId, name: target?.chapterName, pages });
      if (nextSeg) segs.push(nextSeg);
      // Bump the key only when there was a real run to leave, so the very first window doesn't
      // count as a remount.
      return { segments: segs, runKey: run.key + (run.segs.length ? 1 : 0) };
    }
    // Extend, never drop.
    const stale = run.segs[at]!;
    const refreshCurrent = stale.pages !== pages || stale.name !== target?.chapterName;
    const addPrev = !!prevSeg && at === 0;
    const addNext = !!nextSeg && run.segs[run.segs.length - 1]!.id === currentId;
    if (!refreshCurrent && !addPrev && !addNext) return { segments: run.segs, runKey: run.key };
    const segs = run.segs.slice();
    if (refreshCurrent) segs[at] = { id: currentId, name: target?.chapterName, pages };
    if (addPrev) segs.unshift(prevSeg);
    if (addNext) segs.push(nextSeg);
    return { segments: segs, runKey: run.key };
  }, [run, pages, stitched, targetChapterId, target?.chapterName, prevChapter, prevPages, nextChapter, nextPages]);
  // Catch the run state up DURING render (React's adjust-state-on-render pattern — the merge
  // above returns `run.segs` by identity when there's nothing to add, which is what stops this
  // from looping). `!pages` (a chapter still loading) renders no window at all, but must not wipe
  // the run — the pager is unmounted then and comes back to the same one.
  if (pages && stitched && (segments !== run.segs || runKey !== run.key)) {
    setRun({ key: runKey, segs: segments });
  }

  // A stitched crossing settled: flush of the OLD chapter's progress already happened in the pane;
  // this just relabels which chapter is "current" WITHOUT remounting (the pane's key is the run,
  // not the chapter, and the window merge above finds the new current already in `run.segs`).
  const relabelFromPager = useCallback((chapterId: string, chapterName: string | undefined, page: number) => {
    setOverride({ chapterId, chapterName, start: page });
  }, []);

  // ── Chrome auto-hide ───────────────────────────────────────────────────────
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
  // entry ends up using.
  const progress = useSharedValue(readerFirst ? 0 : 1);
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

  // JS-side half of a commit — deliberately closes over nothing but state setters (no shared
  // values, no timer refs), so the gesture worklets can `runOnJS` it; the worklets animate
  // `progress` themselves. Landing back in the reader re-shows the chrome (it may have auto-hidden
  // while the details were up) — the effect below re-arms the countdown.
  const commitReveal = useCallback((to: 0 | 1) => {
    setDetailsActive(to === 1);
    if (to === 0) setChromeVisible(true);
  }, []);
  useEffect(() => {
    if (!detailsActive) scheduleHide();
  }, [detailsActive, scheduleHide]);
  // Full JS-side reveal (pill, grab-handle, hardware back, chapter/page intents).
  const setRevealed = useCallback(
    (to: 0 | 1) => {
      detailsActiveSV.set(to === 1);
      pullEngagedSV.set(false); // the commit animation owns `progress` — stop any live pull-follow
      progress.set(withTiming(to, { duration: 240, easing: Easing.out(Easing.cubic) }));
      commitReveal(to);
    },
    [progress, detailsActiveSV, pullEngagedSV, commitReveal],
  );

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
      if (!detailsActiveSV.value) {
        // A commit's animation owns `progress` now; the leftover bounce must not re-engage.
        pullEngagedSV.set(false);
        return;
      }
      if (off < 0) {
        if ((prevOff ?? 0) >= 0) {
          pullEngagedSV.set(true);
          pullStartSV.set(progress.value);
        }
        if (pullEngagedSV.value) {
          progress.set(Math.max(0, Math.min(1, pullStartSV.value + off / headerSpan)));
        }
      } else if (pullEngagedSV.value) {
        pullEngagedSV.set(false);
        if (progress.value < 1) {
          progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        }
      }
    },
    [headerSpan, detailsScrollOffset, detailsActiveSV, pullEngagedSV, pullStartSV, progress, scrollTraceGate],
  );
  const onDetailsScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      traceJS('details.scroll', 'endDrag', { y: e.nativeEvent.contentOffset.y, active: detailsActive });
      if (!IS_IOS || !detailsActive) return;
      // The UI-thread release watcher (pullReleaseWatch below) usually lands this commit first;
      // the shared-value mirror is already false then — don't restart its animation. This JS
      // path remains the full fallback when those touches weren't observed.
      if (!detailsActiveSV.get()) return;
      if (e.nativeEvent.contentOffset.y <= -PULL_COMMIT_PX) setRevealed(0);
    },
    [detailsActive, detailsActiveSV, setRevealed],
  );

  // Leaving this instance. The modal ROOT pops the route (deep-linked/full-page-loaded entries
  // on web have no back stack — land on the browse tabs instead of dead-ending). A drilled
  // LAYER never touches navigation: it collapses on the same `zoom` the back-swipe drags
  // (closeLayer — chevron/hardware back), or is removed outright once a gesture has already
  // collapsed it / flown the page out (leaveNow — the parent series is live beneath).
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  const leaveNow = useCallback(() => {
    if (depth > 0) onPopLayer();
    else goBack();
  }, [depth, onPopLayer, goBack]);
  // EVERY exit animation ends here rather than calling `leaveNow` directly, because an animation
  // callback is not a promise that it ran: reanimated reports `finished: false` for a curve that
  // got interrupted, and an exit that reached its end state without leaving stranded the page —
  // mounted, invisible or shrunk, and still swallowing touches. So the exits below fire this
  // whether or not the curve finished, AND arm a wall-clock backstop, and this makes the extra
  // calls harmless.
  // A shared value rather than a ref on purpose: the back-swipe builds its pan DURING render (see
  // detailsScrollGesture), so anything that pan's worklets reach must not touch a React ref.
  const leftSV = useSharedValue(false);
  const leaveOnce = useCallback(() => {
    if (leftSV.get()) return;
    leftSV.set(true);
    leaveNow();
  }, [leftSV, leaveNow]);
  // True from the moment an exit starts: the page stops taking touches immediately, so nothing
  // can be tapped on a page that is on its way out (or, if a leave ever does fail, on one that is
  // stuck). Also what keeps a half-faded page from eating taps meant for the grid behind it.
  const [leaving, setLeaving] = useState(false);
  // …and the wall-clock backstop hangs off that same flag, so it covers every exit — the chevron,
  // hardware back, and a released dismissal drag — with one timer and no ref to reach.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(leaveOnce, ZOOM_OUT_BACKSTOP_MS);
    return () => clearTimeout(t);
  }, [leaving, leaveOnce]);

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
  const zoom = useSharedValue(0);
  // The entrance waits for that measurement — the library does the same, holding the pair until
  // both ends have reported. Invisible here: the page is at opacity 0 until the spring starts, so
  // a frame or two of waiting just shows the untouched grid. A deadline caps it, after which the
  // transition falls back to the library's own no-destination behaviour (see zoomGeom).
  //
  // ARMING matters as much as waiting. `measureInWindow` reports a view's rect AFTER every
  // ancestor transform, so measuring the cover while the page is already scaled hands back a
  // shrunken rect — and a destination smaller than the source inverts the scale, which is the page
  // starting large and settling down to its real size. So the page stays at IDENTITY (invisible,
  // opacity 0) until the bound is in; only then do the transform and the mask engage. That is what
  // the library means by keeping a component at its base layout for pre-animation measurement.
  const zoomArmed = useSharedValue(false);
  // Which set of cross-fade ranges is in play (see the constants) — an exit uses different ones.
  const zoomClosing = useSharedValue(false);
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
  const edgeCommitting = useSharedValue(false);

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
  const collapseEnabled = !detailsActive && !readerZoomed && !scrubbing;
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
    const revealByDrag = settings.mode === 'paged';
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
          // The follow: both axes, unclamped — feeding the collapse instead of a fling. Distance
          // in ANY direction drives it, since unlike the back-swipe this gesture has no single
          // axis to measure along.
          zoomClosing.set(true);
          zoom.set(
            1 - Math.min(1, Math.hypot(e.translationX, e.translationY) / (dismissSpan * ZOOM_DRAG_TRAVEL)),
          );
          dragX.set(e.translationX);
          dragY.set(e.translationY);
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
          // The release decision — the shared projection (lib/gesture-release), judged along the
          // direction the page actually travelled, since this one can be thrown off either side.
          const crossOffset = settings.mode === 'paged' ? dragY.value : dragX.value;
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
          runOnJS(setLeaving)(true);
          const throwSpeed = zoomThrowSpeed(Math.hypot(e.velocityX, e.velocityY), dismissSpan);
          zoom.set(
            // overshootClamping: there is nothing past "collapsed", so the spring must not travel
            // through 0 and settle back up to it. No completion callback — leaving is driven by
            // `zoom` actually reaching the card (see the reaction near leaveOnce).
            withSpring(0, { ...ZOOM_OUT_SPRING, overshootClamping: true, velocity: -throwSpeed }),
          );
          dragX.set(withSpring(0, ZOOM_OUT_SPRING));
          dragY.set(withSpring(0, ZOOM_OUT_SPRING));
        })
        // Always fires once the gesture resolves (release OR cancel) — the next gesture decides
        // its own mode fresh.
        .onFinalize((_e, success) => {
          // A cancelled dismiss drag never reaches onEnd — don't leave the page part-collapsed.
          // Same `success` test as the back-swipe's, for the same reason.
          if (gestureMode.value === 2 && !success) {
            zoomClosing.set(false);
            zoom.set(withSpring(1, SPRING_BACK));
            dragX.set(withSpring(0, SPRING_BACK));
            dragY.set(withSpring(0, SPRING_BACK));
          }
          gestureMode.set(0);
        });
      // The back-swipe's ACTIVATION-side dominance (lib/back-swipe), applied to whichever axis this
      // mode dismisses along: paged drags across the pages' axis (vertical), webtoon across the
      // scroll's (horizontal). The activation half, not the strict release angle — this pan has no
      // release-time second look, so its one gate has to stay generous enough to catch real drags.
      // The DISTANCE stays this surface's own: nothing here is racing a scroller for the claim, so
      // it can afford to ask for more travel before it takes the gesture.
      const cross = Math.round(COLLAPSE_ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);
      if (settings.mode === 'paged') {
        pan.activeOffsetY([-COLLAPSE_ACTIVATE_PX, COLLAPSE_ACTIVATE_PX]).failOffsetX([-cross, cross]);
      } else {
        pan.activeOffsetX([-COLLAPSE_ACTIVATE_PX, COLLAPSE_ACTIVATE_PX]).failOffsetY([-cross, cross]);
      }
      return pan;
    }
  }, [
    settings.mode,
    collapseEnabled,
    width,
    height,
    headerSpan,
    gestureMode,
    progressStartSV,
    progress,
    dismissing,
    detailsActiveSV,
    commitReveal,
    zoom,
    zoomClosing,
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
      .enabled(detailsActive)
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
        progress.set(withTiming(open ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(open ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
    pan.activeOffsetY([-20, 20]).failOffsetX([-15, 15]);
    return pan;
  }, [detailsActive, headerSpan, panBeganSV, progressStartSV, progress, detailsActiveSV, commitReveal]);

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
        progress.set(withTiming(close ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(close ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
  }, [detailsActive, headerSpan, panBeganSV, progressStartSV, progress, touchStartX, touchStartY, detailsScrollOffset, detailsActiveSV, commitReveal]);

  // ── The ZOOM: how this instance arrives and leaves ───────────────────────────────────────────
  // Where the page came FROM: the cover box of the card that was tapped, in window coordinates
  // (lib/series-zoom). EVERY instance takes one — a drilled layer is opened from a card in a
  // related rail (or a nested search result), and that is just as much an "open this series" as a
  // tap on the browse grid, so it gets the same entrance rather than a push.
  //
  // Consumed in a state initializer so it's known on the FIRST render — a frame later would mean
  // starting the grow from the wrong geometry — and remembered for the instance's whole lifetime,
  // so the exit collapses back into the same box.
  const [zoomSource] = useState(() => (IS_WEB ? null : takeZoomOrigin(id)));
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
  const zoomReleaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => zoomReleaseRef.current?.(), []);
  const startZoom = useCallback(() => {
    if (zoomStartedRef.current) return;
    zoomStartedRef.current = true;
    // Blank the ONE card this grew out of — not every card showing this series (see the module).
    if (zoomSource && id) zoomReleaseRef.current = holdZoomingSeries(id, zoomSource.source);
    zoomArmed.set(true);
    zoom.set(withSpring(1, ZOOM_IN_SPRING));
  }, [zoom, zoomArmed, zoomSource, id]);
  const onHeroCoverRect = useCallback((rect: ZoomRect) => {
    // Only the FIRST report, and only before the geometry is committed: the cover box re-lays out
    // as its aspect settles, and moving the destination mid-flight would visibly jump.
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

  // The chevron / hardware-back exit, for a drilled layer AND the modal root: shrink back into the
  // card we came from, then leave (leaveNow pops the layer, or the route when depth 0). The
  // route's `animation: 'none'` means this IS the exit animation — without it a tapped back would
  // just blink the screen away.
  const closeLayer = useCallback(() => {
    if (leftSV.get()) return;
    setLeaving(true);
    zoomClosing.set(true);
    edgeCommitting.set(true);
    zoom.set(withSpring(0, ZOOM_OUT_SPRING));
    // No completion callback: leaving is driven by `zoom` reaching the card (see the reaction near
    // leaveOnce), with the `leaving` backstop above as the safety net.
  }, [leftSV, edgeCommitting, zoom, zoomClosing]);

  // Android hardware back steps back HOME (the details) before leaving: reader expanded → back
  // collapses it; details up → the instance slides out (a drilled layer back to its parent
  // series, the root back to whatever it was opened over).
  // Layer handlers register after their parent's (mounted later), so BackHandler's LIFO order
  // naturally gives the topmost instance the event. (Android-only API — react-native-web's
  // BackHandler stub rejects addEventListener.)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!detailsActive) setRevealed(1);
      else closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [detailsActive, setRevealed, closeLayer]);
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
      // Read STRAIGHT back — and on device this reports FALSE. `commit.latched readback=n` is what
      // a real trace says: a shared-value write is not visible to a read later in the SAME worklet
      // invocation, though it is visible to the next one (which is why the guard above still works
      // across gestures). Nothing here depends on it any more — onFinalize asks `success` instead
      // — but the probe stays, because anything that ever reaches for this latch inside one
      // callback will silently get the stale answer.
      trace(tag, 'commit.latched', { readback: edgeCommitting.value });
      runOnJS(setLeaving)(true);
      // Resume from exactly where it was slid to: the collapse and the follow both spring from
      // their current values, so the page carries on from that spot into the card. Hand the throw
      // over too — the pan's velocity is in points per second and `zoom` moves one unit per
      // `width * ZOOM_DRAG_TRAVEL` points, so this is the same motion continuing rather than a
      // fresh spring starting from rest at the release point.
      zoom.set(
        withSpring(0, { ...ZOOM_OUT_SPRING, overshootClamping: true, velocity: -zoomThrowSpeed(velocityX, width) }, (finished) => {
          // Traced, but it no longer DECIDES anything — see the leave reaction near leaveOnce.
          trace(tag, 'collapse.done', { finished: !!finished, zoom: zoom.value });
        }),
      );
      dragX.set(withSpring(0, ZOOM_OUT_SPRING));
      dragY.set(withSpring(0, ZOOM_OUT_SPRING));
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
        runOnJS(setSwipeLocked)(true);
        // A drag IS a collapse, so it uses the collapse's cross-fade ranges from the first frame.
        zoomClosing.set(true);
      })
      .onUpdate((e) => {
        'worklet';
        if (!detailsActiveSV.value) return;
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        traceThrottled(updateGate, 60, tag, 'update', { tx, ty, zoom: zoom.value });
        zoom.set(1 - Math.min(1, Math.max(0, tx / (width * ZOOM_DRAG_TRAVEL))));
        dragX.set(zoomHorizontalDrag(tx, width));
        dragY.set(zoomCrossAxisDrag(ty, height));
      })
      .onEnd((e) => {
        'worklet';
        trace(tag, 'END', {
          tx: e.translationX - originX.value,
          ty: e.translationY - originY.value,
          vx: e.velocityX,
          zoom: zoom.value,
          active: detailsActiveSV.value,
          committing: edgeCommitting.value,
          ran: ranHere.value,
        });
        if (!detailsActiveSV.value) return;
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        // Two questions, and BOTH have to say yes: was this a back-swipe at all (did it stay
        // horizontal over its whole length — activation could only see the first ten points, see
        // lib/back-swipe), and did it go far enough. A diagonal drag followed the finger and springs
        // back, which is the right outcome for one: it was never going anywhere.
        //
        // Finish from exactly where the finger left it — the spring starts at the current value, so
        // there is no seam between the dragged part and the animated part.
        if (
          backSwipeStayedHorizontal(tx, ty) &&
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
    detailsActiveSV,
    zoom,
    zoomClosing,
  ]);
  // `traceOn` is a DEP on purpose: backSwipePan only attaches its touch observers while the trace
  // is recording, so flipping the toggle has to rebuild the gestures for the change to take.
  const traceOn = useGestureTraceEnabled();
  // WEB ONLY. This used to be a second copy of the back-swipe living on the screen-level detector,
  // alongside the one riding the list — the theory being that the list copy covers the scroller and
  // this one covers the chrome around it.
  //
  // A device trace killed that. Across ~20 attempts the screen-level copy activated ZERO times, and
  // in every failed attempt BOTH copies finalized unsuccessfully in the same millisecond, right as
  // the drag reached the activation threshold — with `dy` of one or two pixels, so nothing in the
  // criteria had failed. That is what an ancestor detector and a descendant detector reaching for
  // the same touch on the same frame looks like: they are not declared simultaneous with each
  // other, so each cancels the other and the swipe dies at exactly the moment it should have
  // started. The swipes that DID work were the fast ones, where one copy crossed the threshold a
  // frame before the other could contest it.
  //
  // So on native there is now ONE back-swipe: the copy composed with the scroller (below), which is
  // the only one that ever won. Web keeps this one instead, because there `detailsScrollGesture` is
  // undefined — no native recognizer to be simultaneous with, and nothing for it to fight.
  //
  // Not merely disabled on native — not BUILT. A permanently-disabled gesture still rebuilds when
  // its deps change, and a rebuilt gesture costs a full re-serialization of its callbacks (see
  // detailsBackSwipe below for the measurement). Dead weight that bills on every settle is worse
  // than dead weight.
  const edgePan = useMemo(
    () => (IS_WEB ? makeBackSwipePan('series.edge').enabled(detailsActive) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, detailsActive, traceOn],
  );
  // THE back-swipe on native (see edgePan above for why it's the only one).
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
    () => (IS_WEB ? null : makeBackSwipePan('series.list')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn],
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
        if (!detailsActiveSV.value || !pullEngagedSV.value) return;
        if (detailsScrollOffset.value <= -PULL_COMMIT_PX) {
          pullEngagedSV.set(false);
          detailsActiveSV.set(false);
          progress.set(withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) }));
          runOnJS(commitReveal)(0);
        }
      });
  }, [detailsActive, detailsActiveSV, pullEngagedSV, detailsScrollOffset, progress, commitReveal]);
  const detailsGestures = useMemo(
    () => (edgePan ? Gesture.Race(edgePan, returnPan, pullReleaseWatch) : Gesture.Race(returnPan, pullReleaseWatch)),
    [edgePan, returnPan, pullReleaseWatch],
  );
  // Geometry: the reader strip's height — the top-of-page band the details content starts below.
  // The details layer itself is full-screen (the strip is page, not chrome). Declared up here
  // because it is also the zoom's DESTINATION BOUND (see zoomGeom).
  const bandH = insets.top + HEADER_BAND;

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
  // Geometry is `computeContentTransformGeometry` verbatim — scale about the SCREEN centre, then
  // translate so the destination bound's anchor meets the source's. `scaleMode: 'uniform'` with
  // its aspect rule: near-equal aspects take max(sx, sy) (cover), genuinely different ones take
  // min(sx, sy) (contain) and let the mask do the cropping. Ours differ (a 2:3 cover into a wide
  // band), so it contains — which is exactly why the mask is not optional.
  const zoomGeom = useMemo(() => {
    if (!hero) return null;
    // With a measured destination bound this is the library's `target: 'bound'` — align the two
    // rects centre to centre. Without one it falls back to `getZoomContentTarget`'s computed
    // target: a virtual destination that keeps ONE edge attached to the source, so a wide source
    // fills the destination's width and follows its top edge while a narrow one fills the height
    // and follows the leading edge. Anchors follow `getZoomContentAnchor` accordingly.
    // WHICH bound depends on what is actually on screen. The measured hero cover is only the
    // right destination while the DETAILS are up — that is where the picture lives, and landing on
    // it is what makes the transition a shared element. Collapsing out of the expanded READER it
    // is the wrong answer twice over: the details are slid away, so that rect corresponds to
    // nothing visible, and it is a fixed small box, so the copy sat at one static size over a
    // full-screen page instead of shrinking with it.
    //
    // So the reader uses the computed target instead, which is defined RELATIVE to the screen —
    // full width at the source thumbnail's aspect. The copy is then a constant fraction of the
    // page and scales with it all the way down into the card, which is what "swiping the page
    // away" should look like. (It also collapses much further: the page scales to roughly the
    // card's width fraction rather than the ~0.91 a details-sized bound gives.)
    const bound = detailsActive ? destBound : null;
    const sourceAspect = hero.width / hero.height;
    const screenAspect = width / height;
    // The computed target is CENTRED on the page. `getZoomContentTarget` pins it to an edge
    // instead — top for a wide source, leading for a narrow one — which suits a gallery, where the
    // destination really does start at the top of its screen. Here it has no counterpart in the
    // layout at all: it stands in for the page as a whole, so anything but centred reads as the
    // copy sitting off to one side of the thing it is supposed to be standing in for.
    const fitToWidth = sourceAspect >= screenAspect;
    const fitW = fitToWidth ? width : sourceAspect * height;
    const fitH = fitToWidth ? (hero.height / hero.width) * width : height;
    const end: ZoomRect = bound ?? {
      x: (width - fitW) / 2,
      y: (height - fitH) / 2,
      width: fitW,
      height: fitH,
    };

    const sx = hero.width / end.width;
    const sy = hero.height / end.height;
    const aspectDifference = Math.abs(sourceAspect - end.width / end.height);
    const s = aspectDifference < ZOOM_ASPECT_EPSILON ? Math.max(sx, sy) : Math.min(sx, sy);

    // getAnchorPoint, for the three anchors this transition can pick.
    // Centre-to-centre either way now — the measured bound always used it, and the computed one
    // is centred by construction above.
    const anchorOf = (b: ZoomRect) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const startAnchor = anchorOf(hero);
    const endAnchor = anchorOf(end);
    const screenCenterX = width / 2;
    const screenCenterY = height / 2;
    // Where to lay the FLYING COPY out. Not `end` — `end` only lands on the card when the two
    // rects share an aspect, because the page carries a single uniform scale and a scalar cannot
    // reshape a rectangle. The copy's job is to be indistinguishable from the card at q = 0 (the
    // last frames of a collapse, where it is the only thing still opaque), so it is sized to
    // become the source rect exactly: `hero.size / s`, centred on `end`. When the aspects agree
    // this IS `end` — s is then hero.width/end.width and the two expressions coincide — so the
    // common case is untouched and the mismatched one stops being a mismatch.
    //
    // The trade lands on the other end: with genuinely different aspects the copy no longer
    // matches the details hero at q = 1. That end is free — the copy is fully transparent by 0.32
    // opening and doesn't start showing until 0.7 closing (see the fade ranges).
    const thumbW = hero.width / s;
    const thumbH = hero.height / s;
    return {
      s,
      end,
      thumb: {
        x: endAnchor.x - thumbW / 2,
        y: endAnchor.y - thumbH / 2,
        width: thumbW,
        height: thumbH,
      },
      tx: startAnchor.x - (screenCenterX + (endAnchor.x - screenCenterX) * s),
      ty: startAnchor.y - (screenCenterY + (endAnchor.y - screenCenterY) * s),
    };
    // `detailsActive` is COMMITTED state, so it only flips when a reveal or collapse finishes —
    // never mid-flight, which is what would make swapping the bound visible.
  }, [hero, destBound, detailsActive, width, height]);

  // THE MASK. Grows from the source rect to the whole screen, carrying the card's corner radius
  // out to 0. In the library this lives INSIDE the transformed content and undoes the content
  // transform to reach absolute coordinates; here it is the content's PARENT, which gets the same
  // result with none of the compensation math — at the cost of the page needing to undo the
  // mask's own offset (see zoomPageStyle).
  const zoomMaskStyle = useAnimatedStyle(() => {
    // Always explicit numbers, never a percentage fallback from the stylesheet — a mask that is
    // sometimes laid out and sometimes transformed is how the two halves get to disagree.
    // No source rect, or not yet armed: the whole screen, so nothing is clipped.
    if (!hero || !zoomArmed.value) {
      return { left: 0, top: 0, width, height, borderRadius: 0, borderCurve: 'continuous' as const };
    }
    // Clamped at the bottom: the close spring is underdamped (damping ratio ~0.85, the library's
    // own figure) and undershoots 0 by a percent or two, which on a raw lerp would mean a mask
    // narrower than the card — and briefly a NEGATIVE width. The top needs no clamp: the open
    // spring is heavily overdamped and never passes 1.
    const q = Math.max(0, zoom.value);
    return {
      // The drag moves the MASK, not the page inside it. Both have to travel together or the page
      // slides out from under its own window — a rectangle of page hanging in the wrong place,
      // which is exactly what a dragged mask-less collapse looked like.
      left: hero.x * (1 - q) + dragX.value,
      top: hero.y * (1 - q) + dragY.value,
      width: hero.width + (width - hero.width) * q,
      height: hero.height + (height - hero.height) * q,
      borderRadius: hero.radius * (1 - q),
      borderCurve: 'continuous' as const,
    };
  }, [hero, width, height]);

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
    if (!zoomGeom || !hero) {
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
    const maskLeft = hero.x * (1 - q);
    const maskTop = hero.y * (1 - q);
    // Scale: normally the base content scale modulated by the drag's shrink. Once the finger has
    // let go of a dismissal it becomes the finishing Bézier instead — from the scale the page was
    // released at, down to the collapsed scale, biased by the release velocity.
    const scale = zoomGeom.s + (1 - zoomGeom.s) * q;
    // NOTE the compensation uses the UNDRAGGED mask origin. The mask sits at `maskLeft + dragX`
    // and the page at `T - maskLeft` inside it, which puts the page at `T + dragX` in window
    // space: mask and content displaced by exactly the same amount, so the window keeps framing
    // the same part of the page however far it is dragged.
    return {
      transform: [
        { translateX: zoomGeom.tx * (1 - q) - maskLeft },
        { translateY: zoomGeom.ty * (1 - q) - maskTop },
        { scale },
      ],
    };
  }, [zoomGeom, hero]);

  // The two halves of the cross-fade. The page's own opacity is separated from its transform so
  // the thumbnail copy can ride that same transform (it is a sibling INSIDE the transformed page,
  // laid out at the destination bound — which means it starts life exactly on the tapped card and
  // arrives exactly on the page's cover, with no geometry of its own to keep in sync).
  const zoomContentFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    const range = zoomClosing.value ? ZOOM_CONTENT_FADE_CLOSE : ZOOM_CONTENT_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  });
  // See ZOOM_BACKDROP_FADE_CLOSE — same shape as the content fade, one range different.
  const zoomBackdropFadeStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0 };
    const q = Math.max(0, zoom.value);
    const range = zoomClosing.value ? ZOOM_BACKDROP_FADE_CLOSE : ZOOM_CONTENT_FADE_OPEN;
    return { opacity: interpolate(q, range, [0, 1], Extrapolation.CLAMP) };
  });
  const zoomThumbStyle = useAnimatedStyle(() => {
    if (!zoomArmed.value) return { opacity: 0, borderRadius: hero ? hero.radius : 0 };
    const q = Math.max(0, zoom.value);
    const range = zoomClosing.value ? ZOOM_THUMB_FADE_CLOSE : ZOOM_THUMB_FADE_OPEN;
    // The copy has to READ as the thumbnail it came off, corner included — 10pt on a grid card, 6
    // on a History/Activity row (see ZoomOrigin). This
    // rect rides the page's transform, so divide that scale out to hold the on-screen radius
    // steady rather than letting it grow with the page. (The library gets this for free: it moves
    // the real source view, which simply keeps its own radius under the tracked scale.)
    const s = zoomGeom ? zoomGeom.s + (1 - zoomGeom.s) * q : 1;
    return {
      opacity: interpolate(q, range, [1, 0], Extrapolation.CLAMP),
      borderRadius: (hero ? hero.radius : 0) / Math.max(s, 0.01),
    };
  }, [zoomGeom]);
  const zoomThumbUri = useResolvedAsset(cover);

  // Content starts high enough that the series title's center lands on the seam gradient's
  // center — the strip fades into the details THROUGH the title.
  const headerTopInset = bandH - SHEET_FADE_H / 2 - TITLE_MID;

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
    // and half the gradient peeking at the bottom of the expanded reader); when scrolled, the
    // seam parks at the screen top and the travel saturates at the full height.
    const seamTopRest = bandH - SHEET_FADE_H;
    const travel = height - seamTopRest + Math.min(Math.max(off, 0), seamTopRest);
    // The `min(off, 0)` term cancels the layer's share of an ACTIVE iOS pull: while the native
    // rubber-band is moving the content (and headerSheetBgStyle the seam) down 1:1 already, the
    // pull-driven progress must not ALSO move the layer — only the commit animation (progress
    // moving past the finger-tracked value while the bounce returns to 0) takes it off screen.
    return { transform: [{ translateY: (1 - progress.value) * travel + Math.min(off, 0) }] };
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
  // How much of the screen this page currently covers. All three ways it can be less than fully
  // covering have to count, or the backdrop would sit dimmed while the page is visibly gone: the
  // `zoom` alone, now that BOTH dismiss gestures drive it — the back-swipe and the reader's
  // swipe-away. This used to carry a second term for the swipe-away, which flung the page along
  // its own vector without touching `zoom`; there is no such vector any more.
  // Depth 0 ONLY: a drilled layer sits over its parent series inside this same modal, and the tabs
  // behind the whole modal must not respond twice to what is, to them, one open page.
  useAnimatedReaction(
    () => {
      return zoom.value;
    },
    (covered) => {
      if (depth === 0) seriesReaderDim.set(covered);
    },
    [depth],
  );
  // Belt and braces: nothing may strand the backdrop dimmed if this screen goes away without its
  // exit animation finishing (a deep link replacing the route, a dev reload).
  useEffect(() => {
    if (depth > 0) return;
    return () => {
      seriesReaderDim.set(0);
    };
  }, [depth]);

  // ── Details-card intents, routed back into the in-place reader ───────────
  const paneRef = useRef<ReaderPaneHandle>(null);
  const openChapterFromDetails = useCallback(
    (v: Chapter) => {
      if (v.id !== targetChapterId) {
        setJumpNonce((n) => n + 1); // explicit jump — remount seeded at the target, even in-window
        setOverride({
          chapterId: v.id,
          chapterName: v.name,
          start: resume?.chapterId === v.id ? (resume.lastPage ?? 0) : 0,
        });
      }
      setRevealed(0);
    },
    [targetChapterId, resume, setRevealed],
  );
  const openPageFromDetails = useCallback(
    (pageIndex: number) => {
      paneRef.current?.goTo(pageIndex, false);
      setRevealed(0);
    },
    [setRevealed],
  );
  // The Read button/cover: the pane already sits at the same resume point Read would compute.
  const startReadingFromDetails = useCallback(() => setRevealed(0), [setRevealed]);

  const scheme = useActiveColorScheme();
  const seriesTitle = series?.title ?? title ?? id ?? 'Reader';
  const author = series?.meta?.find((m) => m.label === 'AUTHOR')?.value;
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

  // ONE statically-stuck top-bar slot serving BOTH modes — TopBarSwitch keeps the details bar
  // (shared TopBar, back-less: transparent over the strip, opaque once scrolled) and the
  // reader's transparent ReaderToolbar (also back-less) mounted together and CROSSFADES between
  // them as the mode flips, while the PERSISTENT back chevron sits above both, in one spot,
  // never fading — only its color dissolves with the mode (the X/Reddit morphing-header
  // treatment). Above the band overlay so its taps win. Rendered in one of two spots below:
  // inside the edge-swipe slide for the modal root, outside it (fading, statically stuck) for a
  // drilled layer.
  const topChrome = (
    <TopBarSwitch
          mode={detailsActive ? 'details' : 'reader'}
          persistent={
            <Animated.View
              pointerEvents={detailsActive || chromeVisible ? 'box-none' : 'none'}
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
          }
          bars={{
            details: (
              <Animated.View
                testID="series-page.header-topbar"
                pointerEvents={barSolid ? 'box-none' : 'none'}
                style={[styles.headerBarWrap, headerBarStyle]}>
                {/* left: an empty slot — the persistent chevron above IS the back button. */}
                <TopBar title={headerBarTitle} left={<View />} />
              </Animated.View>
            ),
            reader: (
              // The reader's own fully transparent toolbar (with no back of its own — the
              // persistent chevron above serves both modes); its auto-hide rides `visible`.
              <View pointerEvents="box-none">
                <ReaderToolbar
                  title={seriesTitle}
                  subtitle={target?.chapterName ?? ''}
                  visible={chromeVisible}
                  onBack={goBack}
                  hideBack
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
            ),
          }}
        />
  );

  return (
    // Plain (transparent) root — the route is a contained transparent modal, so a dismissal can
    // fade the layers out over the screen beneath. The details layer supplies the opaque fill.
    <View style={styles.container}>
      <StatusBar
        style={settings.mode === 'paged' || detailsActive ? (scheme === 'dark' ? 'light' : 'dark') : 'light'}
        hidden={settings.mode !== 'paged' && !chromeVisible && !detailsActive}
      />

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
      <Animated.View style={[styles.zoomMask, zoomMaskStyle]} pointerEvents={leaving ? 'none' : 'auto'}>
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
            />
            </BackSwipeGestureContext.Provider>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

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
          style={[styles.readerFrame, { top: 0, width, height }, readerCardStyle]}>
          <View style={styles.readerClip}>
          {error ? (
            <>
              <View style={styles.centerFill}>
                <RetryBlock message={error} onRetry={refetch} />
              </View>
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
              // Stitched native paged mode is keyed by the RUN (plus the explicit-jump nonce), so
              // a boundary crossing's relabel does NOT remount it — only leaving the run (chapter
              // list tap, skip button, cold-window fallback) does. Web/webtoon stay keyed by
              // chapter (their crossings are the remount path).
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
              chaptered={!isDirect}
              hasPrevChapter={!!prevChapter}
              hasNextChapter={!!nextChapter}
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
              standby={detailsSettled}
              inLibrary={inLibrary}
            />
          )}
            {/* The Details pill — the guaranteed collapse path in both modes (webtoon's expanded
                reader owns vertical drags, and no longer reveals by dragging at all). */}
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <DetailsHint visible={chromeVisible && !detailsActive} onPress={() => setRevealed(1)} />
            </View>
          </View>
        </Animated.View>
      </GestureDetector>

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
      {topChrome}

      </Animated.View>

      {/* THE FLYING THUMBNAIL — the other half of the cross-fade, and the reason the motion reads
          as a picture opening rather than a screen resizing. The library transforms the REAL
          source element on the screen underneath to track this path; from inside a modal that view
          is untouchable, so this is a copy of the same cover.
          Laid out at the DESTINATION bound and left to ride the page's transform, which is what
          keeps it honest: at rest that transform puts this rect exactly on the tapped card, and at
          the end exactly on the page's own cover. No second geometry to drift out of sync. The
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
          <Image source={{ uri: zoomThumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        </Animated.View>
      )}

      </Animated.View>
      </Animated.View>
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

export default function SeriesReaderScreen() {
  const params = useLocalSearchParams<SeriesReaderParams>();
  const { width } = useWindowDimensions();
  const [drills, setDrills] = useState<DrillEntry[]>([]);
  const nextKey = useRef(1);
  const drill = useCallback((p: Record<string, string>) => {
    setDrills((d) => [...d, { key: nextKey.current++, kind: 'series', params: p as SeriesReaderParams }]);
  }, []);
  const openSearch = useCallback(() => {
    setDrills((d) => [...d, { key: nextKey.current++, kind: 'search' }]);
  }, []);
  const popLayer = useCallback(() => {
    setDrills((d) => d.slice(0, -1));
  }, []);
  useEffect(() => registerDrillSeries(drill), [drill]);
  useEffect(() => registerOpenSearchLayer(openSearch), [openSearch]);
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
  const pushed = top >= 0 && drills[top].kind === 'search' ? layerParallax : null;
  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.container, pushed]}
        pointerEvents={drills.length === 0 ? 'auto' : 'none'}>
        <MemoSeriesReaderInstance params={params} depth={0} onPopLayer={popLayer} />
      </Animated.View>
      {drills.map((d, i) => (
        <Animated.View
          key={d.key}
          // The top layer is the one moving; it must not also ride the parallax it publishes.
          style={i === top ? StyleSheet.absoluteFill : [StyleSheet.absoluteFill, pushed]}
          pointerEvents={i === top ? 'auto' : 'none'}>
          {d.kind === 'series' ? (
            <MemoSeriesReaderInstance params={d.params} depth={i + 1} onPopLayer={popLayer} />
          ) : (
            <SearchLayer onPopLayer={popLayer} coverSV={layerCover} isTop={i === top} />
          )}
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * The tag/author/type search as a LAYER over the series instances — the same mechanics as a
 * drilled series (slide-in riding edgeX, the edge back-swipe rig, Android hardware back), with
 * the search screen embedded (its back button becomes a spacer) and the shared chevron rendered
 * statically stuck above the slide, fading on edgeX — in the exact spot the series bars beneath
 * keep theirs, so the chevron never moves through the navigation. The search's result cards
 * drill further series layers on top (useDrillRelatedSeries works unchanged inside).
 */
function SearchLayer({
  onPopLayer,
  coverSV,
  isTop,
}: {
  onPopLayer: () => void;
  /** See SeriesReaderInstance's — the parallax this layer drives on the series beneath it. */
  coverSV?: SharedValue<number>;
  isTop?: boolean;
}) {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const edgeX = useSharedValue(width);
  const edgeCommitting = useSharedValue(false);
  // Set the moment the back-swipe activates: the results list stops scrolling for as long as this
  // layer is being dragged out. See the note in the pan's onStart.
  const [swipeLocked, setSwipeLocked] = useState(false);
  useEffect(() => {
    edgeX.set(withSpring(0, IOS_CARD_SPRING));
    // Mount-only entrance — edgeX is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // No swipe-away here (the search has no reader to fling), so coverage is purely the slide.
  useAnimatedReaction(
    () => 1 - Math.min(1, Math.max(0, edgeX.value / width)),
    (cover) => {
      if (isTop && coverSV) coverSV.set(cover);
    },
    [width, isTop, coverSV],
  );
  // Both exits (the chevron/hardware back below, and a committed swipe) run through here, so the
  // button and the gesture leave on the same curve — as they do on a native stack, where the pop
  // animation doesn't know which one asked for it.
  //
  // `edgeCommitting` is the guard, and it is the right one for two jobs at once: it already means
  // "this layer is leaving" and is one-way for the layer's whole life, so checking it here makes a
  // second exit a no-op — the chevron tapped during a committed swipe, say — so exactly one spring
  // exists, hence exactly one pop.
  // `onPopLayer` slices this layer off the stack; a second call would take another layer with it.
  //
  // And the pop fires REGARDLESS of `finished`. A cancelled animation reports finished:false, and
  // a callback that leaves only on true would strand the layer off-screen — mounted, invisible,
  // still in `drills`. That exact shape is what made the series page's release end instantly, in
  // the other direction.
  const slideOut = useCallback(
    (velocity: number) => {
      'worklet';
      trace('search.slideOut', 'commit', { v: velocity, edgeX: edgeX.value, already: edgeCommitting.value });
      if (edgeCommitting.value) return;
      edgeCommitting.set(true);
      edgeX.set(
        withSpring(width, { ...IOS_CARD_SPRING, velocity }, (finished) => {
          trace('search.slideOut', 'done', { finished: !!finished, edgeX: edgeX.value });
          runOnJS(onPopLayer)();
        }),
      );
    },
    [edgeX, edgeCommitting, width, onPopLayer],
  );
  const closeLayer = useCallback(() => {
    runOnUI(slideOut)(0);
  }, [slideOut]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [closeLayer]);
  // The back-swipe. Activation is the shared one (lib/back-swipe) — literally the same code the
  // series instance runs, which is the point: two surfaces that both claim to have a back-swipe
  // must agree on what one is. Everything after it is this layer's own, because here a back-swipe
  // slides a card out rather than collapsing a gallery.
  //
  // One copy per platform, exactly as on the instance: the native one rides the results scroller
  // composed with a Native handler (`Gesture.Simultaneous`, one detector — see there for why the
  // cross-detector relation isn't trusted), the web one sits at screen level. `ranHere` and the
  // one-way `edgeCommitting` come across from there too — the first so a drag that never activated
  // can't settle or unlock anything, the second so nothing can undo a commit and drag the layer
  // back on screen after it has already been sliced off the stack.
  const makeBackSwipePan = useCallback((tag: string) => {
    const updateGate = traceGate();
    const ranHere = makeMutable(false);
    // Where the finger was at ACTIVATION — see the instance's copy for why. RNGH measures
    // translation from touch-down, so without this the card jumps by however far the rule spent
    // deciding, and a late activation leaves the release nothing to animate. Y is tracked only to
    // judge the release: nothing here follows the finger vertically.
    const originX = makeMutable(0);
    const originY = makeMutable(0);
    // The cancel carries the release velocity too — let go while still moving right and the
    // screen eases out of that motion before coming back, rather than reversing on the spot.
    const settle = (velocity: number) => {
      'worklet';
      edgeX.set(withSpring(0, { ...IOS_CARD_SPRING, velocity }));
    };
    return backSwipePan(tag)
      .onStart((e) => {
        'worklet';
        trace(tag, 'START', { tx: e.translationX, ty: e.translationY });
        ranHere.set(true);
        originX.set(e.translationX);
        originY.set(e.translationY);
        // Activation means this gesture owns the screen — the results list must STOP SCROLLING
        // under it. Without this the page kept scrolling vertically while sliding out sideways,
        // which is the single thing that gave the layer away as not-a-real-push: a card being
        // popped is inert, it doesn't keep responding to a finger that has moved on to dismissing
        // it. The series page's own back-swipe has always done this (`swipeLocked`).
        runOnJS(setSwipeLocked)(true);
      })
      .onUpdate((e) => {
        'worklet';
        const tx = e.translationX - originX.value;
        traceThrottled(updateGate, 60, tag, 'update', { tx, edgeX: edgeX.value });
        edgeX.set(Math.max(0, tx));
      })
      .onEnd((e) => {
        'worklet';
        // Where the swipe was HEADED, not where it stopped — see lib/gesture-release.
        // A card pop IS a dismissal, so it takes the same bar — half the travel, which is also
        // what react-navigation uses for this exact transition.
        const tx = e.translationX - originX.value;
        const ty = e.translationY - originY.value;
        trace(tag, 'END', { tx, ty, vx: e.velocityX, edgeX: edgeX.value, committing: edgeCommitting.value, ran: ranHere.value });
        // Same two questions as the instance's release — a card pop is a back-swipe too, and a
        // drag that wandered off-axis is not one however far across it got.
        if (
          backSwipeStayedHorizontal(tx, ty) &&
          releaseCommitted(tx, e.velocityX, width * DISMISS_COMMIT_FRACTION)
        )
          slideOut(e.velocityX);
        else settle(e.velocityX);
      })
      .onFinalize((_e, success) => {
        'worklet';
        trace(tag, 'FINALIZE', { ok: !!success, ran: ranHere.value, committing: edgeCommitting.value, edgeX: edgeX.value });
        // Only the copy that was DRIVING settles, and only a drag that never reached onEnd —
        // see the instance's copy for why this asks `success` rather than the commit latch.
        if (ranHere.value && !success) settle(0);
        // …and only that copy may unlock the list, for the same reason.
        if (ranHere.value) runOnJS(setSwipeLocked)(false);
        ranHere.set(false);
      });
  }, [width, edgeX, edgeCommitting, slideOut]);
  // See the series instance's copy for why the trace flag is a rebuild dep.
  const traceOn = useGestureTraceEnabled();
  // Web only, exactly as on the series instance — this layer had the same two-copy arrangement, an
  // ancestor detector and a descendant one both reaching for the same touch with the same criteria
  // and cancelling each other at the activation frame. The results list carries the native copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edgePan = useMemo(() => makeBackSwipePan('search.edge').enabled(IS_WEB), [makeBackSwipePan, traceOn]);
  const scrollGesture = useMemo(
    () => (IS_WEB ? undefined : Gesture.Simultaneous(Gesture.Native(), makeBackSwipePan('search.list'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [makeBackSwipePan, traceOn],
  );
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: edgeX.value }] }));
  // `isTop` matters for more than looks: it is how the embedded search knows to ignore an intent
  // meant for a layer above it (see the subscription in search.tsx).
  const embedded = useMemo(
    () => ({ onBack: closeLayer, scrollGesture, isTop: !!isTop, scrollEnabled: !swipeLocked }),
    [closeLayer, scrollGesture, isTop, swipeLocked],
  );
  return (
    <View style={styles.container}>
      <GestureDetector gesture={edgePan}>
        <Animated.View style={[styles.searchSlide, { backgroundColor: theme.background }, slideStyle]}>
          <SearchScreen embedded={embedded} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** The details card's content: series.tsx's SeriesBody, fed exactly the way SeriesScreen feeds it
 *  (same detail query + placeholder seeding, same cover-aspect measurement, same layout inputs) —
 *  minus the TopBar/pull-to-refresh, plus the three intent overrides that route back into the
 *  in-place reader. */
function SeriesDetailsHost({
  bridgeId,
  id,
  title,
  bridge,
  cover,
  isDirect,
  width,
  topInset,
  sharedValues,
  onScrollEndDrag,
  onStartReading,
  onOpenChapter,
  onOpenPage,
  scrollGesture,
  scrollEnabled,
  onHeroCoverRect,
  coverAspectSeed,
}: {
  bridgeId?: string;
  id?: string;
  title?: string;
  bridge?: string;
  cover?: string;
  isDirect: boolean;
  width: number;
  /** Overrides the default content top inset (safe area + breathing room) — the screen passes
   *  the full strip height, so the content starts below the reader band. */
  topInset?: number;
  sharedValues: Parameters<typeof SeriesBody>[0]['sharedValues'];
  /** Release of a details-list drag — the screen's iOS reveal pull commits on it. */
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onStartReading: () => void;
  onOpenChapter: (version: Chapter) => void;
  onOpenPage: (pageIndex: number) => void;
  /** The tapped card's aspect, so the hero starts the right shape — see the note on `coverAspect`. */
  coverAspectSeed?: number;
  /** Reports the details page's hero cover rect — the zoom's destination bound (see zoomGeom). */
  onHeroCoverRect?: (rect: ZoomRect) => void;
  /** The instance's `detailsScrollGesture` — mounted on SeriesBody's scroller (see makeBackSwipePan). */
  scrollGesture?: ComposedGesture;
  /** False while a horizontal details gesture is active, so the list can't scroll under it. */
  scrollEnabled?: boolean;
}) {
  const ds = useDataSource();
  const mock = useMockActive();
  const insets = useSafeAreaInsets();
  const {
    data: series = null,
    error: queryError,
    isPlaceholderData,
    isFetching,
    refetch,
  } = useQuery(
    seriesDetailQuery(ds, mock, bridgeId ?? '', id ?? '', {
      direct: isDirect,
      bridgeName: bridge ?? 'Library',
      title,
      cover,
    }),
  );

  // The hero cover's measured aspect. SEEDED from the card this page grew out of rather than from
  // the flat 2:3 placeholder, because this box is the zoom's DESTINATION BOUND and that bound is
  // latched on its first layout — a bridge whose covers aren't 2:3 therefore had a source rect at
  // the real shape aligning to a destination still sitting at the placeholder's, and a single
  // uniform scale cannot map one rectangle onto a differently-proportioned one. The card already
  // knows the answer (its own cover has loaded; that is how you could see it to tap it), so start
  // where it is. `onCoverLoad` still corrects it if the detail cover genuinely differs.
  const [coverAspect, setCoverAspect] = useState(() => coverAspectSeed ?? DEFAULT_THUMB_ASPECT);
  const onCoverLoad = (e: ImageLoadEventData) => {
    const src = e.source;
    if (!src?.width || !src.height) return;
    const ratio = src.width / src.height;
    const next = !Number.isFinite(ratio) || ratio <= 0 ? DEFAULT_THUMB_ASPECT : Math.min(2.5, Math.max(0.5, ratio));
    setCoverAspect((prev) => (Math.abs(next - prev) > 0.02 ? next : prev));
  };

  const isLarge = width >= LARGE_SCREEN_BREAKPOINT;
  const actionsWidth = Math.round(Math.min(width * 0.4, 220));

  if (queryError) {
    return (
      <View style={styles.centerFill}>
        <RetryBlock message={(queryError as Error).message || 'Failed to load series'} onRetry={refetch} />
      </View>
    );
  }
  if (!series) {
    // No forwarded cover (deep link) and the fetch hasn't resolved — brief, so keep it plain.
    return (
      <View style={styles.centerFill}>
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </View>
    );
  }
  return (
    <SeriesBody
      series={series}
      bridgeId={bridgeId}
      isLarge={isLarge}
      // position:sticky is a web full-page affordance — inside the card's own scroller it wouldn't
      // resolve against the viewport anyway.
      sticky={false}
      actionsWidth={actionsWidth}
      direct={isDirect}
      width={width}
      initialCover={cover}
      loading={isPlaceholderData}
      detailStarted={isFetching || !isPlaceholderData}
      coverAspect={coverAspect}
      onCoverLoad={onCoverLoad}
      // The screen's own layout clears the notch (the strip band), so only breathing room is
      // added when no explicit inset comes through.
      topInset={topInset ?? insets.top + Spacing.five}
      onStartReading={onStartReading}
      onOpenChapter={onOpenChapter}
      onOpenPage={onOpenPage}
      sharedValues={sharedValues}
      onScrollEndDrag={onScrollEndDrag}
      scrollGesture={scrollGesture}
      scrollEnabled={scrollEnabled}
      onHeroCoverRect={onHeroCoverRect}
    />
  );
}

type ReaderPaneHandle = { goTo: (index: number, animated?: boolean) => void };

/** The reader itself + its bottom chrome, keyed to ONE RUN (the stitched window — native paged)
 *  or one chapter (web/webtoon/direct), and mounted only once its pages are in — so the start
 *  position seeds `useState`/`useRef` directly at mount (the pagers read `initialPage` exactly
 *  once). Stitched crossings relabel in place through `onRelabel`; explicit jumps swap the whole
 *  pane; the unmount flush records the outgoing chapter's final position. */
const ReaderPane = forwardRef<
  ReaderPaneHandle,
  {
    pages: string[];
    /** The stitched window ([prev?, current, next?]) for the NATIVE PAGED reader — empty for
     *  web/webtoon/direct, which read per-chapter. See the screen's run machinery. */
    segments: Segment[];
    /** A stitched crossing settled on a page of a NEIGHBOURING segment: the screen relabels which
     *  chapter is "current" in place (no remount — the pane is keyed by the run). */
    onRelabel: (chapterId: string, chapterName: string | undefined, page: number) => void;
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
    /** Chrome-hold: suspend auto-hide while a control is in use. */
    onHoldChrome: (hold: boolean) => void;
    onZoomChange: (zoomed: boolean) => void;
    /** A scrub drag started/ended — the screen also freezes its reveal pan for the duration. */
    onScrubActive: (active: boolean) => void;
    /** Rendered between the readers and the bottom chrome — the screen's reveal tint/fade layers
     *  go here, so they dim the PAGES without washing out the navigator/pill. */
    overlay?: ReactNode;
    /** True while the reader is parked as a decorative background (the collapsed strip):
     *  suspends the warm-ahead prefetch and shrinks the pager's render window to the visible
     *  page, so only the single page on screen is requested. */
    standby?: boolean;
    /** Library membership (undefined while still resolving) — picks the progress-recording path.
     *  Queried by the screen, not here: this pane re-renders every page sweep. */
    inLibrary?: boolean;
  }
>(function ReaderPane(
  {
    pages,
    segments,
    onRelabel,
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
    overlay,
    standby,
    inLibrary,
  },
  ref,
) {
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

  // ── Stitched flat pager (native paged, chaptered) ──────────────────────────
  // Declared early (a noop until the record section below fills it) so the flat handlers can
  // flush the outgoing chapter's progress at a crossing.
  const recordRef = useRef<() => void>(() => {});
  const stitched = !IS_WEB && settings.mode === 'paged' && segments.length > 0;
  const flatItems: ReaderPageItem[] = useMemo(
    () => segments.flatMap((s) => s.pages.map((uri, i) => ({ uri, key: `${s.id}:${i}`, pageNumber: i + 1 }))),
    [segments],
  );
  // Flat index of the current chapter's page 0 (how many stitched pages precede it).
  const prefixLen = useMemo(() => {
    const currentId = chapterId ?? DIRECT_CHAPTER_ID;
    let acc = 0;
    for (const s of segments) {
      if (s.id === currentId) break;
      acc += s.pages.length;
    }
    return acc;
  }, [segments, chapterId]);
  // Which stitched segment a flat pager index falls in, and the page within it.
  const locateFlat = useCallback(
    (flat: number) => {
      let acc = 0;
      for (const s of segments) {
        if (flat < acc + s.pages.length) return { segment: s, page: flat - acc };
        acc += s.pages.length;
      }
      return null;
    },
    [segments],
  );
  // The page merely *scrolling past* (viewability), carried with its own segment so the counter
  // reads against the right chapter mid-crossing — display only, nothing writes off it.
  const [visibleSeg, setVisibleSeg] = useState<{ id: string; page: number; total: number } | null>(null);
  // The settled page. Same chapter: plain bookkeeping. A NEIGHBOURING segment: flush the old
  // chapter's progress, then relabel in place — the swipe that carried the user across stays
  // seamless (no remount; the pane is keyed by the run).
  const handleFlatPageChange = useCallback(
    (flat: number) => {
      const loc = locateFlat(flat);
      if (!loc) return;
      if (loc.segment.id === (chapterId ?? DIRECT_CHAPTER_ID)) {
        setCurrent(loc.page);
        return;
      }
      recordRef.current(); // the outgoing chapter's final settled position
      setCurrent(loc.page);
      onRelabel(loc.segment.id, loc.segment.name, loc.page);
    },
    [locateFlat, chapterId, setCurrent, onRelabel],
  );
  const handleFlatVisiblePage = useCallback(
    (flat: number) => {
      const loc = locateFlat(flat);
      if (!loc) return;
      setVisibleSeg({ id: loc.segment.id, page: loc.page, total: loc.segment.pages.length });
      if (loc.segment.id === (chapterId ?? DIRECT_CHAPTER_ID)) setCurrent(loc.page);
    },
    [locateFlat, chapterId, setCurrent],
  );
  // What the bottom chrome shows: the committed page, or — while a swipe carries a neighbouring
  // segment's page across the screen — that page against ITS chapter's length.
  const shown = useMemo(() => {
    const v = stitched && visibleSeg && segments.some((s) => s.id === visibleSeg.id) ? visibleSeg : null;
    return { page: v?.page ?? currentPage, total: v?.total ?? pages.length };
  }, [stitched, visibleSeg, segments, currentPage, pages]);

  // Chapter-local page index in; the stitched pager takes the flat index.
  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      setCurrent(clamped);
      if (settings.mode === 'paged') pagedRef.current?.goToPage(stitched ? prefixLen + clamped : clamped, animated);
      else webtoonRef.current?.goToPage(clamped);
    },
    [pages, settings.mode, setCurrent, stitched, prefixLen],
  );
  // The details card's page-thumbnail taps jump the mounted pane directly (see openPageFromDetails).
  useImperativeHandle(ref, () => ({ goTo }), [goTo]);
  // Where a scrub release lands: name the landing page immediately (viewability is suppressed
  // during the drag), so the chrome is correct in the same commit.
  const seekTo = useCallback(
    (index: number) => {
      goTo(index, true);
      if (stitched) handleFlatVisiblePage(prefixLen + index);
    },
    [goTo, stitched, prefixLen, handleFlatVisiblePage],
  );
  // Boundary page-turns: prefer stepping within the stitched flat list (the same seamless relabel
  // path a swipe crossing takes); the explicit-jump fallback only covers a cold window (adjacent
  // pages not loaded yet) — or web/webtoon, whose readers aren't stitched.
  const turnPrev = useCallback(() => {
    if (currentRef.current > 0) {
      goTo(currentRef.current - 1, false);
      return;
    }
    if (stitched && prefixLen > 0) {
      handleFlatPageChange(prefixLen - 1);
      pagedRef.current?.goToPage(prefixLen - 1, false);
      return;
    }
    if (chaptered && hasPrevChapter) onCrossChapter(-1);
  }, [goTo, stitched, prefixLen, handleFlatPageChange, chaptered, hasPrevChapter, onCrossChapter]);
  const turnNext = useCallback(() => {
    if (currentRef.current < pages.length - 1) {
      goTo(currentRef.current + 1, false);
      return;
    }
    const nextFlat = prefixLen + pages.length;
    if (stitched && nextFlat < flatItems.length) {
      handleFlatPageChange(nextFlat);
      pagedRef.current?.goToPage(nextFlat, false);
      return;
    }
    if (chaptered && hasNextChapter) onCrossChapter(1);
  }, [goTo, stitched, prefixLen, pages, flatItems.length, handleFlatPageChange, chaptered, hasNextChapter, onCrossChapter]);
  const atLastPage = useCallback(() => currentRef.current >= pages.length - 1, [pages]);

  // ── Scrubber (UI-thread throughout; offset 0 — nothing stitched) ───────────
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
      if (settings.mode === 'paged') pagedRef.current?.scrubTo(stitched ? prefixLen + clamped : clamped);
      else webtoonRef.current?.goToPage(Math.round(clamped), false);
    },
    [pages, settings.mode, stitched, prefixLen],
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
    // Standby (the collapsed strip) loads nothing beyond the visible page; the flip back to
    // active re-runs this and warms the neighbourhood immediately.
    if (!standby && pages.length) warmAround(currentPage);
  }, [standby, pages, currentPage, warmAround]);

  // ── Progress recording: a library series (inLibrary, queried by the screen) records chapter
  // progress; anything else (including a direct series) goes to the reading log under the
  // DIRECT_CHAPTER_ID sentinel. ──
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
  // recordRef itself is declared up with the stitched mappings (the flat crossing flushes through
  // it); this keeps it pointing at the latest closure.
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  // Debounced on page settle + flushed on unmount (leaving the screen AND chapter swaps — the pane
  // is keyed by chapter).
  useEffect(() => {
    const t = setTimeout(() => recordRef.current(), 1500);
    return () => clearTimeout(t);
  }, [currentPage]);
  useEffect(() => () => recordRef.current(), []);

  // ── Web keyboard nav (single-step; no held-key repeat) ─────────────────────
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
      {/* The page subtree. */}
      <Animated.View testID="series-page.page-wrap" style={styles.pageWrap}>
      {settings.mode === 'paged' ? (
        <PagedReader
          ref={pagedRef}
          // Stitched: the whole window as ONE flat pager, so a boundary swipe is an ordinary page
          // turn (position reports come back flat and get located/relabeled above). Web keeps
          // per-chapter pages (its pager hands boundary turns to onPrev/onNext itself).
          pages={stitched ? flatItems : items}
          width={width}
          height={height}
          rtl={settings.direction === 'rtl'}
          pageFit={settings.pageFit}
          initialPage={stitched ? prefixLen + startIndex : startIndex}
          onPageChange={stitched ? handleFlatPageChange : setCurrent}
          // Keep the counter live during fast flicks — against the segment the page belongs to
          // when stitched (a crossing must count against the chapter being entered).
          onVisiblePageChange={IS_WEB ? undefined : stitched ? handleFlatVisiblePage : setCurrent}
          scrubTarget={scrubFlat}
          scrubbing={scrubbing}
          standby={standby}
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
          standby={standby}
          // The continuous strip advances via its end sentinel, the fit-page variant via the
          // end-reached + last-page check.
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
      </Animated.View>

      {/* Tint/fade layers over the pages, under the chrome below. */}
      {overlay}

      {/* Bottom chrome — sits still while the page travels. */}
      <Animated.View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
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
          // `shown`, not the committed page: mid-crossing the counter reads the entering
          // chapter's page/length, turning over WITH the swipe.
          page={shown.page}
          total={shown.total}
          rtl={settings.mode === 'paged' && settings.direction === 'rtl'}
          visible={chromeVisible}
          chaptered={chaptered}
          hasPrevChapter={hasPrevChapter}
          hasNextChapter={hasNextChapter}
          onPrevChapter={() => onSkipChapter(-1)}
          onNextChapter={() => onSkipChapter(1)}
          onScrub={scrubTo}
          scrubTarget={settings.mode === 'paged' ? scrubFlat : undefined}
          offset={stitched ? prefixLen : 0}
          onSeek={seekTo}
          onScrubbingChange={handleScrubbing}
          onScrubPage={warmAround}
        />
      )}
      </Animated.View>
    </>
  );
});

/** The chrome's "Details" pill — the guaranteed, non-gesture way into the details card. Sits above
 *  the bottom chrome and fades with it. Needed because the cross-axis swipe can't always win:
 *  the web pager owns its whole touch surface, and an overflowing fit-width page's content-pan
 *  (rightly) takes vertical drags in paged mode. */
function DetailsHint({
  visible,
  onPress,
}: {
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
      style={[styles.detailsHintWrap, { bottom: insets.bottom + Spacing.two + 48 }, style]}>
      <Pressable
        testID="series-page.details"
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Show series details"
        style={styles.detailsHintPill}>
        {/* The chevron points where the READER goes — up and away, in both modes now. Webtoon
            pointed RIGHT back when its reveal was horizontal; the reveal is vertical everywhere
            since the drag-reveal was removed there, so the arrow was the last thing still
            describing the old motion. */}
        <ChevronUpIcon color="#fff" size={16} />
        <ThemedText type="small" style={styles.detailsHintLabel}>
          Details
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

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
  // The SEARCH layer's slide-in ride — the one layer that still arrives as a push (see SearchLayer).
  searchSlide: {
    flex: 1,
    // The pushed-card shadow, and the opaque fill it needs — see lib/ios-card-pop.
    ...IOS_CARD_SHADOW,
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
  pageWrap: {
    flex: 1,
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
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  // The two halves of the exiting card's shadow (see the render). Both hang off the OPAQUE
  // fill's right edge — `left: '100%'` inside headerSheetBg, which clips nothing (the seam
  // gradient already hangs above it the same way).
  detailsHintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  detailsHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  detailsHintLabel: {
    color: '#fff',
  },
});
