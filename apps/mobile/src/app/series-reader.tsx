import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';

import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from '@/components/icons/ui-icons';
import { ChapterNavigator } from '@/components/reader/chapter-navigator';
import { PagedReader, type PagedReaderHandle, type ReaderPageItem } from '@/components/reader/paged-reader';
import { ProgressPill } from '@/components/reader/progress-pill';
import { ReaderToolbar } from '@/components/reader/reader-toolbar';
import { SettingsControl } from '@/components/reader/settings-panel';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { RetryBlock } from '@/components/retry-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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
import { useSeriesReaderVariant } from '@/lib/experimental-flags';
import { LARGE_SCREEN_BREAKPOINT } from '@/hooks/use-responsive';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';
import { firstChapterInReadingOrder, getAdjacentChapter } from '@/lib/chapter-order';
import { useRouter } from '@/lib/nav';
import { getPreferredGroup, resetPreferredGroup, setPreferredGroup } from '@/lib/preferred-group';

import { SeriesBody } from './series';

// EXPERIMENTAL series reader page (Settings → General → Experimental). A series opened from a card
// lands HERE instead of on `/series`: the reader is up immediately — same paged/webtoon readers,
// chrome, scrubber, and progress recording as `/reader` — presented as the TOP layer, a shadowed
// card with device-matched corner rounding, with the series details as the base layer BENEATH it
// (X-media-viewer style — the media is what you swipe away):
//   - paged mode (horizontal reading): swipe UP throws the reader up off the details.
//   - webtoon mode (vertical reading): swipe RIGHT slides the reader off to the right.
// The reveal favors whichever view is active: a partial drag springs back, and only a
// deep-enough drag (25% of the axis) or a flick commits to the other view. Coming back: on iOS,
// pulling the details list past its top rubber-bands the reader back down 1:1 (the same
// native-bounce sourcing usePullToRefresh uses) and releasing past PULL_COMMIT_PX commits —
// this works from anywhere on the list, not just its top edge; Android/web keep a
// manual-activation pan gated on the list being at its top. The chrome's "Details" pill and the
// details' grab-handle are the guaranteed non-gesture paths — needed on web (the web pager owns
// its whole touch surface) and under a fit-width page taller than the viewport (its vertical
// content-pan rightly wins the drag; see zoomable-page's `contentPan`).
//
// The details card renders series.tsx's OWN `SeriesBody` — cover hero, action column, tag/meta/
// description, the real chapter list (downloads, versions, read state), page-thumb grid, related
// rails — so the two screens cannot drift. Three override props route its intents back into this
// screen instead of pushing routes: `onStartReading` (Read button → back to the in-place reader),
// `onOpenChapter` (chapter row → swap the reader pane's chapter and return to it), `onOpenPage`
// (direct-series thumbnail → jump the pane to that page and return).
//
// Chaptered series read chapter-by-chapter: the screen resolves resume-or-first-chapter itself
// (same history lookup as useStartReading), and the navigator's skip buttons / falling off either
// end of a chapter swap chapters in place. Unlike /reader there's NO cross-chapter stitching — a
// boundary crossing remounts the reader pane (the pre-stitching /reader behavior), the
// simplicity/fidelity trade this experiment deliberately makes.
//
// Removal list for the whole experiment: this file + `lib/experimental-flags.ts`, the Settings row
// in `settings-general.tsx`, the `buildHref` target switch in `series-card.tsx`, this route's
// Stack.Screen entry in `_layout.tsx`, and the default-preserving embedding props on
// `series.tsx`'s SeriesBody (`topInset`/`onStartReading`/`onOpenChapter`/`onOpenPage`) +
// `chapters-section.tsx`'s `onOpenChapter`/`onOpenPage`.

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
// iOS return pull: how far past the details list's top the rubber-band must be pulled, at release,
// to bring the reader back. Roughly usePullToRefresh's trigger feel.
const PULL_COMMIT_PX = 80;
// How far below the screen the details content extends on iOS paged mode, so the return pull's
// rubber-band freeze (a counter-translate of the list viewport) never exposes a gap at the bottom
// — the clipped strip comes out of this hidden slack instead of the visible screen. The same
// amount is added back as list bottom padding, so the scroll extent is unchanged.
const PULL_SLACK = 200;
// The dismissal is the old reader's SwipeDismiss, verbatim: the page follows the finger in BOTH
// axes, shrinks with distance, and the dark backdrop fades in place over a full span while the
// page stays solid; release past DISMISS_FRACTION/flick flings it out along its own direction.
const EXIT_MS = 180;
const MIN_SCALE = 0.45;
const SCALE_SPAN_FRACTION = 0.7;
const SPRING_BACK = { duration: 300, dampingRatio: 1 } as const;
// The reader card's separating edge over the (always-dark-or-light) details — a light hairline
// reads on the dark reader surface in both themes.
const READER_EDGE = 'rgba(255,255,255,0.25)';
// Header variant: the visible height of the collapsed reader strip (below the safe area) — "quite
// short, almost like a faded out background image".
const HEADER_BAND = 120;
// The details-content fade (and the reader's matching tint) complete within this fraction of the
// travel — weighted toward the START of a reveal and, symmetrically, the END of a hide.
const FADE_WINDOW = 0.4;

/** Best-effort match for the DEVICE's screen corner radius (there's no public API for the real
 *  value): modern edge-to-edge iPhones draw ~54pt continuous corners, older flat-cornered ones
 *  none; Android is a guess at the common ballpark; web windows are square. Because the reader
 *  card is exactly screen-sized, a matching radius is invisible at rest (it aligns with the
 *  physical corners) and reads as the screen itself lifting once the drag starts. */
function screenCornerRadius(insetBottom: number): number {
  if (IS_WEB) return 0;
  if (IS_IOS) return insetBottom > 0 ? 54 : 8;
  return 28;
}

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
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mock = useMockActive();
  const [settings] = useReaderSettings();
  // Which experimental layout this screen runs (Settings → Experimental → "Series reader layout").
  // 'card': reader on top, opens reading. 'header': reader as a short faded strip above the
  // details, opens on the details — captured at mount (changing it means reopening the screen).
  const isHeader = useSeriesReaderVariant() === 'header';

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
  // for everything JS-side (gesture enabling, back handling, status bar).
  // Header variant opens ON the details (reader collapsed to the strip) — same progress semantics
  // (0 = full reader, 1 = details), different starting side.
  const progress = useSharedValue(isHeader ? 1 : 0);
  const [detailsActive, setDetailsActive] = useState(isHeader);
  // The details card's internal scroll offset (SeriesBody's list writes it on the UI thread via
  // the same `sharedValues` wiring pull-to-refresh uses) — gates the paged-mode return pan so a
  // downward drag only pulls the card away when its content is already at the top.
  const detailsScrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset: detailsScrollOffset }), [detailsScrollOffset]);
  // UI-thread mirror of `detailsActive`, for the worklets below (the iOS pull-follow must stop the
  // instant a commit animation takes over `progress`).
  const detailsActiveSV = useSharedValue(isHeader);
  // Dismissal offsets — the old reader's swipe-away, folded into the same pans as the reveal
  // (opposite direction on the same axis): the page follows the finger in BOTH axes while the
  // backdrop fades, and a commit flings it out along its own direction. `dismissing` freezes the
  // gesture once the exit animation owns the offsets.
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const dismissing = useSharedValue(false);
  // True only for a details drag that BEGAN with the list at its top — that's the drag allowed to
  // pull the reader back (and whose rubber-band the details visually freeze against). A drag from
  // mid-list that reaches the top just stretches like any scroll.
  const pullArmedSV = useSharedValue(false);

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
      progress.set(withTiming(to, { duration: 240, easing: Easing.out(Easing.cubic) }));
      commitReveal(to);
    },
    [progress, detailsActiveSV, commitReveal],
  );

  // iOS return pull: while the details are up, a drag that STARTS with the list at its top rides
  // the native rubber-band (`scrollOffset` goes negative — the same bounce sourcing
  // usePullToRefresh uses) to drag the reader back down 1:1 from anywhere on the list; releasing
  // past the threshold commits (`onScrollEndDrag`), short of it the bounce carries it back. The
  // details content itself is visually FROZEN against that rubber-band (see detailsContentStyle's
  // counter-translate) — only the reader should move. `pullArmedSV` clears once the overscroll
  // settles back to zero, so the freeze survives the bounce-back without a jump; a drag that
  // reaches the top from mid-list never arms and just stretches natively.
  const onDetailsScrollBeginDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!IS_IOS || !detailsActive || isHeader) return;
      if (e.nativeEvent.contentOffset.y <= 1) pullArmedSV.set(true);
    },
    [detailsActive, isHeader, pullArmedSV],
  );
  useAnimatedReaction(
    () => detailsScrollOffset.value,
    (off, prevOff) => {
      if (!IS_IOS || isHeader) return;
      if (pullArmedSV.value && off >= -0.5 && (prevOff ?? 0) < -0.5) pullArmedSV.set(false);
      if (!detailsActiveSV.value || !pullArmedSV.value) return;
      if (off < 0) progress.set(Math.max(0, Math.min(1, 1 + off / height)));
    },
    [height, isHeader, detailsScrollOffset, detailsActiveSV, pullArmedSV, progress],
  );
  const onDetailsScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!IS_IOS || !detailsActive || isHeader) return;
      if (!pullArmedSV.get()) return;
      if (e.nativeEvent.contentOffset.y <= -PULL_COMMIT_PX) setRevealed(0);
    },
    [detailsActive, isHeader, pullArmedSV, setRevealed],
  );

  // Android hardware back steps back to the variant's HOME side before popping: card variant's
  // home is the reader (details open → back closes them), header variant's is the details
  // (reader expanded → back collapses it). (Android-only API — react-native-web's BackHandler
  // stub rejects addEventListener.)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const away = isHeader ? !detailsActive : detailsActive;
    if (!away) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setRevealed(isHeader ? 1 : 0);
      return true;
    });
    return () => sub.remove();
  }, [detailsActive, isHeader, setRevealed]);

  // The pop back to browse, shared by the dismiss worklets (ref-free for runOnJS).
  const goBack = useCallback(() => router.back(), [router]);

  // Reveal/dismiss pan — wraps the reader, on the cross axis of its scroll: the reveal direction
  // (up in paged, right in webtoon) throws the reader off the details; the opposite direction IS
  // the old reader's SwipeDismiss — free 2D finger-follow, distance shrink, backdrop fade, fling
  // exit, spring-back cancel — popping back to the screen this one was opened over (the route is
  // a contained transparent modal). Built inside useMemo like chapter-navigator's pan (the React
  // Compiler lint can't tell worklets from render code). `buildPan` runs twice — a gesture
  // instance attaches to one detector only, and the docked details sliver carries its own copy.
  const revealEnabled = !isHeader && !detailsActive && !readerZoomed && !scrubbing;
  const [revealPan, dockPan] = useMemo(() => {
    const span = settings.mode === 'paged' ? height : width;
    const buildPan = () => {
      const pan = Gesture.Pan()
        .enabled(revealEnabled)
        .onUpdate((e) => {
          if (dismissing.value) return;
          const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
          if (cross <= 0) {
            // Reveal direction: the card rides its axis toward the details.
            progress.set(Math.min(1, -cross / span));
            dismissX.set(0);
            dismissY.set(0);
          } else {
            // Dismiss direction: free 2D follow under the finger (SwipeDismiss behavior).
            dismissX.set(e.translationX);
            dismissY.set(e.translationY);
            progress.set(0);
          }
        })
        .onEnd((e) => {
          if (dismissing.value) return;
          const cross = settings.mode === 'paged' ? e.translationY : -e.translationX;
          const crossVelocity = settings.mode === 'paged' ? e.velocityY : -e.velocityX;
          if (cross <= 0) {
            const open = -cross / span > COMMIT_FRACTION || crossVelocity < -FLICK_VELOCITY;
            detailsActiveSV.set(open);
            progress.set(withTiming(open ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
            runOnJS(commitReveal)(open ? 1 : 0);
            return;
          }
          const byFlick = crossVelocity > FLICK_VELOCITY;
          if (!byFlick && cross < span * COMMIT_FRACTION) {
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
              if (finished) runOnJS(goBack)();
            }),
          );
        });
      if (settings.mode === 'paged') pan.activeOffsetY([-20, 20]).failOffsetX([-15, 15]);
      else pan.activeOffsetX([-20, 20]).failOffsetY([-15, 15]);
      return pan;
    };
    return [buildPan(), buildPan()];
  }, [settings.mode, revealEnabled, width, height, progress, dismissX, dismissY, dismissing, detailsActiveSV, commitReveal, goBack]);

  // Header-variant pans. The BAND (the collapsed reader strip) expands: a tap or an upward drag
  // pushes the details sheet up and away, following the finger. The expanded reader collapses
  // back on the cross axis of its scroll: drag down (paged) / rightward (webtoon) slides the
  // details back in from the top. Same hysteresis as everything else.
  const headerCollapseEnabled = isHeader && !detailsActive && !readerZoomed && !scrubbing;
  const headerPans = useMemo(() => {
    if (!isHeader) return null;
    const bandPan = Gesture.Pan()
      .enabled(detailsActive)
      .activeOffsetY([-20, 20])
      .failOffsetX([-15, 15])
      .onUpdate((e) => {
        progress.set(Math.max(0, Math.min(1, 1 + e.translationY / height)));
      })
      .onEnd((e) => {
        const open = -e.translationY / height > COMMIT_FRACTION || e.velocityY < -FLICK_VELOCITY;
        detailsActiveSV.set(!open);
        progress.set(withTiming(open ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
        runOnJS(commitReveal)(open ? 0 : 1);
      });
    const collapsePan =
      settings.mode === 'paged'
        ? Gesture.Pan()
            .enabled(headerCollapseEnabled)
            .activeOffsetY([-20, 20])
            .failOffsetX([-15, 15])
            .onUpdate((e) => {
              progress.set(Math.max(0, Math.min(1, e.translationY / height)));
            })
            .onEnd((e) => {
              const close = e.translationY / height > COMMIT_FRACTION || e.velocityY > FLICK_VELOCITY;
              detailsActiveSV.set(close);
              progress.set(withTiming(close ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
              runOnJS(commitReveal)(close ? 1 : 0);
            })
        : Gesture.Pan()
            .enabled(headerCollapseEnabled)
            .activeOffsetX([-20, 20])
            .failOffsetY([-15, 15])
            .onUpdate((e) => {
              progress.set(Math.max(0, Math.min(1, e.translationX / width)));
            })
            .onEnd((e) => {
              const close = e.translationX / width > COMMIT_FRACTION || e.velocityX > FLICK_VELOCITY;
              detailsActiveSV.set(close);
              progress.set(withTiming(close ? 1 : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
              runOnJS(commitReveal)(close ? 1 : 0);
            });
    return { bandPan, collapsePan };
  }, [isHeader, detailsActive, headerCollapseEnabled, settings.mode, width, height, progress, detailsActiveSV, commitReveal]);

  // Return pan — on the details layer. Paged mode shares the vertical axis with the details' own
  // scroller, so it activates MANUALLY: only a clearly-downward drag with the content at its top
  // pulls the reader back down; everything else fails fast and the list scrolls. iOS doesn't use
  // this path at all — the native bounce (reaction above) both follows the finger and commits,
  // which is what makes the pull work from anywhere once the list is at its top. Webtoon mode's
  // details scroll vertically while the reader travels horizontally — a plain orthogonal pan.
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const returnPan = useMemo(() => {
    return settings.mode === 'paged'
      ? Gesture.Pan()
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
            progress.set(Math.max(0, Math.min(1, 1 - e.translationY / height)));
          })
          .onEnd((e) => {
            const close = e.translationY / height > COMMIT_FRACTION || e.velocityY > FLICK_VELOCITY;
            detailsActiveSV.set(!close);
            progress.set(withTiming(close ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
            runOnJS(commitReveal)(close ? 0 : 1);
          })
      : Gesture.Pan()
          .enabled(detailsActive)
          .activeOffsetX([-20, 20])
          .failOffsetY([-15, 15])
          .onUpdate((e) => {
            progress.set(Math.max(0, Math.min(1, 1 + e.translationX / width)));
          })
          .onEnd((e) => {
            const close = -e.translationX / width > COMMIT_FRACTION || e.velocityX < -FLICK_VELOCITY;
            detailsActiveSV.set(!close);
            progress.set(withTiming(close ? 0 : 1, { duration: 240, easing: Easing.out(Easing.cubic) }));
            runOnJS(commitReveal)(close ? 0 : 1);
          });
  }, [settings.mode, detailsActive, width, height, progress, touchStartX, touchStartY, detailsScrollOffset, detailsActiveSV, commitReveal]);

  // Geometry: in paged mode the reader card is DOCKED below the safe area — the details stay
  // visible in the top band (their own affordance, replacing the floating Details pill), and the
  // dock itself is grab-able (tap or drag). Webtoon keeps the full-height reader + pill. The
  // sliver is floored so flat-cornered/web devices still get one.
  const dockInset = settings.mode === 'paged' && !isHeader ? Math.max(insets.top, 24) : 0;
  const readerH = height - dockInset;
  const detailsSlack = IS_IOS && settings.mode === 'paged' && !isHeader ? PULL_SLACK : 0;
  // Header variant: the collapsed reader strip's height, and the sheet geometry hanging below it.
  const bandH = insets.top + HEADER_BAND;
  // The sheet is screen-height but sits bandH down — compensate the hidden tail as bottom padding
  // (same bottomInset mechanism as the pull slack) so its scroll extent stays honest.
  const detailsBottomInset = isHeader ? bandH : detailsSlack;
  const cardRadius = screenCornerRadius(insets.bottom);

  // The reader card travels on the reveal axis (up in paged mode, right in webtoon). A dismissal
  // is SwipeDismiss verbatim: the card follows the finger in both axes and shrinks with distance
  // (scale after the translate, so it pulls away under the finger), staying solid, while the dark
  // dismissal backdrop below fades in place over a full span. The details content fades in/out on
  // a curve weighted toward the front of a reveal / the end of a hide (complete within
  // FADE_WINDOW of the travel), matched by a slight tint on the reader.
  const span = settings.mode === 'paged' ? height : width;
  const readerCardStyle = useAnimatedStyle(() => {
    if (isHeader) return { transform: [] }; // header variant: the reader is a static backdrop
    const p = progress.value;
    const dx = dismissX.value;
    const dy = dismissY.value;
    const dist = Math.hypot(dx, dy);
    const scale = interpolate(dist, [0, span * SCALE_SPAN_FRACTION], [1, MIN_SCALE], Extrapolation.CLAMP);
    const baseX = settings.mode === 'paged' ? 0 : p * width;
    const baseY = settings.mode === 'paged' ? -p * height : 0;
    return {
      transform: [{ translateX: baseX + dx }, { translateY: baseY + dy }, { scale }],
    };
  }, [isHeader, settings.mode, width, height, span]);
  // Header variant: the details as a SHEET hanging below the band, sliding up and off (past its
  // own height plus the band) as the reader expands; and the collapsed reader's heavy fade —
  // "almost like a faded out background image".
  const headerSheetStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: -(1 - progress.value) * (height + bandH) }] }),
    [height, bandH],
  );
  const headerReaderFadeStyle = useAnimatedStyle(() => ({ opacity: 0.55 * progress.value }));
  const readerTintStyle = useAnimatedStyle(() => ({
    opacity: 0.18 * Math.min(1, progress.value / FADE_WINDOW),
  }));
  // The separating hairlines only exist where there's a SEAM: the paged top edge always meets the
  // docked details, but the bottom edge (and webtoon's sides) sit flush with the screen at rest —
  // those fade in the instant the card starts traveling and are gone when it's fully active.
  const travelEdgeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(progress.value * 20, Math.hypot(dismissX.value, dismissY.value) / 40)),
  }));
  const detailsContentStyle = useAnimatedStyle(() => {
    const reveal = Math.min(1, progress.value / FADE_WINDOW);
    // Freeze the iOS return pull's rubber-band: the scroll's own visual offset is cancelled by a
    // counter-translate while the pull is armed, so only the reader moves (see the reaction above;
    // the clipped strip lands in the PULL_SLACK overdraw below the screen, not in view).
    const freeze = IS_IOS && pullArmedSV.value ? Math.min(0, detailsScrollOffset.value) : 0;
    return {
      opacity: 0.45 + 0.55 * reveal,
      transform: [{ translateY: freeze }, { scale: 0.96 + 0.04 * reveal }],
    };
  });
  // SwipeDismiss's backdrop, in two layers: a dark cover over the details that appears with the
  // first pixels of a dismiss drag (the details must stay visible at rest — the dock sliver) and
  // fades out over a full span, and the details layer itself fading on the same curve so the end
  // state hands cleanly back to the screen beneath. Both derive from the live offsets, so the
  // drag, the spring-back, and the exit fling all animate them with no imperative writes.
  const dismissBackdropStyle = useAnimatedStyle(() => {
    const dist = Math.hypot(dismissX.value, dismissY.value);
    if (dist <= 0) return { opacity: 0 };
    return { opacity: Math.min(1, dist / 40) * interpolate(dist, [0, span], [1, 0], Extrapolation.CLAMP) };
  }, [span]);
  const dismissFadeStyle = useAnimatedStyle(() => {
    const dist = Math.hypot(dismissX.value, dismissY.value);
    return { opacity: interpolate(dist, [0, span], [1, 0], Extrapolation.CLAMP) };
  }, [span]);

  // ── Details-card intents, routed back into the in-place reader ───────────
  const paneRef = useRef<ReaderPaneHandle>(null);
  const openChapterFromDetails = useCallback(
    (v: Chapter) => {
      if (v.id !== targetChapterId) {
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

  return (
    // Plain (transparent) root — the route is a contained transparent modal, so a dismissal can
    // fade the layers out over the screen beneath. The details layer supplies the opaque fill.
    <View style={styles.container}>
      <StatusBar
        style={settings.mode === 'paged' || detailsActive ? (scheme === 'dark' ? 'light' : 'dark') : 'light'}
        hidden={settings.mode !== 'paged' && !chromeVisible && !detailsActive}
      />

      {/* Base layer: the series details (series.tsx's real SeriesBody) with their grab-handle.
          The outer view fades with a dismissal (handing back to the screen beneath); the inner
          wrapper carries the reveal fade/scale over the opaque themed fill. */}
      <GestureDetector gesture={returnPan}>
        <Animated.View
          testID="series-reader.details-card"
          style={[
            styles.detailsLayer,
            { width, height },
            // Header variant: the details are a sheet hanging below the reader strip, in FRONT of
            // the (static) reader; card variant: the base layer behind the traveling card.
            isHeader ? [{ top: bandH, zIndex: 2 }, headerSheetStyle] : dismissFadeStyle,
          ]}>
          {/* Header variant's seam: the reader strip fades down into the sheet — a gradient
              hanging just above the sheet's top edge, traveling with it. */}
          {isHeader && (
            <LinearGradient
              colors={['transparent', theme.background]}
              style={styles.sheetFade}
              pointerEvents="none"
            />
          )}
          <ThemedView style={styles.detailsInner}>
            <Animated.View
              style={[
                styles.detailsContent,
                // iOS paged: overdraw below the screen so the return pull's freeze counter-translate
                // clips into hidden slack instead of exposing a bar (see PULL_SLACK).
                detailsSlack > 0 && { position: 'absolute', top: 0, left: 0, right: 0, height: height + detailsSlack },
                detailsContentStyle,
              ]}>
              <SeriesDetailsHost
                bridgeId={bridgeId}
                id={id}
                title={title}
                bridge={bridge}
                cover={cover}
                isDirect={isDirect}
                width={width}
                topInset={isHeader ? Spacing.five : undefined}
                bottomInset={detailsBottomInset}
                sharedValues={sharedValues}
                onScrollBeginDrag={onDetailsScrollBeginDrag}
                onScrollEndDrag={onDetailsScrollEndDrag}
                onStartReading={startReadingFromDetails}
                onOpenChapter={openChapterFromDetails}
                onOpenPage={openPageFromDetails}
              />
            </Animated.View>
            {/* Grab-handle: tap (or drag) to bring the reader back — it returns from the top in
                paged mode, from the right in webtoon. (Header variant's affordance is the reader
                strip itself, so no grab-handle there.) */}
            {!isHeader && (
            <Pressable
              testID="series-reader.details-grabber"
              onPress={() => setRevealed(0)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Back to reader"
              style={[styles.grabber, { top: insets.top + Spacing.one }]}>
              <ThemedView type="backgroundElement" style={[styles.grabberPill, { borderColor: theme.hairline }]}>
                {settings.mode === 'paged' ? (
                  <ChevronDownIcon color={theme.text} size={16} />
                ) : (
                  <ChevronLeftIcon color={theme.text} size={16} />
                )}
              </ThemedView>
            </Pressable>
            )}
          </ThemedView>
        </Animated.View>
      </GestureDetector>

      {/* SwipeDismiss's dark backdrop: appears with the first pixels of a dismiss drag and fades
          in place as the page travels, revealing the screen this one was opened over. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dismissBackdrop, dismissBackdropStyle]} />

      {/* Top layer: the reader as a shadowed, device-cornered card — the thing you swipe away —
          docked below the safe area in paged mode so the details stay slightly visible above it.
          A hairline on the travel edges (top/bottom in paged, sides in webtoon) separates it from
          the details. The reveal/dismiss pan wraps the whole cell (the scrubber and a zoomed page
          disable it), matching how SwipeDismiss wraps the readers on /reader. Shadow lives on an
          outer, non-clipping view (iOS shadows don't survive overflow: hidden); the inner view
          clips to the corners. */}
      <GestureDetector gesture={headerPans ? headerPans.collapsePan : revealPan}>
        <Animated.View
          testID="series-reader.reader-card"
          style={[
            styles.readerShadow,
            { top: dockInset, width, height: readerH, borderRadius: isHeader ? 0 : cardRadius },
            isHeader && styles.readerFlat,
            readerCardStyle,
          ]}>
          <View style={[styles.readerClip, { borderRadius: isHeader ? 0 : cardRadius }]}>
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
              // Chapter navigation swaps the pane wholesale — position state, records, and the
              // pager all belong to exactly one chapter (or the direct page list).
              key={target.chapterId ?? DIRECT_CHAPTER_ID}
              ref={paneRef}
              pages={pages}
              start={target.start}
              width={width}
              height={readerH}
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
              chromeVisible={chromeVisible && !(isHeader && detailsActive)}
              onToggleChrome={toggleChrome}
              onShowChrome={showChrome}
              onHoldChrome={holdChrome}
              onZoomChange={setReaderZoomed}
              onScrubActive={onScrubActive}
            />
          )}
            {/* The reader's tint, matched to the details fade — separates the lifting card. */}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.readerTint, readerTintStyle]} />
            {/* Header variant: the collapsed strip's heavy fade — the reader as a muted
                background image behind the band. */}
            {isHeader && (
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.readerTint, headerReaderFadeStyle]}
              />
            )}
            {/* Separating hairlines, only where a seam exists, following the card's SHAPE — each is
                a border "cap" that traces the edge THROUGH its rounded corners. Paged: the top cap
                always shows (it permanently meets the docked details); the bottom cap only while
                the card travels. Webtoon rests flush on all edges, so its full outline is
                travel-gated. */}
            {isHeader ? null : settings.mode === 'paged' ? (
              <>
                <View
                  pointerEvents="none"
                  style={[
                    styles.hairlineCap,
                    {
                      top: 0,
                      height: Math.max(cardRadius, 1) + 2,
                      borderTopLeftRadius: cardRadius,
                      borderTopRightRadius: cardRadius,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderLeftWidth: StyleSheet.hairlineWidth,
                      borderRightWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.hairlineCap,
                    {
                      bottom: 0,
                      height: Math.max(cardRadius, 1) + 2,
                      borderBottomLeftRadius: cardRadius,
                      borderBottomRightRadius: cardRadius,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderLeftWidth: StyleSheet.hairlineWidth,
                      borderRightWidth: StyleSheet.hairlineWidth,
                    },
                    travelEdgeStyle,
                  ]}
                />
              </>
            ) : (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  styles.hairlineOutline,
                  { borderRadius: cardRadius },
                  travelEdgeStyle,
                ]}
              />
            )}
            {/* Card variant: webtoon keeps the floating Details pill (paged's affordance is the
                docked sliver). Header variant: the pill is the guaranteed collapse path in both
                modes (webtoon's expanded reader owns vertical drags). */}
            {(settings.mode === 'webtoon' || isHeader) && (
              <DetailsHint mode={settings.mode} visible={chromeVisible && !detailsActive} onPress={() => setRevealed(1)} />
            )}
            {/* Toolbar outside the loaded branch, like reader.tsx: back + settings stay reachable
                while pages are loading or the fetch failed. Series title on top, chapter beneath. */}
            <ReaderToolbar
              title={seriesTitle}
              subtitle={target?.chapterName ?? ''}
              visible={chromeVisible && !(isHeader && detailsActive)}
              // The card variant's docked card already clears the notch — don't duck it twice.
              // (Header variant's reader is truly full screen, so it keeps the default inset.)
              topInset={!isHeader && settings.mode === 'paged' ? 0 : undefined}
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
        </Animated.View>
      </GestureDetector>

      {/* Card variant: the docked details sliver's touch surface (paged mode, reader at rest):
          tap to reveal the details, or drag — up throws the reader off, down pulls it into the
          dismissal. */}
      {!isHeader && settings.mode === 'paged' && !detailsActive && (
        <GestureDetector gesture={dockPan}>
          <View style={[styles.dockBand, { height: dockInset }]}>
            <Pressable
              testID="series-reader.details-dock"
              onPress={() => setRevealed(1)}
              accessibilityRole="button"
              accessibilityLabel="Show series details"
              style={StyleSheet.absoluteFill}
            />
          </View>
        </GestureDetector>
      )}

      {/* Header variant: the collapsed reader strip's touch surface — tap to read full screen, or
          drag up to push the details sheet away under the finger. */}
      {headerPans && detailsActive && (
        <GestureDetector gesture={headerPans.bandPan}>
          <View style={[styles.dockBand, { height: bandH }]}>
            <Pressable
              testID="series-reader.header-band"
              onPress={() => setRevealed(0)}
              accessibilityRole="button"
              accessibilityLabel="Read full screen"
              style={StyleSheet.absoluteFill}
            />
          </View>
        </GestureDetector>
      )}
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
  bottomInset,
  sharedValues,
  onScrollBeginDrag,
  onScrollEndDrag,
  onStartReading,
  onOpenChapter,
  onOpenPage,
}: {
  bridgeId?: string;
  id?: string;
  title?: string;
  bridge?: string;
  cover?: string;
  isDirect: boolean;
  width: number;
  /** Overrides the default content top inset (safe area + breathing room) — the header variant's
   *  sheet already hangs below the reader strip, so it only needs the breathing room. */
  topInset?: number;
  /** Extra list bottom padding matching the screen's below-screen overdraw, keeping scroll extent honest. */
  bottomInset?: number;
  sharedValues: Parameters<typeof SeriesBody>[0]['sharedValues'];
  /** Start/release of a details-list drag — the screen's iOS return pull arms and commits on them. */
  onScrollBeginDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onStartReading: () => void;
  onOpenChapter: (version: Chapter) => void;
  onOpenPage: (pageIndex: number) => void;
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
      // The card has no TopBar — clear the notch plus room for the grab-handle (or the caller's
      // own inset, when its layout already clears the notch).
      topInset={topInset ?? insets.top + Spacing.five}
      bottomInset={bottomInset}
      onStartReading={onStartReading}
      onOpenChapter={onOpenChapter}
      onOpenPage={onOpenPage}
      sharedValues={sharedValues}
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={onScrollEndDrag}
    />
  );
}

type ReaderPaneHandle = { goTo: (index: number, animated?: boolean) => void };

/** The reader itself + its bottom chrome, keyed to ONE chapter (or the direct page list) and
 *  mounted only once its pages are in — so the start position seeds `useState`/`useRef` directly
 *  at mount (the same reason reader.tsx's pagers seed from `initialPage` exactly once). A trim of
 *  reader.tsx's body: chapter changes swap the whole pane (no cross-chapter stitching), and the
 *  unmount flush records the outgoing chapter's final position. */
const ReaderPane = forwardRef<
  ReaderPaneHandle,
  {
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
    /** A scrub drag started/ended — the screen also freezes its reveal pan for the duration. */
    onScrubActive: (active: boolean) => void;
  }
>(function ReaderPane(
  {
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

  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      setCurrent(clamped);
      if (settings.mode === 'paged') pagedRef.current?.goToPage(clamped, animated);
      else webtoonRef.current?.goToPage(clamped);
    },
    [pages, settings.mode, setCurrent],
  );
  // The details card's page-thumbnail taps jump the mounted pane directly (see openPageFromDetails).
  useImperativeHandle(ref, () => ({ goTo }), [goTo]);
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
  // The reader card's two halves: the outer view owns the shadow + travel (no clipping — iOS
  // shadows die under overflow: hidden), the inner clips content to the device-matched corners.
  readerShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: READER_BACKDROP,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 24,
  },
  readerClip: {
    flex: 1,
    backgroundColor: READER_BACKDROP,
    overflow: 'hidden',
  },
  // Header variant: the reader is a flat, static backdrop — no lift shadow.
  readerFlat: {
    shadowOpacity: 0,
    elevation: 0,
  },
  // Header variant's seam: hangs above the details sheet's top edge, fading the reader strip
  // down into the sheet.
  sheetFade: {
    position: 'absolute',
    top: -56,
    left: 0,
    right: 0,
    height: 56,
  },
  // Seam hairlines as border "caps"/outline so they trace the rounded corners, drawn as overlays
  // so their visibility can follow the card's travel (a static border can't fade per-edge).
  hairlineCap: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderColor: READER_EDGE,
    backgroundColor: 'transparent',
  },
  hairlineOutline: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: READER_EDGE,
  },
  dismissBackdrop: {
    backgroundColor: READER_BACKDROP,
  },
  readerTint: {
    backgroundColor: '#000',
  },
  // Touch surface over the docked details sliver (paged mode, reader at rest).
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
  detailsInner: {
    flex: 1,
  },
  detailsContent: {
    flex: 1,
  },
  grabber: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  grabberPill: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
