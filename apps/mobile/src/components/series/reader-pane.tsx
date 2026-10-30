import { useQueryClient } from '@tanstack/react-query';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChapterNavigator } from '@/components/reader/chapter-navigator';
import { KeepScreenAwake } from '@/components/reader/keep-awake';
import { otherFit, type Size } from '@/components/reader/page-geometry';
import { PagedReader, type PagedReaderHandle, type ReaderPageItem } from '@/components/reader/paged-reader';
import { buildSpreads, knownPageSize, readsDouble, spreadHalves, spreadRangeLabel } from '@/components/reader/spreads';
import { webtoonFit } from '@/components/reader/settings-panel';
import { StartPoster, type PosterLayout } from '@/components/reader/start-poster';
import { createZoomHold, keyZoomSpeed, resetZoom, stepZoom, zoomHoldDirection } from '@/components/reader/desktop-zoom';
import { isControlTarget, isTypingTarget } from '@/lib/key-hold';
import { keyActionOf } from '@/lib/keybindings';
import { ProgressPill } from '@/components/reader/progress-pill';
import { WebtoonReader, type WebtoonReaderHandle } from '@/components/reader/webtoon-reader';
import { warmPageImages } from '@/data/warm-pages';
import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { DIRECT_CHAPTER_ID, type HistoryEntry } from '@/data/types';
import {
  useReaderSettings,
  setFitOverride,
  useFitOverride,
  useSeriesReaderMode,
  useSpreadShift,
} from '@/hooks/use-reader-settings';
import { useWebtoonDetection } from '@/components/reader/use-webtoon-detection';
import { traceJS } from '@/lib/gesture-trace';
import { type Segment } from '@/components/series/reader-types';

const IS_WEB = Platform.OS === 'web';

/** The reader's own keys, in lib/keymap. Up/Down and a sideways pan are the readers' themselves. */
const READER_KEYS = ['zoom-step-in', 'zoom-step-out', 'zoom-reset', 'left', 'right'] as const;

/** The ones that move through what is being read. Only while it is read: not under the details,
 *  and not over a focused control, whose own Space presses it. */
const STEP_KEYS = ['page-next', 'page-prev', 'chapter-next', 'chapter-prev'] as const;

export const WARM_BEHIND = 2;

/** A bottom safe-area inset above this is a system BAR the pages should stay out of when asked to
 *  respect safe areas — Android's three-button navigation, 48dp and drawn over the content with a
 *  scrim — rather than an INDICATOR the content may run under: the iPhone home indicator is 34pt
 *  and Android gesture navigation under 30dp, both transparent strips over the page that hide
 *  nothing worth insetting for. Only the top ever hides pixels outright — the cutout — and that
 *  is always respected under the setting. */
const SYSTEM_BAR_MIN_INSET = 40;

/**
 * How still the read position has to be before the pages around it are warmed.
 *
 * Every page the reader passes reports itself — a scrub ticks about every 45ms, and a swipe through
 * a gallery reports each page as it goes by — and warming at every one of those meant a sweep from
 * page 1 to 47 enqueued a warm window per page: forty-odd windows for a journey through pages
 * nobody was going to look at. On a direct series, whose page URLs are lazy resolve-routes answered
 * one at a time by the bridge, that is minutes of round-trips bought on speculation.
 *
 * The ordering problem this used to cause is fixed properly in the resolve queue (data/api.ts): a
 * warm is `background` now and can no longer be served ahead of a page that has mounted. This is
 * the other half — not asking in the first place. Only where the reader COMES TO REST is warmed,
 * which is the only place a guess about what to read next is worth anything. Short enough that a
 * scrub that pauses to look still warms where it paused; long enough that crossing a gallery warms
 * once, at the far end.
 */
const WARM_IDLE_MS = 220;

/** How long the initial-position POSTER (see `posterUp` in ReaderPane) may stand before it stands
 *  down on its own. It normally leaves a moment after the list has drawn the start under it; this
 *  only exists so a wedged list, or a page that never loads, can't keep a picture over a live
 *  reader. */
const POSTER_BACKSTOP_MS = 3000;

/** How long the poster stays once the list has drawn the start under it: past the fade a page that
 *  loads in comes in on (`STANDBY_FADE_MS` the longest), so it leaves over a finished picture. */
const POSTER_SETTLE_MS = 200;

/** How many rows of a continuous webtoon the poster draws from the start — the screenful under it. */
const POSTER_COLUMN_ROWS = 3;

export type ReaderPaneHandle = {
  goTo: (index: number, animated?: boolean) => void;
  /** Puts where the pane stands into the cached history now, ahead of any write. */
  showProgress: () => void;
  /** The pages of `chapterId` on screen with `page`, in reading order. */
  pagesOnScreen: (chapterId: string, page: number) => { pages: number[]; rtl: boolean };
};

/** The reader itself + its bottom chrome, keyed to ONE RUN (the stitched window) or one chapter
 *  (direct/sequence), and mounted only once its pages are in — so the start
 *  position seeds `useState`/`useRef` directly at mount (the pagers read `initialPage` exactly
 *  once). Stitched crossings relabel in place through `onRelabel`; explicit jumps swap the whole
 *  pane; the unmount flush records the outgoing chapter's final position. */
export const ReaderPane = forwardRef<
  ReaderPaneHandle,
  {
    pages: string[];
    /** The stitched window ([prev?, current, next?]) — empty for direct/sequence reads, which are
     *  per-chapter. See the screen's run machinery. */
    segments: Segment[];
    /** A stitched crossing settled on a page of a NEIGHBOURING segment: the screen relabels which
     *  chapter is "current" in place (no remount — the pane is keyed by the run). */
    onRelabel: (chapterId: string, chapterName: string | undefined, page: number) => void;
    /** The page currently ON SCREEN, with the chapter it actually belongs to. Reported so the
     *  toolbar (rendered by the parent) can drive its collect-this-page heart — the pane owns the
     *  page index, the parent owns the chrome. Mid-crossing this is the NEIGHBOURING segment, not
     *  `chapterId`; see `shownWithChapter`. (Distinct from the pagers' own `onVisiblePageChange`,
     *  which reports a FLAT window index with no chapter.) */
    onVisiblePage?: (v: { pageIndex: number; chapterId: string }) => void;
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
    /** The target was picked from the details card. That lands while the pane is still in standby
     *  (the reveal and the jump share a commit, and `standby` lags the reveal), so the landing is
     *  never seen as a page turned — without this, opening page 10 and leaving recorded nothing. */
    picked?: boolean;
    /** False for a direct series — drops the navigator's chapter-skip buttons. */
    chaptered: boolean;
    /** False = never write reading progress/history from this pane (sequence mode: a hop through a
     *  collected sequence is browsing, and recording it would clobber the real read position). */
    recordProgress?: boolean;
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
    /** True while the instance's ENTRANCE animation is still playing — the initial-position
     *  poster holds for its whole duration (see `posterUp`), because the native scroll offset of
     *  a non-zero `initialScrollIndex` can land frames after the JS side reports parked. */
    entering?: boolean;
    /** Library membership (undefined while still resolving) — picks the progress-recording path.
     *  Queried by the screen, not here: this pane re-renders every page sweep. */
    inLibrary?: boolean;
    /** Whether the arrow keys turn this reader's pages (web) — only the top layer's, and not while
     *  the details cover it. */
    keyboard: boolean;
    /** The bottom bar's `glass`. */
    glass: boolean;
  }
>(function ReaderPane(
  {
    pages,
    segments,
    onRelabel,
    onVisiblePage,
    start,
    width,
    height,
    bridgeId,
    seriesId,
    seriesTitle,
    seriesCover,
    chapterId,
    chapterName,
    picked = false,
    chaptered,
    recordProgress = true,
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
    entering = false,
    inLibrary,
    keyboard,
    glass,
  },
  ref,
) {
  const ds = useDataSource();
  const mock = useMockActive();
  const queryClient = useQueryClient();
  const seriesKey = bridgeId && seriesId ? `${bridgeId}:${seriesId}` : null;
  const [settings] = useReaderSettings(seriesKey);
  // The fit the pages are drawn to: the setting, or the axis a `switch-fit` double-tap has put in
  // its place for the moment (see `fitOverride$`). Cleared with this pane, so leaving the reader
  // — a chapter crossing the run doesn't cover, or the series page — returns to the setting.
  const fitOverride = useFitOverride();
  const pageFit = fitOverride ?? settings.pageFit;
  useEffect(() => () => setFitOverride(null), []);
  // The reader draws edge to edge on both platforms — the window runs under the status bar and
  // any cutout, and under the navigation bar on Android — so a page fitted to the height runs
  // under the notch. `respectSafeArea` insets the PAGES (never the chrome, which places itself)
  // by the top inset, and by the bottom one only where that is a real bar — see
  // SYSTEM_BAR_MIN_INSET. Web has no insets and is unchanged.
  const insets = useSafeAreaInsets();
  const insetTop = settings.respectSafeArea ? insets.top : 0;
  const insetBottom = settings.respectSafeArea && insets.bottom > SYSTEM_BAR_MIN_INSET ? insets.bottom : 0;
  const pageHeight = height - insetTop - insetBottom;
  const double = settings.mode === 'paged' && readsDouble(settings.pageLayout, { width, height: pageHeight });
  const shift = useSpreadShift(seriesKey);
  // A series whose pages turn out to be strips switches itself to vertical (see the hook); nothing
  // to decide once the series has a mode of its own, by detection or by hand.
  const seriesMode = useSeriesReaderMode(seriesKey);
  const detectPageSize = useWebtoonDetection(seriesKey, settings.mode === 'paged' && !seriesMode);
  // The double-tap under its switch-fit mode: fit the axis this page does NOT currently fill
  // (see `otherFit`), for every page until the next double-tap, which clears it. Never written to
  // the setting: from `auto` there is no single axis to write, and a double-tap is a moment's
  // choice, not a preference.
  const switchFit = useCallback(
    (image: Size | null) => setFitOverride(fitOverride ? null : otherFit(settings.pageFit, image, { width, height: pageHeight })),
    [fitOverride, settings.pageFit, width, pageHeight],
  );

  const startIndex = Math.max(0, Math.min(pages.length - 1, start === 'last' ? pages.length - 1 : start));
  const [currentPage, setCurrentPage] = useState(startIndex);
  const currentRef = useRef(startIndex);
  // Pairing is fixed for a pager's lifetime (see PagedReader's `double`), so a layout change —
  // the setting, the shift, or a rotation under `auto` — remounts it on the page being read. The
  // mode is in it so the reader a switch brings up opens on that page too.
  const pagerLayout = `${settings.mode}:${double}:${shift}`;
  const [pagerMount, setPagerMount] = useState({ layout: pagerLayout, page: startIndex });
  if (pagerMount.layout !== pagerLayout) setPagerMount({ layout: pagerLayout, page: currentPage });
  // Whether the mounted list has REPORTED a position yet. A recording answered how much this
  // signal is worth: it lands within ~10ms of mount — it is the list's JS-side position map
  // speaking, NOT the native scroll view. For a non-zero `initialScrollIndex` the NATIVE
  // contentOffset applies asynchronously, and until it does the viewport sits over index 0's
  // empty slot (cells are laid out at `index × width`; nothing is rendered down there) — frames
  // that are invisible to JS and to the frame trace alike, which is why every earlier recording
  // of the blank looked perfectly clean. So the POSTER below outlives this report: it stands in
  // for the target page through the whole ENTRANCE (`entering`), which comfortably covers the
  // native offset landing, and only then defers to the report. Index 0 needs no offset — the
  // exact reason "the first tile opens smoothly" was the isolating observation.
  const [parked, setParked] = useState(false);
  const setCurrent = useCallback((i: number) => {
    currentRef.current = i;
    setCurrentPage(i);
    setParked(true);
  }, []);
  useEffect(() => {
    if (parked) traceJS('pager', 'parked', { at: currentRef.current });
  }, [parked]);
  // The backstop: nothing may strand a static image over a live pager — not a list that never
  // reports, and not an entrance whose settle signal is lost. A finger on the list takes it down
  // at once too: the poster is a picture of the list at rest, and must never sit still over one
  // being dragged or pinched.
  const [posterExpired, setPosterExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPosterExpired(true), POSTER_BACKSTOP_MS);
    return () => clearTimeout(t);
  }, []);
  const dropPoster = useCallback(() => setPosterExpired(true), []);
  const handleZoom = useCallback(
    (zoomed: boolean) => {
      if (zoomed) dropPoster();
      onZoomChange(zoomed);
    },
    [dropPoster, onZoomChange],
  );
  // The list's own word that it is showing its cells (see PagedReader's `onReady`): a page it has
  // loaded before then is still nothing on screen.
  const [listReady, setListReady] = useState(false);
  const onListReady = useCallback(() => setListReady(true), []);

  const pagedRef = useRef<PagedReaderHandle>(null);
  const webtoonRef = useRef<WebtoonReaderHandle>(null);
  const items: ReaderPageItem[] = useMemo(
    () => pages.map((uri, i) => ({ uri, key: `${chapterId ?? DIRECT_CHAPTER_ID}:${i}`, pageNumber: i + 1 })),
    [pages, chapterId],
  );

  // ── Stitched flat list (chaptered) ─────────────────────────────────────────
  // Declared early (a noop until the record section below fills it) so the flat handlers can
  // flush the outgoing chapter's progress at a crossing.
  const recordRef = useRef<(flush?: boolean) => void>(() => {});
  const stitched = segments.length > 0;
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
  // The start page's place in the list the pager was given.
  const startAt = useMemo(() => {
    const list = stitched ? flatItems : items;
    const base = stitched ? prefixLen : 0;
    return { list, base, at: Math.max(0, Math.min(list.length - 1, base + startIndex)) };
  }, [stitched, flatItems, items, prefixLen, startIndex]);
  // Sizes that land, under the poster, for the start page and the one after it: the two whose
  // shapes can re-pair the spread it opens on. The pager re-pairs on them the moment they arrive
  // (sizes BEHIND its anchor it holds back — see useSpreadLayout — so those two are the whole
  // story), and the poster's pairing is computed from the same cache at mount and nothing after, so
  // a first page found wide on load had the pager draw it full width under a poster still showing
  // it in the cover's half-width slot. Fed through here, the poster re-pairs on the same commit.
  const [landedSizes, setLandedSizes] = useState<ReadonlyMap<string, Size>>(() => new Map());
  // Every picture the list has loaded around the start (a spread's other half may sit before it):
  // what says the start is drawn, and what the poster lays itself out from. Kept apart from the
  // pairing sizes above, which must not learn of a page behind the anchor.
  const [drawnSizes, setDrawnSizes] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const [handedOver, setHandedOver] = useState(false);
  const onPageSize = useCallback(
    (key: string, size: Size) => {
      detectPageSize(key, size);
      if (posterExpired || handedOver) return;
      const { list, at } = startAt;
      if (!list.slice(Math.max(0, at - 1), at + POSTER_COLUMN_ROWS).some((p) => p.key === key)) return;
      setDrawnSizes((prev) => (prev.get(key) ? prev : new Map(prev).set(key, size)));
      if (double && (list[at]?.key === key || list[at + 1]?.key === key)) {
        setLandedSizes((prev) => (prev.get(key) ? prev : new Map(prev).set(key, size)));
      }
    },
    [detectPageSize, posterExpired, handedOver, double, startAt],
  );
  // What the reader opens on: the start page, or the spread holding it, paired from the same size
  // cache the pager seeds its own pairing from at mount, so the poster draws what the list will.
  const startSpread = useMemo(() => {
    const { list, base, at } = startAt;
    if (!list.length) return null;
    if (!double) return { halves: [list[at]!], first: startIndex, last: startIndex };
    const { spreads, spreadOf } = buildSpreads(list, (p) => landedSizes.get(p.key) ?? knownPageSize(p.uri), shift);
    const spread = spreads[spreadOf[at]!]!;
    return {
      halves: spreadHalves(spread),
      first: spread.first - base,
      last: spread.first - base + spread.pages.length - 1,
    };
  }, [startAt, startIndex, double, shift, landedSizes]);
  // How the list under the poster lays out where it opens, and the pages it shows there.
  const posterLayout: PosterLayout =
    settings.mode === 'paged' ? 'page' : webtoonFit(settings.pageFit) === 'fit-page' ? 'contain' : 'column';
  const posterPages = useMemo(
    () =>
      !startSpread
        ? []
        : posterLayout === 'column'
          ? startAt.list.slice(startAt.at, startAt.at + POSTER_COLUMN_ROWS)
          : startSpread.halves,
    [startSpread, posterLayout, startAt],
  );
  const posterSize = useCallback((p: ReaderPageItem) => drawnSizes.get(p.key) ?? knownPageSize(p.uri), [drawnSizes]);
  // Whether the list has loaded every picture the poster covers on screen. A column's rows count
  // until they fill the screen; one not loaded yet has no height to fill it with.
  const startDrawn = useMemo(() => {
    if (!posterPages.length) return false;
    if (posterLayout !== 'column') return posterPages.every((p) => !p || drawnSizes.has(p.key));
    let y = 0;
    for (const p of posterPages) {
      const size = p && drawnSizes.get(p.key);
      if (!size) return false;
      y += (width * size.height) / size.width;
      if (y >= pageHeight) return true;
    }
    return true;
  }, [posterPages, posterLayout, drawnSizes, width, pageHeight]);
  // The hand-over: once the list is showing its cells and has the start loaded, the poster stays
  // for the fade those pictures come in on, then leaves over a list drawing the same thing.
  useEffect(() => {
    if (!listReady || !startDrawn || handedOver) return;
    const t = setTimeout(() => setHandedOver(true), POSTER_SETTLE_MS);
    return () => clearTimeout(t);
  }, [listReady, startDrawn, handedOver]);
  // The poster's whole life, in one place: down the moment the user actually pages away from the
  // start or puts a finger on the list (a swipe mid-entrance must not freeze under a static image),
  // else up until the entrance has finished, the list has reported, and the list is DRAWING the
  // start — or the backstop calls time. The position report comes ~10ms after mount, long before
  // the list shows its cells or their pictures are in, and a poster that left on it uncovered a
  // blank list in the middle of the open's zoom. A spread can report either of its pages (see
  // `reportedPage`), so "the start" is the whole spread.
  //
  // Never on web. What it papers over is the native offset transient, and the web pager has none:
  // its track is positioned synchronously. It only ever showed there as a defect — the web pager
  // reports no page at mount, so `parked` never flips and the poster outlived the backstop, drawn
  // as a contain picture over a page the pager had meanwhile re-paired (a wide first page, found
  // wide only on load) and rested at fit-height: two pictures of the page, one over the other.
  const posterUp =
    !IS_WEB &&
    !!startSpread &&
    currentPage >= startSpread.first &&
    currentPage <= startSpread.last &&
    !posterExpired &&
    (entering || !parked || !handedOver);
  // Where the chapter being scrubbed STARTS, latched for the duration of the drag — the reader's
  // half of the navigator's latched frame. A drag is resolved against the window it began in, and
  // `prefixLen` is not that: it moves when a neighbouring chapter joins at the head, and again on
  // every relabel. A ref rather than state because reading it must not wait for a render, and
  // nothing renders off it. Declared HERE, above every callback that reads it — the React Compiler
  // will not accept a ref being modified when its binding is used before this point.
  const scrubPrefixRef = useRef<number | null>(null);
  // The write in its own `[]` callback: the shape `setCurrent` uses, and the one the compiler
  // accepts a ref being modified in.
  const setScrubFrame = useCallback((prefix: number | null) => {
    scrubPrefixRef.current = prefix;
  }, []);

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
      // NOT WHILE A SCRUB IS IN PROGRESS. A relabel changes which chapter is current, and with it
      // `prefixLen`, `pages` and the run's window — the frame the drag is being resolved in. Landing
      // one mid-drag doesn't just move the target: the shifted frame moves the pager, which crosses
      // another boundary, which relabels again. A recording of the bug shows ten of them and the
      // window growing from four segments to thirteen while a single finger was down.
      //
      // Nothing is lost by waiting. The track spans only the current chapter (see `scrubTotal`), so
      // a scrub has no business crossing a boundary at all, and the release commits explicitly
      // through `seekTo`; anything genuinely across one is reported again by the settle after it.
      if (scrubPrefixRef.current !== null) return;
      recordRef.current(true); // the outgoing chapter's final settled position
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

  // The same resolution as `shown`, but carrying the CHAPTER the visible page belongs to — what a
  // per-page action (the toolbar's collect heart) has to key off. Taking `chapterId` unconditionally
  // is the trap: mid-crossing in stitched paged mode the page on screen belongs to a neighbouring
  // segment, so a page collected there would be filed under the wrong chapter and reopen on the
  // wrong page later.
  const shownWithChapter = useMemo(() => {
    const v = stitched && visibleSeg && segments.some((s) => s.id === visibleSeg.id) ? visibleSeg : null;
    return {
      pageIndex: v?.page ?? currentPage,
      chapterId: v?.id ?? chapterId ?? DIRECT_CHAPTER_ID,
    };
  }, [stitched, visibleSeg, segments, currentPage, chapterId]);

  useEffect(() => {
    onVisiblePage?.(shownWithChapter);
  }, [onVisiblePage, shownWithChapter]);

  // The spread around the visible page, held against its chapter rather than as flat indices, which
  // move whenever a chapter joins the window's head. Shown only while it still holds the page `shown`
  // names — a jump names its page before the pager has paired around it.
  const [shownSpread, setShownSpread] = useState<{ id: string; first: number; last: number } | null>(null);
  const handleVisibleSpread = useCallback(
    (first: number, last: number) => {
      const loc = stitched ? locateFlat(first) : { segment: { id: chapterId ?? DIRECT_CHAPTER_ID }, page: first };
      if (loc) setShownSpread({ id: loc.segment.id, first: loc.page, last: loc.page + last - first });
    },
    [stitched, chapterId, locateFlat],
  );
  const shownRange = useMemo(() => {
    const s = settings.mode === 'paged' ? shownSpread : null;
    const { pageIndex, chapterId: id } = shownWithChapter;
    if (!s || s.id !== id || s.last === s.first || pageIndex < s.first || pageIndex > s.last) return undefined;
    return spreadRangeLabel(s.first, s.last, settings.direction === 'rtl');
  }, [settings.mode, settings.direction, shownSpread, shownWithChapter]);

  // Move to a FLAT index — an index into the window, whichever reader is mounted. Both take the
  // same coordinate now that both are stitched.
  const goFlat = useCallback(
    (flat: number, animated: boolean) => {
      if (settings.mode === 'paged') pagedRef.current?.goToPage(flat, animated);
      else webtoonRef.current?.goToPage(flat, animated);
    },
    [settings.mode],
  );
  // Chapter-local page index in; the stitched readers take the flat one.
  const goTo = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      setCurrent(clamped);
      goFlat(stitched ? prefixLen + clamped : clamped, animated);
    },
    [pages, setCurrent, stitched, prefixLen, goFlat],
  );
  // The details card's page-thumbnail taps jump the mounted pane directly (see openPageFromDetails).
  const pagesOnScreen = useCallback(
    (segmentId: string, page: number) => {
      let base = 0;
      if (stitched) for (const s of segments) {
        if (s.id === segmentId) break;
        base += s.pages.length;
      }
      const spread = settings.mode === 'paged' ? pagedRef.current?.spreadOf(base + page) : undefined;
      const pages = [];
      for (let i = spread ? spread.first - base : page; i <= (spread ? spread.last - base : page); i++) pages.push(i);
      return { pages, rtl: settings.direction === 'rtl' };
    },
    [stitched, segments, settings.mode, settings.direction],
  );
  // Where a scrub release lands: name the landing page immediately (viewability is suppressed
  // during the drag), so the chrome is correct in the same commit.
  const seekTo = useCallback(
    (index: number) => {
      // Resolved in the frame the DRAG began in, not whatever the window has become since — see
      // `scrubPrefixRef`. `handleScrubbing(false)` runs after this (the gesture emits the seek
      // first), so the latch is still held here.
      const base = scrubPrefixRef.current ?? prefixLen;
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      // Where the release actually lands, in the reader's own coordinates — the other half of the
      // navigator's `scrub release` line. `local` past `of` means the track was calibrated to a
      // different chapter than the one being committed to; `base` against the grab's `offset` says
      // whether the frame held for the length of the drag.
      traceJS('seek', 'commit', { local: index, of: pages.length, base, flat: stitched ? base + clamped : clamped });
      setCurrent(clamped);
      goFlat(stitched ? base + clamped : clamped, true);
      if (stitched) handleFlatVisiblePage(base + clamped);
    },
    [stitched, prefixLen, pages.length, setCurrent, goFlat, handleFlatVisiblePage],
  );
  // The chapter-local pages sharing the screen with `page`. A turn steps off the spread's ends:
  // stepping off the page last reported would land on the other half of the same spread whenever
  // the report hasn't caught up with a quick run of taps.
  const spreadAround = useCallback(
    (page: number) => {
      const base = stitched ? prefixLen : 0;
      const spread = settings.mode === 'paged' ? pagedRef.current?.spreadOf(base + page) : undefined;
      return spread ? { first: spread.first - base, last: spread.last - base } : { first: page, last: page };
    },
    [settings.mode, stitched, prefixLen],
  );
  // Boundary page-turns: prefer stepping within the stitched flat list (the same seamless relabel
  // path a swipe crossing takes); the explicit-jump fallback only covers a cold window (adjacent
  // pages not loaded yet) and the unstitched direct/sequence reads.
  const turnPrev = useCallback(() => {
    const { first } = spreadAround(currentRef.current);
    if (first > 0) {
      goTo(first - 1, false);
      return;
    }
    if (stitched && prefixLen > 0) {
      handleFlatPageChange(prefixLen - 1);
      goFlat(prefixLen - 1, false);
      return;
    }
    if (chaptered && hasPrevChapter) onCrossChapter(-1);
  }, [spreadAround, goTo, stitched, prefixLen, handleFlatPageChange, goFlat, chaptered, hasPrevChapter, onCrossChapter]);
  const turnNext = useCallback(() => {
    const { last } = spreadAround(currentRef.current);
    if (last < pages.length - 1) {
      // Named by the page the landing spread will report, so the counter doesn't step through its
      // first page on the way.
      goTo(spreadAround(last + 1).last, false);
      return;
    }
    const nextFlat = prefixLen + pages.length;
    if (stitched && nextFlat < flatItems.length) {
      handleFlatPageChange(nextFlat);
      goFlat(nextFlat, false);
      return;
    }
    if (chaptered && hasNextChapter) onCrossChapter(1);
  }, [
    spreadAround,
    goTo,
    stitched,
    prefixLen,
    pages,
    flatItems.length,
    handleFlatPageChange,
    goFlat,
    chaptered,
    hasNextChapter,
    onCrossChapter,
  ]);
  const atLastPage = useCallback(() => currentRef.current >= pages.length - 1, [pages]);
  // Is the chapter on either side already IN the window? That is what decides whether a boundary is
  // something to scroll across or something to ask for.
  const prevStitched = stitched && prefixLen > 0;
  const nextStitched = stitched && prefixLen + pages.length < flatItems.length;

  // ── Scrubber (UI-thread throughout; offset 0 — nothing stitched) ───────────
  const scrubFlat = useSharedValue(-1);
  const [scrubbing, setScrubbing] = useState(false);
  const handleScrubbing = useCallback(
    (active: boolean) => {
      // Latched here rather than in an effect because THIS is the moment: the navigator reports the
      // hold exactly once per drag, at touch-down, which is the last instant `prefixLen` still
      // describes the chapter the drag is aimed at. An effect would latch a commit later, by which
      // point the window may already have moved — and moving is precisely what it does.
      setScrubFrame(active ? prefixLen : null);
      setScrubbing(active);
      onScrubActive(active);
    },
    [onScrubActive, prefixLen, setScrubFrame],
  );
  const scrubTo = useCallback(
    (position: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, position));
      // The frame the drag began in — see `scrubPrefixRef`.
      const base = scrubPrefixRef.current ?? prefixLen;
      if (settings.mode === 'paged') pagedRef.current?.scrubTo(stitched ? base + clamped : clamped);
      else goFlat(stitched ? base + Math.round(clamped) : Math.round(clamped), false);
    },
    [pages, settings.mode, stitched, prefixLen, goFlat],
  );

  // ── Warm-ahead ──
  // Over the whole STITCHED window, not just this chapter. The pages either side of a boundary
  // belong to two different chapters, so a chapter-local warm window stops dead at page 1 — and
  // the page immediately behind page 1, the previous chapter's last, is precisely the one a
  // backward swipe lands on. Warming the flat strip is what makes that turn arrive on an image
  // instead of on a placeholder, the same as any other page turn.
  const warmAround = useCallback(
    (index: number) => {
      const at = stitched ? prefixLen + index : index;
      const from = Math.max(0, at - WARM_BEHIND);
      // "Preload ahead" counts screens, and a spread is two pages.
      const to = at + 1 + settings.prefetchAhead * (double ? 2 : 1);
      warmPageImages(stitched ? flatItems.slice(from, to).map((item) => item.uri) : pages.slice(from, to));
    },
    [pages, stitched, flatItems, prefixLen, settings.prefetchAhead, double],
  );
  // Warm where the reader COMES TO REST — see WARM_IDLE_MS. Both callers go through this: the page
  // the reader has settled on, and the scrubber's live position as it is dragged.
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmSoon = useCallback(
    (index: number) => {
      if (warmTimer.current) clearTimeout(warmTimer.current);
      warmTimer.current = setTimeout(() => warmAround(index), WARM_IDLE_MS);
    },
    [warmAround],
  );
  useEffect(
    () => () => {
      if (warmTimer.current) clearTimeout(warmTimer.current);
    },
    [],
  );

  useEffect(() => {
    // Standby (the collapsed strip) loads nothing beyond the visible page; the flip back to
    // active re-runs this and warms the neighbourhood.
    if (!standby && pages.length) warmSoon(currentPage);
  }, [standby, pages, currentPage, warmSoon]);

  // ── Progress recording: every chaptered read records chapter progress. Outside the library the
  // reading log is written FIRST: its row is the series' history entry and resume point, and only
  // this call carries the title and cover to create it. A direct series records under the
  // DIRECT_CHAPTER_ID sentinel. Unknown membership writes both — the host ignores a log
  // write for a library series, and waiting on the answer dropped reads whenever the check failed. ──
  //
  // A read is a page TURNED, not a pane mounted. This pane sits behind the details page as a
  // decorative strip from the moment a series opens, so recording on mount wrote a resume point —
  // and a "started" state — for every series merely looked at. Armed by the first page change
  // while the reader is actually open, and never disarmed: a stitched crossing relabels in place,
  // so a read that carried into the next chapter stays a read there. A one-page chapter has nothing
  // to turn, so opening it full screen is its read.
  const engagedRef = useRef(false);
  const seenPageRef = useRef(currentPage);
  useEffect(() => {
    if (picked || (!standby && (currentPage !== seenPageRef.current || pages.length === 1))) engagedRef.current = true;
    seenPageRef.current = currentPage;
  }, [currentPage, standby, pages.length, picked]);
  //
  // A page turn changes ONE history row, so the cached history list is patched in place rather than
  // refetched: on-device every library-store call waits in one queue, and a full history read is a
  // scan of every series plus a progress read per read series. Invalidating it (and the activity
  // feed) after every settle queued hundreds of reads per page turn, behind which the next progress
  // write sat for 10s+. The full refresh still happens where the shape of things changes — a chapter
  // finished (feed items leave it), a chapter left (`flush`) — and when the row isn't cached yet, so
  // the host decides whether this bridge's reads belong in history at all.
  const progressEntry = useCallback(() => {
    if (!recordProgress || !engagedRef.current) return null;
    if (!bridgeId || !seriesId || !pages.length) return null;
    return {
      bridgeId,
      seriesId,
      title: seriesTitle,
      ...(seriesCover ? { thumbnailUrl: seriesCover } : {}),
      chapterId: chapterId ?? DIRECT_CHAPTER_ID,
      ...(chapterName ? { chapterName } : {}),
      lastPage: currentRef.current,
      pageCount: pages.length,
    };
  }, [recordProgress, bridgeId, seriesId, pages, chapterId, chapterName, seriesTitle, seriesCover]);
  // Patched ahead of the write as well as after it: the series page's strip reads this row, and on a
  // closing reader it has to move before the zoom lands, not once the queue gets round to the write.
  // The patch after the write stays, so a refetch that raced the write can't leave the row behind.
  const showRow = useCallback(
    (row: HistoryEntry) => {
      const key = queryKeys.history(mock);
      const same = (h: HistoryEntry) => h.bridgeId === row.bridgeId && h.seriesId === row.seriesId;
      const known = queryClient.getQueryData<HistoryEntry[]>(key)?.some(same) ?? false;
      if (known) queryClient.setQueryData<HistoryEntry[]>(key, (cur) => (cur ? [row, ...cur.filter((h) => !same(h))] : cur));
      return known;
    },
    [mock, queryClient],
  );
  const showProgress = useCallback(() => {
    const entry = progressEntry();
    if (entry) showRow({ ...entry, lastReadAt: Date.now() });
  }, [progressEntry, showRow]);
  const record = useCallback((flush = false) => {
    const entry = progressEntry();
    if (!entry) return;
    const { bridgeId, seriesId, lastPage, pageCount } = entry;
    const reachedEnd = lastPage >= pageCount - 1;
    const row: HistoryEntry = { ...entry, lastReadAt: Date.now() };
    showRow(row);
    const invalidateHistory = () => {
      const key = queryKeys.history(mock);
      const known = showRow(row);
      if (!known || flush || reachedEnd) {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: queryKeys.activity(mock) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.activityCount(mock) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapterProgress(mock, bridgeId, seriesId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.librarySeries(mock, bridgeId, seriesId) });
    };
    const recordChapter = (id: string) =>
      ds.recordChapterProgress(bridgeId, seriesId, id, {
        lastPage,
        pageCount,
        ...(chapterName ? { chapterName } : {}),
      });
    // A direct series' page goes through chapter progress too, under the sentinel: the log write is
    // ignored once the series is collected, and progress is the only thing that moves its resume point.
    const progressId = entry.chapterId;
    if (inLibrary) {
      void recordChapter(progressId).then(invalidateHistory).catch(() => {});
      return;
    }
    void ds
      .recordReadingHistory(entry)
      .catch(() => {})
      .then(() => recordChapter(progressId))
      .then(invalidateHistory)
      .catch(() => {});
  }, [progressEntry, showRow, inLibrary, chapterName, ds, mock, queryClient]);
  // recordRef itself is declared up with the stitched mappings (the flat crossing flushes through
  // it); this keeps it pointing at the latest closure.
  useEffect(() => {
    recordRef.current = record;
  }, [record]);
  // Debounced on page settle + flushed on teardown (leaving the screen AND chapter swaps — the pane
  // is keyed by chapter).
  useEffect(() => {
    const t = setTimeout(() => recordRef.current(), 1500);
    return () => clearTimeout(t);
  }, [currentPage]);
  useEffect(() => () => recordRef.current(true), []);
  useImperativeHandle(ref, () => ({ goTo, pagesOnScreen, showProgress }), [goTo, pagesOnScreen, showProgress]);

  // ── Web keyboard nav ─────────────────────────────────────────────────────────
  // Boxed: the screen hands this down as a fresh arrow every render, and re-subscribing the keys
  // would drop a Q/E zoom being held.
  const skipChapterRef = useRef(onSkipChapter);
  useEffect(() => {
    skipChapterRef.current = onSkipChapter;
  });
  useEffect(() => {
    if (!IS_WEB || !keyboard || typeof window === 'undefined') return;
    const zoomHold = createZoomHold();
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Modifiers are exact (lib/keymap), so Alt+Left stays the desktop shell's Back and Ctrl/⌘
      // +/-/0 the browser's own zoom; bare, they're the page's (see desktop-zoom).
      const zoomDir = zoomHoldDirection(e);
      if (zoomDir) {
        e.preventDefault();
        zoomHold.press(e.key, zoomDir, e.repeat);
        return;
      }
      const step = keyActionOf(e, STEP_KEYS);
      if (step) {
        if (standby || isControlTarget(e.target)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (step === 'page-next') return turnNext();
        if (step === 'page-prev') return turnPrev();
        const forward = (step === 'chapter-next') !== (settings.mode === 'paged' && settings.direction === 'rtl');
        if (chaptered && (forward ? hasNextChapter : hasPrevChapter)) skipChapterRef.current(forward ? 1 : -1);
        return;
      }
      const action = keyActionOf(e, READER_KEYS);
      if (!action) return;
      e.preventDefault();
      if (action === 'zoom-reset') return resetZoom();
      if (action === 'zoom-step-in' || action === 'zoom-step-out') {
        return stepZoom(action === 'zoom-step-in' ? 1 : -1, { speed: keyZoomSpeed() });
      }
      if (e.repeat) return;
      const forward = (action === 'right') !== (settings.direction === 'rtl');
      (forward ? turnNext : turnPrev)();
    };
    const onKeyUp = (e: KeyboardEvent) => zoomHold.release(e.key);
    const onBlur = () => zoomHold.clear();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      zoomHold.dispose();
    };
  }, [keyboard, standby, turnNext, turnPrev, settings.mode, settings.direction, chaptered, hasNextChapter, hasPrevChapter]);

  return (
    <>
      {settings.keepAwake && !standby && <KeepScreenAwake />}
      {/* The page subtree. */}
      <Animated.View testID="series-page.page-wrap" style={styles.pageWrap}>
      {/* The pages' own frame, inset from the screen's when safe areas are respected (see
          `pageHeight`); the poster sits in this same frame so the two draw alike. */}
      <View style={{ width, height: pageHeight, marginTop: insetTop }}>
      {settings.mode === 'paged' ? (
        <PagedReader
          key={pagerMount.layout}
          ref={pagedRef}
          // Stitched: the whole window as ONE flat pager, so a boundary swipe is an ordinary page
          // turn (position reports come back flat and get located/relabeled above).
          pages={stitched ? flatItems : items}
          width={width}
          height={pageHeight}
          rtl={settings.direction === 'rtl'}
          pageFit={pageFit}
          doubleTap={settings.doubleTap}
          onSwitchFit={switchFit}
          initialPage={stitched ? prefixLen + pagerMount.page : pagerMount.page}
          double={double}
          shift={shift}
          onPageSize={onPageSize}
          onReady={onListReady}
          onDragBegin={dropPoster}
          onPageChange={stitched ? handleFlatPageChange : setCurrent}
          // Keep the counter live during fast flicks — against the segment the page belongs to
          // when stitched (a crossing must count against the chapter being entered).
          onVisiblePageChange={stitched ? handleFlatVisiblePage : setCurrent}
          onVisibleSpreadChange={handleVisibleSpread}
          scrubTarget={scrubFlat}
          scrubbing={scrubbing}
          standby={standby}
          onPrev={turnPrev}
          onNext={turnNext}
          onToggleChrome={onToggleChrome}
          onZoomChange={handleZoom}
        />
      ) : (
        <WebtoonReader
          ref={webtoonRef}
          // The same stitched window the pager gets: scrolling off either end of a chapter simply
          // continues into the next one, with the page you are heading for already under the
          // scroll rather than arriving after a jump.
          pages={stitched ? flatItems : items}
          width={width}
          height={pageHeight}
          pageFit={settings.pageFit}
          // Webtoon has no axis to switch, so its double-tap is the magnification or nothing.
          doubleTapZoom={settings.doubleTap === 'magnify'}
          initialPage={stitched ? prefixLen + pagerMount.page : pagerMount.page}
          onPageChange={stitched ? handleFlatPageChange : setCurrent}
          // The live half, the same one the pager has always had: the chrome counts along with the
          // page going past instead of waiting for the scroll to come to rest.
          onVisiblePageChange={stitched ? handleFlatVisiblePage : setCurrent}
          onToggleChrome={onToggleChrome}
          onZoomChange={handleZoom}
          onPageSize={onPageSize}
          onReady={onListReady}
          onDragBegin={dropPoster}
          standby={standby}
          // Every one of these is a FALLBACK for a window that came up short, and each stands down
          // where the window already reaches the chapter in question — a sentinel to tap, an
          // auto-advance and a backward pull are all ways of asking for a chapter you cannot simply
          // scroll to, and scrolling to it is strictly better.
          nextChapterName={chaptered && !nextStitched ? nextChapterName : undefined}
          onGoBack={chaptered && hasPrevChapter && !prevStitched ? () => onCrossChapter(-1) : undefined}
          onAdvance={chaptered && hasNextChapter && !nextStitched ? () => onCrossChapter(1) : undefined}
          onEndReached={
            chaptered && hasNextChapter && !nextStitched
              ? () => {
                  if (atLastPage()) onCrossChapter(1);
                }
              : undefined
          }
        />
      )}
      {/* THE INITIAL-POSITION POSTER — where the reader opens, over the list until the list is
          drawing it (see `posterUp` above), laid out exactly as the list lays it out, so its
          appearance and its removal are both invisible. What it papers over is everything before
          that: a list that draws nothing until its initial scroll has landed, and pages still
          loading under an open that zooms into them. */}
      {posterUp && (
        <StartPoster
          layout={posterLayout}
          pages={posterPages}
          sizeOf={posterSize}
          width={width}
          height={pageHeight}
          pageFit={settings.mode === 'paged' ? pageFit : settings.pageFit}
          rtl={settings.direction === 'rtl'}
          standby={!!standby}
        />
      )}
      </View>
      </Animated.View>

      {/* Tint/fade layers over the pages, under the chrome below. */}
      {overlay}

      {/* Bottom chrome — sits still while the page travels. */}
      <Animated.View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {IS_WEB ? (
        <ProgressPill
          current={shown.page}
          label={shownRange}
          total={shown.total}
          visible={chromeVisible}
          countWhenHidden={settings.pageCountWhenHidden}
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
          pageLabel={shownRange}
          total={shown.total}
          rtl={settings.mode === 'paged' && settings.direction === 'rtl'}
          visible={chromeVisible}
          countWhenHidden={settings.pageCountWhenHidden}
          chaptered={chaptered}
          hasPrevChapter={hasPrevChapter}
          hasNextChapter={hasNextChapter}
          onPrevChapter={() => onSkipChapter(-1)}
          onNextChapter={() => onSkipChapter(1)}
          onScrub={scrubTo}
          scrubTarget={settings.mode === 'paged' ? scrubFlat : undefined}
          offset={stitched ? prefixLen : 0}
          // The chapter being READ — the same one `offset` and `onSeek` speak. `total` above is
          // whatever the pill is counting, which mid-crossing is the neighbour. See `scrubTotal`.
          scrubTotal={pages.length}
          onSeek={seekTo}
          onScrubbingChange={handleScrubbing}
          onScrubPage={warmSoon}
          glass={glass}
        />
      )}
      </Animated.View>
    </>
  );
});

const styles = StyleSheet.create({
  pageWrap: {
    flex: 1,
  },
});
