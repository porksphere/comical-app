import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
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
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
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
import { LinearGradient } from 'expo-linear-gradient';

import { ChevronRightIcon, ChevronUpIcon } from '@/components/icons/ui-icons';
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
import { LARGE_SCREEN_BREAKPOINT, useTopBarHeight } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';

import { registerDrillSeries, registerOpenSearchLayer } from '@/lib/experimental-flags';
import SearchScreen from '../search';
import { SeriesBody, truncateTopBarTitle } from '../series';

// EXPERIMENTAL series reader page (Settings → General → Experimental). A series opened from a card
// lands HERE instead of on `/series`: one screen holding BOTH the series details and the reader
// (same paged/webtoon readers, chrome, scrubber, and progress recording as `/reader`).
//
// It opens ON THE DETAILS, with the reader as a faded strip forming the TOP OF THE PAGE — not
// fixed chrome: the strip scrolls away under the content like any page header, through a tall
// gradient seam centered on the series title. Pulling the page down past its top gradually
// reveals the reader (the iOS rubber-band moves content and seam 1:1 with the finger while the
// reader fades in above; a deep release commits, and Android/web get the same follow via a
// manual pan); a strip tap expands too. Expanding slides the details DOWN out of visibility; in
// the expanded reader, drag up (paged) / right (webtoon) or the Details pill brings them back,
// and drag down / left is SwipeDismiss verbatim (mode-locked per gesture — see the pan build)
// popping back to browse. One TopBarSwitch slot crossfades the top chrome between the modes.
//
// The details render series.tsx's OWN `SeriesBody` — cover hero, action column, tag/meta/
// description, the real chapter list (downloads, versions, read state), page-thumb grid, related
// rails — so the two screens cannot drift. Three override props route its intents back into this
// screen instead of pushing routes: `onStartReading` (Read button → expand the in-place reader),
// `onOpenChapter` (chapter row → swap the reader pane's chapter and expand), `onOpenPage`
// (direct-series thumbnail → jump the pane to that page and expand).
//
// Chaptered series: the screen resolves resume-or-first-chapter itself (same history lookup as
// useStartReading). The NATIVE PAGED reader stitches adjacent chapters into one flat pager
// (reader.tsx's window, ported — see the `run` machinery), so swiping across a boundary is an
// ordinary page turn with an in-place relabel. Explicit jumps (chapter rows, skip buttons) and
// web/webtoon crossings remount the pane seeded at the landing page instead. While the details
// are up the reader is in STANDBY — only the single visible strip page is requested.
//
// Removal list for the whole experiment: this `app/series-reader/` DIRECTORY (this file, the
// nested-stack `_layout.tsx`, and the series-downloads/downloads twin routes) +
// `lib/experimental-flags.ts` (the flag, `useSeriesSubPath` — unwrap its call sites in
// `series.tsx`, `series/download-button.tsx`, `reader/settings-panel.tsx`, `downloads.tsx` back
// to the plain paths — `InSeriesReaderStack`/`useDrillRelatedSeries` with the drill branch in
// `series-card.tsx`, and `useOpenSearchLayer` with its branch in `series.tsx` + the `embedded`
// prop on `search.tsx`), the Settings row in `settings-general.tsx`, the `buildHref` target switch
// in `series-card.tsx`, this route's Stack.Screen entry in `_layout.tsx`, the default-preserving
// embedding props on `series.tsx`'s SeriesBody (`topInset`/`onStartReading`/`onOpenChapter`/
// `onOpenPage` + `truncateTopBarTitle` export) and `chapters-section.tsx`'s
// `onOpenChapter`/`onOpenPage`, the `standby` prop on the paged readers, and
// `components/top-bar-switch.tsx` if nothing else has adopted it yet.

const CHROME_HIDE_MS = 3000;
// Same CI-speed override as reader.tsx: Maestro steps can outlast the auto-hide, and hidden chrome
// drops out of the accessibility tree.
const CHROME_AUTO_HIDE = process.env.EXPO_PUBLIC_COMICAL_DEMO_FAST !== '1';
const WARM_BEHIND = 2;
const IS_WEB = Platform.OS === 'web';
const IS_IOS = Platform.OS === 'ios';
// The reader surface's tone — matches reader.tsx's backdrop (`#reader-view`'s #0f0f0f, not pure black).
const READER_BACKDROP = '#0f0f0f';
// Reveal hysteresis: the drag must cover this fraction of the axis (or flick past FLICK_VELOCITY)
// to commit to the other view; anything less springs back to the active one.
const COMMIT_FRACTION = 0.25;
const FLICK_VELOCITY = 900;
// The reveal pull: how far past the details list's top the rubber-band must be pulled, at
// release, to expand the reader. Roughly usePullToRefresh's trigger feel.
const PULL_COMMIT_PX = 80;
// How far from the LEFT edge a touch may start and still count as the back-swipe (the native
// stack pop gesture, recreated — a transparent modal doesn't get the real one).
// The dismissal is the old reader's SwipeDismiss, verbatim: the page follows the finger in BOTH
// axes, shrinks with distance, and the dark backdrop fades in place over a full span while the
// page stays solid; release past DISMISS_FRACTION/flick flings it out along its own direction.
const EXIT_MS = 180;
const MIN_SCALE = 0.45;
const SCALE_SPAN_FRACTION = 0.7;
const SPRING_BACK = { duration: 300, dampingRatio: 1 } as const;
// The visible height of the collapsed reader strip (below the safe area) — a faded-out
// background-image band forming the TOP OF THE DETAILS PAGE (it scrolls away under the content
// like any page header, it is not fixed chrome).
const HEADER_BAND = 200;
// The strip-to-details seam gradient's height. It's tall on purpose: the transition is CENTERED
// ON THE SERIES TITLE — the title (the page's first element) renders mid-gradient over the fading
// strip, X-hero style, so the content top inset is derived from this (see headerTopInset).
const SHEET_FADE_H = 120;
// Half the title's ~40pt first line — positions the title's CENTER at the gradient's center.
const TITLE_MID = 20;
// The details-content fade (and the reader's matching tint) complete within this fraction of the
// travel — weighted toward the START of a reveal and, symmetrically, the END of a hide.
const FADE_WINDOW = 0.4;

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

/** One chapter's worth of pages inside the native pager's stitched flat list (reader.tsx's
 *  Segment — the same stitching, ported so a boundary swipe here is the same ordinary page turn
 *  it is on /reader instead of a bounce-and-remount). */
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
 * `depth` 0 is the modal root (leaving = popping the route); a deeper instance slides in over
 * its parent riding the SAME edgeX shared value the edge back-swipe drags, and leaves via
 * `onPopLayer` once it has animated (or flown) out.
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

  const { id, title, bridge: bridgeParam, bridgeId, cover: coverParam, direct } = params;
  const bridge = bridgeParam ? decodeURIComponent(bridgeParam) : undefined;
  const cover = coverParam ? decodeURIComponent(coverParam) : undefined;
  const isDirect = direct === '1';

  // Opening a different series clears the remembered scanlation group (same as series.tsx).
  useEffect(() => {
    resetPreferredGroup();
  }, [id]);

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
    ...(targetChapterId
      ? chapterPagesQuery(ds, mock, bridgeId ?? '', id ?? '', targetChapterId)
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

  // ── Stitching (native paged mode): reader.tsx's window, ported ───────────
  // Adjacent chapters' page lists, subscribed eagerly (cache-first; a list is just URLs) so the
  // native paged reader can stitch them into ONE flat pager — swiping across a chapter boundary
  // is then an ordinary page turn with an in-place relabel, no remount.
  const stitched = !IS_WEB && settings.mode === 'paged' && !isDirect;
  // The committed side of the reveal (declared up here — the stitching queries below gate on
  // it). The screen opens ON the details; see the reveal section further down.
  const [detailsActive, setDetailsActive] = useState(true);
  // `detailsActive`, but lagging past the 240ms reveal/collapse animation: the HEAVY mode flips
  // (the standby render window, the adjacent-chapter fetches) key off THIS, so page cells mount
  // and lists re-window after the transition has finished instead of chopping it mid-flight.
  const [detailsSettled, setDetailsSettled] = useState(true);
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

  // The stitched window — reader.tsx's run, verbatim in behavior: a segment only joins once its
  // pages are loaded (no holes); it only ever GROWS during one continuous run (appending at the
  // tail keeps the pager's offset valid; see reader.tsx for the head-drop black-flash history);
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
  // for everything JS-side (gesture enabling, back handling, status bar). The screen opens ON
  // the details (reader collapsed to the strip).
  const progress = useSharedValue(1);
  // The details page's internal scroll offset (SeriesBody's list writes it on the UI thread via
  // the same `sharedValues` wiring pull-to-refresh uses) — drives the strip occlusion, the top
  // bar's scroll crossfade, and the pull-past-top reveal.
  const detailsScrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset: detailsScrollOffset }), [detailsScrollOffset]);
  // UI-thread mirror of `detailsActive`, for the worklets below (the iOS pull-follow must stop the
  // instant a commit animation takes over `progress`).
  const detailsActiveSV = useSharedValue(true);
  // Dismissal offsets — the old reader's swipe-away: the page follows the finger in BOTH axes
  // while the surface fades, and a commit flings it out along its own direction. `dismissing`
  // freezes the gesture once the exit animation owns the offsets.
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);
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
  useAnimatedReaction(
    () => detailsScrollOffset.value,
    (off, prevOff) => {
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
    [headerSpan, detailsScrollOffset, detailsActiveSV, pullEngagedSV, pullStartSV, progress],
  );
  const onDetailsScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
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
  // LAYER never touches navigation: it animates out on the same edgeX the edge swipe drags
  // (closeLayer — chevron/hardware back), or is removed outright once a gesture has already
  // carried it offscreen / flown the page out (leaveNow — the parent series is live beneath).
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  const leaveNow = useCallback(() => {
    if (depth > 0) onPopLayer();
    else goBack();
  }, [depth, onPopLayer, goBack]);

  // Collapse/dismiss pan — wraps the expanded reader, on the cross axis of its scroll: the
  // collapse direction (up in paged, right in webtoon) slides the details back in; the opposite
  // direction IS the old reader's SwipeDismiss — free 2D finger-follow, distance shrink, surface
  // fade, fling exit, spring-back cancel — popping back to the screen this one was opened over
  // (the route is a contained transparent modal). Built inside useMemo like chapter-navigator's
  // pan (the React Compiler lint can't tell worklets from render code).
  const collapseEnabled = !detailsActive && !readerZoomed && !scrubbing;
  // Each GESTURE is one thing, decided at activation and locked: a drag that sets off toward the
  // details is a reveal (progress only); anything else is a SwipeDismiss gesture VERBATIM — free
  // 2D follow in BOTH directions (swiping back past the origin carries the page out the other
  // side, exactly like the old reader), released on SwipeDismiss's own |cross| decision. A new
  // gesture that begins while the page hasn't fully settled from a previous dismiss drag is
  // always a dismiss gesture — only a settled page reveals the details on a swipe.
  const gestureMode = useSharedValue<0 | 1 | 2>(0); // 0 undecided, 1 reveal, 2 dismiss
  // Where `progress` stood when the gesture locked — drags map RELATIVE to it, so a gesture that
  // begins mid-animation continues the motion from where it is instead of snapping to the drag's
  // absolute position (the "fast-forward" chop under quick successive swipes).
  const progressStartSV = useSharedValue(0);
  const panBeganSV = useSharedValue(false);
  const collapsePan = useMemo(() => {
    const dismissSpan = settings.mode === 'paged' ? height : width;
    const span = settings.mode === 'paged' ? headerSpan : width;
    {
      const pan = Gesture.Pan()
        .enabled(collapseEnabled)
        .onUpdate((e) => {
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
            const settled = Math.hypot(dismissX.value, dismissY.value) <= 1;
            if (!settled) gestureMode.set(2);
            else if (Math.abs(cross) >= 2) {
              gestureMode.set(cross <= 0 ? 1 : 2);
              progressStartSV.set(progress.value);
            } else return; // no meaningful movement yet
          }
          if (gestureMode.value === 1) {
            progress.set(Math.min(1, Math.max(0, progressStartSV.value + -cross / span)));
            return;
          }
          // SwipeDismiss's follow, verbatim: both axes, unclamped.
          dismissX.set(e.translationX);
          dismissY.set(e.translationY);
        })
        .onEnd((e) => {
          if (dismissing.value || detailsActiveSV.value) return;
          if (gestureMode.value === 1) {
            const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
            const crossVelocity = settings.mode === 'paged' ? e.velocityY : -e.velocityX;
            const open = -cross / span > COMMIT_FRACTION || crossVelocity < -FLICK_VELOCITY;
            detailsActiveSV.set(open);
            progress.set(withTiming(open ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
            runOnJS(commitReveal)(open ? 1 : 0);
            return;
          }
          // SwipeDismiss's release decision, verbatim: the cross-axis OFFSET (either direction)
          // past a quarter of the screen, or a fast flick, dismisses; anything less springs back.
          const crossOffset = settings.mode === 'paged' ? dismissY.value : dismissX.value;
          const crossVelocityRaw = settings.mode === 'paged' ? e.velocityY : e.velocityX;
          const byFlick = Math.abs(crossVelocityRaw) > FLICK_VELOCITY;
          if (!byFlick && Math.abs(crossOffset) < dismissSpan * COMMIT_FRACTION) {
            dismissX.set(withSpring(0, SPRING_BACK));
            dismissY.set(withSpring(0, SPRING_BACK));
            return;
          }
          // Fling out along the gesture's own direction (velocity for a flick, accumulated travel
          // otherwise) across a full screen diagonal — SwipeDismiss's exit, verbatim.
          dismissing.set(true);
          let dirX = byFlick ? e.velocityX : dismissX.value;
          let dirY = byFlick ? e.velocityY : dismissY.value;
          const len = Math.hypot(dirX, dirY) || 1;
          dirX /= len;
          dirY /= len;
          const exit = Math.hypot(width, height);
          dismissX.set(withTiming(dismissX.value + dirX * exit, { duration: EXIT_MS }));
          dismissY.set(
            withTiming(dismissY.value + dirY * exit, { duration: EXIT_MS }, (finished) => {
              if (finished) runOnJS(leaveNow)();
            }),
          );
        })
        // Always fires once the gesture resolves (release OR cancel) — the next gesture decides
        // its own mode fresh.
        .onFinalize(() => {
          gestureMode.set(0);
        });
      if (settings.mode === 'paged') pan.activeOffsetY([-20, 20]).failOffsetX([-15, 15]);
      else pan.activeOffsetX([-20, 20]).failOffsetY([-15, 15]);
      return pan;
    }
  }, [settings.mode, collapseEnabled, width, height, headerSpan, gestureMode, progressStartSV, progress, dismissX, dismissY, dismissing, detailsActiveSV, commitReveal, leaveNow]);

  // Band pan. The strip (the reader band at the top of the details page) expands the reader the
  // same way the page's own overscroll does: a tap, or a DOWNWARD drag that slides the whole
  // details page down under the finger. (The expanded reader's gestures are collapsePan above.)
  const bandPan = useMemo(() => {
    return Gesture.Pan()
      .enabled(detailsActive)
      .activeOffsetY([-20, 20])
      .failOffsetX([-15, 15])
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
        const open = e.translationY / headerSpan > COMMIT_FRACTION || e.velocityY > FLICK_VELOCITY;
        detailsActiveSV.set(!open);
        progress.set(withTiming(open ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(open ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
  }, [detailsActive, headerSpan, panBeganSV, progressStartSV, progress, detailsActiveSV, commitReveal]);

  // Reveal pan — on the details layer, for platforms without the native rubber-band (the iOS
  // path is the reaction above). The details page always reveals the reader by moving DOWN,
  // whatever the reader's own scroll mode; it shares the vertical axis with the details' own
  // scroller, so it activates MANUALLY: only a clearly-downward drag with the content at its top
  // pulls the page down; everything else fails fast and the list scrolls.
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const returnPan = useMemo(() => {
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
        const close = e.translationY / headerSpan > COMMIT_FRACTION || e.velocityY > FLICK_VELOCITY;
        detailsActiveSV.set(!close);
        progress.set(withTiming(close ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(close ? 0 : 1);
      })
      .onFinalize(() => {
        panBeganSV.set(false);
      });
  }, [detailsActive, headerSpan, panBeganSV, progressStartSV, progress, touchStartX, touchStartY, detailsScrollOffset, detailsActiveSV, commitReveal]);

  // Back-swipe (details mode): the native stack's pop gesture, recreated — the route is a
  // contained transparent modal (needed for the reader's dismissal reveal), which doesn't get
  // the real one. A decisive rightward drag ANYWHERE on the details (full-surface, like the
  // platform's full-screen pop — see the criteria on the pan) slides the WHOLE instance off
  // under the finger — over the browse grid (modal root) or the LIVE parent series (a drilled
  // layer, a plain sibling view) — and pops on a deep release or flick. Raced with the reveal
  // pan on the same layer. `edgeX` doubles as the drilled layer's slide-in/out position: it
  // mounts at `width` and animates home (below).
  const edgeX = useSharedValue(depth > 0 ? width : 0);
  const edgeCommitting = useSharedValue(false);
  useEffect(() => {
    if (depth === 0) return;
    edgeX.set(withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
    // Mount-only entrance — edgeX is stable; the drilled instance never changes depth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The chevron / hardware-back exit for a drilled layer: slide back out, then remove.
  const closeLayer = useCallback(() => {
    edgeCommitting.set(true);
    edgeX.set(
      withTiming(width, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onPopLayer)();
      }),
    );
  }, [edgeX, edgeCommitting, width, onPopLayer]);

  // Android hardware back steps back HOME (the details) before popping: reader expanded → back
  // collapses it; a drilled layer with its details up slides back out to its parent series.
  // Layer handlers register after their parent's (mounted later), so BackHandler's LIFO order
  // naturally gives the topmost instance the event. (Android-only API — react-native-web's
  // BackHandler stub rejects addEventListener.)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (detailsActive && depth === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!detailsActive) setRevealed(1);
      else closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [detailsActive, depth, setRevealed, closeLayer]);
  // Why the back-swipe was DEAD on device while green on web: the details list is a native scroll
  // view, and a UIScrollView's own pan recognizer begins on ~10px of movement in ANY direction —
  // before this pan's 20px horizontal activation — at which point UIKit force-fails every
  // recognizer not allowed to run simultaneously. RNGH's delegate only grants that simultaneity
  // when the scroll view's raw pan resolves to a NativeViewGestureHandler it knows (see
  // RNGestureHandler.mm findGestureHandlerByRecognizer), so one is mounted ON the scroller
  // (threaded down to whichever list owns the scroll — PullListWiring.scrollGesture) and this pan
  // recognizes simultaneously with it. The scroll view has nothing to scroll horizontally, so
  // during a committed back-swipe it just idles while the pan drives the slide; vertical scrolls
  // still win outright through failOffsetY. Web needs none of this (no native recognizers).
  const detailsScrollGesture = useMemo(() => (IS_WEB ? undefined : Gesture.Native()), []);
  const edgePan = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(detailsActive)
      // NATIVE activation criteria, no manual touch choreography: activeOffset/failOffset decide
      // activation inside RNGH's native core. (The previous manual-activation version drove
      // activation from onTouchesDown/Move worklet callbacks — a touch-event stream iOS
      // recognizer interplay can delay or cancel, which is how the edge swipe silently died on
      // device while staying green on web.)
      //
      // FULL-SURFACE, not edge-only: a decisive rightward drag anywhere on the details goes
      // back, the way the platform's full-screen pop does. Anything horizontal underneath keeps
      // winning on its own turf — RNGH swipeables (chapter-row actions) activate on tighter
      // offsets and cancel this pan, and a horizontal scroller (related rails) that starts
      // scrolling cancels the touch stream outright — while the vertical list never claims a
      // horizontal drag. failOffsetY keeps vertical scrolling winning fast.
      .activeOffsetX(20)
      .failOffsetX(-12)
      .failOffsetY([-14, 14])
      .onUpdate((e) => {
        if (!detailsActiveSV.value) return;
        edgeX.set(Math.max(0, e.translationX));
      })
      .onEnd((e) => {
        if (!detailsActiveSV.value) return;
        if (edgeX.value > width * 0.3 || e.velocityX > FLICK_VELOCITY) {
          edgeCommitting.set(true);
          edgeX.set(
            withTiming(width, { duration: EXIT_MS }, (finished) => {
              if (finished) runOnJS(leaveNow)();
            }),
          );
        } else {
          edgeX.set(withSpring(0, SPRING_BACK));
        }
      })
      .onFinalize(() => {
        // A cancelled drag never reaches onEnd — don't leave the screen part-slid.
        if (!edgeCommitting.value) edgeX.set(withSpring(0, SPRING_BACK));
        edgeCommitting.set(false);
      });
    if (detailsScrollGesture) pan.simultaneousWithExternalGesture(detailsScrollGesture);
    return pan;
  }, [detailsActive, width, edgeX, edgeCommitting, detailsActiveSV, leaveNow, detailsScrollGesture]);
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
    () => Gesture.Race(edgePan, returnPan, pullReleaseWatch),
    [edgePan, returnPan, pullReleaseWatch],
  );
  // The whole screen rides the edge swipe (details, strip, bars alike) — the classic pop look.
  const screenSlideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: edgeX.value }] }));

  // Geometry: the reader strip's height — the top-of-page band the details content starts below.
  // The details layer itself is full-screen (the strip is page, not chrome).
  const bandH = insets.top + HEADER_BAND;
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
  // The dismissal curves' travel span (the reader's cross axis) — used by the page/backdrop/
  // chrome styles further down.
  const span = settings.mode === 'paged' ? height : width;
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
    const dismissFade = interpolate(
      Math.min(1, Math.hypot(dismissX.value, dismissY.value) / span),
      [0, 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    );
    // Details side is always-on; reader side follows the chrome. max() keeps it solid through
    // the transition instead of dipping.
    const detailsSide = interpolate(progress.value, [0.4, 0.8], [0, 1], Extrapolation.CLAMP);
    return { opacity: Math.max(detailsSide, chromeVisibleSV.value) * dismissFade };
  }, [span]);
  const backThemeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [0, 1], Extrapolation.CLAMP),
  }));
  const backWhiteIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.3, 0.7], [1, 0], Extrapolation.CLAMP),
  }));

  // The reader FRAME travels only for the strip centering: while collapsed it rises by half its
  // hidden height so the strip window shows the page's vertical CENTER (not its top edge),
  // sliding back to natural position as it expands. A dismissal does NOT move it: exactly like
  // SwipeDismiss, only the PAGE subtree travels (pageDismissStyle below) while the reader's dark
  // surface fades IN PLACE (dismissFadeStyle on the surface layer) — the page pulls away over
  // the screen behind, it doesn't drag a black rectangle along.
  const readerCardStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: (-(height - bandH) / 2) * progress.value }] }),
    [height, bandH],
  );
  // SwipeDismiss's page transform, verbatim: 2D finger follow, then scale (after the translate,
  // so the page shrinks toward its own moved centre) with distance, staying fully opaque.
  const pageDismissStyle = useAnimatedStyle(() => {
    const dist = Math.hypot(dismissX.value, dismissY.value);
    return {
      transform: [
        { translateX: dismissX.value },
        { translateY: dismissY.value },
        { scale: interpolate(dist, [0, span * SCALE_SPAN_FRACTION], [1, MIN_SCALE], Extrapolation.CLAMP) },
      ],
    };
  }, [span]);
  // reader.tsx's chromeFadeStyle curve: the toolbar/navigator/pills fade with dismissal progress
  // instead of traveling with the page.
  const chromeDismissStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      Math.min(1, Math.hypot(dismissX.value, dismissY.value) / span),
      [0, 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }), [span]);
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
  // SwipeDismiss's static backdrop: the reader's dark surface fading in place with distance
  // while the page travels over it — the end state hands cleanly back to the screen beneath.
  const dismissFadeStyle = useAnimatedStyle(() => {
    const dist = Math.hypot(dismissX.value, dismissY.value);
    return { opacity: interpolate(dist, [0, span], [1, 0], Extrapolation.CLAMP) };
  }, [span]);

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
                testID="series-reader.header-back"
                // A drilled layer's chevron slides it back out to the parent series; the modal
                // root's pops the route.
                onPress={depth > 0 ? closeLayer : goBack}
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
                testID="series-reader.header-topbar"
                pointerEvents={barSolid ? 'box-none' : 'none'}
                style={[styles.headerBarWrap, headerBarStyle]}>
                {/* left: an empty slot — the persistent chevron above IS the back button. */}
                <TopBar title={headerBarTitle} left={<View />} />
              </Animated.View>
            ),
            reader: (
              // The reader's own fully transparent toolbar, as /reader has it (minus its back —
              // the persistent chevron above serves both modes) — its auto-hide rides `visible`,
              // and a dismissal fades it on the old reader's curve.
              <Animated.View pointerEvents="box-none" style={chromeDismissStyle}>
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
              </Animated.View>
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

      {/* Everything rides the edge back-swipe together — the classic pop look over the browse
          grid showing through the transparent root. */}
      <Animated.View style={[styles.screenSlide, screenSlideStyle]}>

      {/* The details PAGE, in front of the (static) reader: a full-screen layer whose opaque
          background starts at the band, so the strip is the top of the page; the whole layer
          slides down and off as the reader expands. When the reader is expanded, the
          (translated-off) layer must not swallow touches meant for the reader beneath it. */}
      <GestureDetector gesture={detailsGestures}>
        <Animated.View
          testID="series-reader.details-card"
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
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {/* The reader's dark surface — SwipeDismiss's static backdrop: full screen, never moving,
          fading in place while a dismissal carries the page over it. It lives OUTSIDE the
          strip-centering frame below: inside it, the surface rode the frame's translate up with
          the reader and uncovered the screen bottom at low progress — the underlying screen
          showed through the seam gradient as a dark bar whenever a drag held the transition
          near the reader side. */}
      <Animated.View pointerEvents="none" style={[styles.readerSurface, { width, height }, dismissFadeStyle]} />

      {/* The reader, beneath the details: full screen, with SwipeDismiss's layering inside —
          static fading surface (above), traveling page subtree, fading chrome. The collapse/
          dismiss pan wraps the whole cell (the scrubber and a zoomed page disable it), matching
          how SwipeDismiss wraps the readers on /reader. */}
      <GestureDetector gesture={collapsePan}>
        <Animated.View
          testID="series-reader.reader-card"
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
              pageStyle={pageDismissStyle}
              chromeStyle={chromeDismissStyle}
              // Details mode: the reader is a decorative background strip — load ONLY the page
              // on screen (no warm-ahead, render window of 1). Expanding flips this (a beat
              // after the transition settles — see detailsSettled) and the normal prefetch
              // pipeline resumes.
              standby={detailsSettled}
              inLibrary={inLibrary}
            />
          )}
            {/* Bottom chrome extras that fade with a dismissal instead of traveling with the
                page — reader.tsx's chrome treatment. The pill is the guaranteed collapse path in
                both modes (webtoon's expanded reader owns vertical drags). */}
            <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeDismissStyle]}>
              <DetailsHint mode={settings.mode} visible={chromeVisible && !detailsActive} onPress={() => setRevealed(1)} />
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* The reader strip's touch surface — tap to read full screen, or drag DOWN to slide the
          details page away under the finger. It rides the same occlusion as the strip
          (headerBandStyle), so it scrolls off with the page and never blocks content. */}
      {detailsActive && (
        <GestureDetector gesture={bandPan}>
          {/* Ends where the content starts (the title reaches up into the seam), so it never
              covers anything tappable. */}
          <Animated.View style={[styles.dockBand, { height: headerTopInset }, headerBandStyle]}>
            <Pressable
              testID="series-reader.header-band"
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
    </View>
  );
}

/**
 * The route component: the base series instance for the route's params, plus one LAYER per
 * drilled series (see SeriesReaderInstance's header for why layers, not navigation). The drill
 * itself arrives through the nested layout's context ref — series cards anywhere inside the
 * series-reader stack call it (popping the nested stack back to this screen first when they're
 * on the search/downloads sub-pages, see useDrillRelatedSeries). Only the topmost instance takes
 * touches; the ones beneath stay live purely as the see-through under its gestures.
 */
type DrillEntry = { key: number } & ({ kind: 'series'; params: SeriesReaderParams } | { kind: 'search' });

// memo: pushing/popping a layer re-renders the wrapper below — without this, every mounted
// instance (each a whole series page) re-renders along with it for nothing.
const MemoSeriesReaderInstance = memo(SeriesReaderInstance);

export default function SeriesReaderScreen() {
  const params = useLocalSearchParams<SeriesReaderParams>();
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
  return (
    <View style={styles.container}>
      <View style={styles.container} pointerEvents={drills.length === 0 ? 'auto' : 'none'}>
        <MemoSeriesReaderInstance params={params} depth={0} onPopLayer={popLayer} />
      </View>
      {drills.map((d, i) => (
        <View
          key={d.key}
          style={StyleSheet.absoluteFill}
          pointerEvents={i === drills.length - 1 ? 'auto' : 'none'}>
          {d.kind === 'series' ? (
            <MemoSeriesReaderInstance params={d.params} depth={i + 1} onPopLayer={popLayer} />
          ) : (
            <SearchLayer onPopLayer={popLayer} />
          )}
        </View>
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
function SearchLayer({ onPopLayer }: { onPopLayer: () => void }) {
  const { width } = useWindowDimensions();
  const edgeX = useSharedValue(width);
  const edgeCommitting = useSharedValue(false);
  useEffect(() => {
    edgeX.set(withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
    // Mount-only entrance — edgeX is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeLayer = useCallback(() => {
    edgeCommitting.set(true);
    edgeX.set(
      withTiming(width, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onPopLayer)();
      }),
    );
  }, [edgeX, edgeCommitting, width, onPopLayer]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeLayer();
      return true;
    });
    return () => sub.remove();
  }, [closeLayer]);
  // The back-swipe — the instance rig's recipe (full-surface, native activation criteria; the
  // search's own horizontal pieces, the filter chips, claim their touches the same way the
  // details rails do). Same iOS scroll interop as the instance's detailsScrollGesture: without a
  // NativeViewGestureHandler on the results scroller, its UIScrollView pan force-fails this one
  // before it can activate.
  const scrollGesture = useMemo(() => (IS_WEB ? undefined : Gesture.Native()), []);
  const edgePan = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX(20)
      .failOffsetX(-12)
      .failOffsetY([-14, 14])
      .onUpdate((e) => {
        edgeX.set(Math.max(0, e.translationX));
      })
      .onEnd((e) => {
        if (edgeX.value > width * 0.3 || e.velocityX > FLICK_VELOCITY) {
          edgeCommitting.set(true);
          edgeX.set(
            withTiming(width, { duration: EXIT_MS }, (finished) => {
              if (finished) runOnJS(onPopLayer)();
            }),
          );
        } else {
          edgeX.set(withSpring(0, SPRING_BACK));
        }
      })
      .onFinalize(() => {
        if (!edgeCommitting.value) edgeX.set(withSpring(0, SPRING_BACK));
        edgeCommitting.set(false);
      });
    if (scrollGesture) pan.simultaneousWithExternalGesture(scrollGesture);
    return pan;
  }, [width, edgeX, edgeCommitting, onPopLayer, scrollGesture]);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: edgeX.value }] }));
  const embedded = useMemo(() => ({ onBack: closeLayer, scrollGesture }), [closeLayer, scrollGesture]);
  return (
    <View style={styles.container}>
      <GestureDetector gesture={edgePan}>
        <Animated.View style={[styles.screenSlide, slideStyle]}>
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
  /** The instance's `detailsScrollGesture` — mounted on SeriesBody's scroller (see the edgePan). */
  scrollGesture?: NativeGesture;
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

  // The hero cover's measured aspect — same clamp + wiggle filter as SeriesScreen's onCoverLoad.
  const [coverAspect, setCoverAspect] = useState(DEFAULT_THUMB_ASPECT);
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
    />
  );
}

type ReaderPaneHandle = { goTo: (index: number, animated?: boolean) => void };

/** The reader itself + its bottom chrome, keyed to ONE RUN (the stitched window — native paged)
 *  or one chapter (web/webtoon/direct), and mounted only once its pages are in — so the start
 *  position seeds `useState`/`useRef` directly at mount (the same reason reader.tsx's pagers seed
 *  from `initialPage` exactly once). A trim of reader.tsx's body: stitched crossings relabel in
 *  place through `onRelabel`; explicit jumps swap the whole pane; the unmount flush records the
 *  outgoing chapter's final position. */
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
    /** Chrome-hold (see reader.tsx's holdChrome): suspend auto-hide while a control is in use. */
    onHoldChrome: (hold: boolean) => void;
    onZoomChange: (zoomed: boolean) => void;
    /** A scrub drag started/ended — the screen also freezes its reveal pan for the duration. */
    onScrubActive: (active: boolean) => void;
    /** Rendered between the readers and the bottom chrome — the screen's reveal tint/fade layers
     *  go here, so they dim the PAGES without washing out the navigator/pill. */
    overlay?: ReactNode;
    /** Animated transform for the PAGE subtree only — SwipeDismiss's travel. The tints and chrome
     *  deliberately DON'T ride it: the page pulls away alone while everything else fades. */
    pageStyle?: ComponentProps<typeof Animated.View>['style'];
    /** Animated fade for the bottom chrome during a dismissal (reader.tsx's chromeFadeStyle). */
    chromeStyle?: ComponentProps<typeof Animated.View>['style'];
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
    pageStyle,
    chromeStyle,
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

  // ── Stitched flat pager (native paged, chaptered) — reader.tsx's mappings ──
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
  // during the drag), so the chrome is correct in the same commit — reader.tsx's seekTo.
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

  // ── Progress recording — reader.tsx's rules: a library series (inLibrary, queried by the
  // screen) records chapter progress, anything else (including a direct series) goes to the
  // reading log under the DIRECT_CHAPTER_ID sentinel. ──
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
      {/* The page subtree — the ONLY thing a dismissal moves (see pageStyle). */}
      <Animated.View testID="series-reader.page-wrap" style={[styles.pageWrap, pageStyle]}>
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
      </Animated.View>

      {/* Tint/fade layers over the pages, under the chrome below. */}
      {overlay}

      {/* Bottom chrome — fades with a dismissal instead of traveling (chromeStyle). */}
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
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
          // chapter's page/length, turning over WITH the swipe (reader.tsx's treatment).
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
      style={[styles.detailsHintWrap, { bottom: insets.bottom + Spacing.two + 48 }, style]}>
      <Pressable
        testID="series-reader.details"
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Show series details"
        style={styles.detailsHintPill}>
        {/* The chevron points where the READER goes: up and away in paged mode, right in webtoon. */}
        {mode === 'paged' ? <ChevronUpIcon color="#fff" size={16} /> : <ChevronRightIcon color="#fff" size={16} />}
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
  // The edge back-swipe's ride (see screenSlideStyle).
  screenSlide: {
    flex: 1,
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
