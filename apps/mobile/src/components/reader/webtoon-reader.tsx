import type { LegendListRef, ViewToken } from '@legendapp/list/react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { ReaderPageItem } from '@/components/reader/paged-reader';
import { ReaderPage, STANDBY_FADE_MS } from '@/components/reader/reader-page';
import { useZoomable } from '@/components/reader/use-zoomable';
import type { PageFit } from '@/hooks/use-reader-settings';
import { BACK_ACTIVATE_DOMINANCE } from '@/lib/back-swipe';
import { releaseCommitted } from '@/lib/gesture-release';
import { trace, traceJS } from '@/lib/gesture-trace';
import { testId } from '@/lib/test-id';

/** `animated` defaults to true (a jump). The reader's page scrubber passes false: rows here have
 *  variable heights, so a scrub can't land between pages the way the paged reader does — it steps
 *  to the nearest page instead, and an animation per drag frame would fight the finger. */
export type WebtoonReaderHandle = { goToPage: (index: number, animated?: boolean) => void };

type Props = {
  /** The pages to show — the STITCHED WINDOW where there is one (several chapters' pages in one
   *  list, exactly as the horizontal pager takes them), else just this chapter's. Each item carries
   *  its own per-chapter page number, because a flat index stops meaning "page N" the moment more
   *  than one chapter is in here. */
  pages: ReaderPageItem[];
  width: number;
  /** Viewport height — only used by the `'fit-page'` paginated variant, to
   *  size each row to exactly one screen. */
  height: number;
  pageFit: PageFit;
  initialPage: number;
  onPageChange: (index: number) => void;
  onToggleChrome: () => void;
  /** Fires when the webtoon viewport's pinch-zoom flips — the reader disables its
   *  swipe-away gesture while zoomed (a one-finger drag pans then). */
  onZoomChange?: (zoomed: boolean) => void;
  /** Fires as the list nears its end. The caller still checks whether the
   *  current page is actually the last one before acting on it — a short
   *  chapter can otherwise fire this before it's been scrolled through. */
  onEndReached?: () => void;
  /** Display name of the next chapter in reading order, if any. When set, the
   *  continuous reader shows a tappable "Next: … →" sentinel at the end. */
  nextChapterName?: string;
  /** Advance to the next chapter — fired by tapping the sentinel or by scrolling
   *  to the very end of the continuous list. Reliable in continuous mode where
   *  viewability-based page tracking makes `onEndReached`+last-page fragile. */
  onAdvance?: () => void;
  /** Cross BACKWARD, to the previous chapter's last page — fired by pulling down at the very top
   *  of the chapter (see `useBackPull`). Undefined where there is nothing behind this chapter, AND
   *  undefined where the chapter behind it is already in the window: there, scrolling up simply
   *  reaches it, which is the whole point of stitching and a great deal better than a jump.
   *
   *  Vertical mode has no stitched window to turn a page into, so a boundary here is always a jump;
   *  what it was missing was any way to ASK for the backward one. Scrolling up at page 1 did what a
   *  wall does, because at the top of a scroll view there is nothing left to scroll: iOS reports a
   *  rubber-band and Android reports nothing at all. Hence a gesture rather than a scroll position
   *  — and a gesture rather than a transition page, which is somewhere to scroll but also a screen
   *  of nothing to look at, every time you cross. */
  onGoBack?: () => void;
  /** True while this reader is the series page's decorative STRIP rather than the thing being
   *  read. Only effect: its standing page cross-fades in (see ReaderPage's `fadeMs`) instead of
   *  appearing — the paged reader also uses it to shrink its render window, which a webtoon list
   *  doesn't need (its rows are already virtualized by proximity). */
  standby?: boolean;
};

// Height/width ratio assumed for a page before it has rendered (matches ReaderPage's own
// DEFAULT_ASPECT) — the continuous strip's `estimatedItemSize`. Only the opening guess: the list
// replaces it per row with the measured height as each image lands, and holds the viewport still
// while it does. It used to be refined here too, by a running average kept alongside a table of
// measured heights; that whole apparatus was standing in for a list that could measure.
const ESTIMATED_ASPECT = 3 / 2;

/** Module-level so they're stable without a hook (and so nothing has to read a ref during render to
 *  keep them that way).
 *
 *  The two are measured DIFFERENTLY, and the continuous one has to be. `itemVisiblePercentThreshold`
 *  asks what fraction of the ITEM is on screen — which a webtoon page can fail forever: a page three
 *  screens tall is never 50% visible, no matter where you stand in it, so the row you are actually
 *  reading is never reported and the page counter sticks on whichever short row last qualified.
 *  `viewAreaCoveragePercentThreshold` asks the question that fits a strip of arbitrarily tall rows —
 *  what is covering the screen — and a fully-visible short row still counts either way.
 *
 *  The paginated variant has no such problem (every row is exactly one viewport) and keeps the
 *  horizontal pager's 60%. */
const VIEWABILITY_CONTINUOUS = { viewAreaCoveragePercentThreshold: 50 };
const VIEWABILITY_PAGED = { itemVisiblePercentThreshold: 60 };

// How close (px) to the bottom of the continuous list the scroll must get before
// the next chapter auto-loads — roughly where the end-of-chapter sentinel enters view.
const ADVANCE_TRIGGER_PX = 120;

// ── Pull past the top to go back a chapter ───────────────────────────────────────────────────
// The paged reader's off-the-end hand-off, rotated: at the top of a chapter the scroller has
// nothing left to give, so the drag that means "go back" is the one it can only rubber-band.
/** Vertical travel that hands the drag to the pull, at the distance the scroller itself claims at
 *  (see lib/back-swipe for why ten). */
const PULL_ACTIVATE_PX = 10;
/** Horizontal travel that gives it up instead — derived, never dialled on its own. */
const PULL_FAIL_PX = Math.round(PULL_ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);
/** How far down the release has to be HEADED (travel + projected velocity — see lib/gesture-release)
 *  to count as asking for the chapter behind this one. A pull, not a flick: deliberately more than
 *  the reveal fractions elsewhere, because the cost of being wrong is leaving the chapter. */
const PULL_COMMIT_FRACTION = 0.2;
/** How close to the top counts as AT the top. */
const AT_TOP_EPSILON = 2;

/**
 * "Pull down at the top to go back a chapter", for both variants.
 *
 * Latched at touch-down: the drag has to BEGIN at the top of the chapter. That is the whole
 * correctness of it — scrolling up through a chapter and coasting to the top ends there too, and
 * reading the position at release would take every one of those for a request to leave. Nothing
 * fires until the finger lifts, and then only on a release headed far enough down.
 *
 * Composed Simultaneous with the list's own scroll by every caller, so the rubber-band still
 * happens under the finger and this only reads the release — and handed to the pages' own gestures
 * as an external, because a pan on the surface they live on arbitrates against them (the paged
 * reader's double-tap learned this the expensive way).
 */
function useBackPull({
  atTop,
  zoomed,
  height,
  onGoBack,
}: {
  /** Whether the chapter is parked at its top. NOT derived from a scroll offset here, and that is
   *  the bug this parameter exists to have fixed: an offset shared value is only ever as good as
   *  the scroll events that write it, and there are none before the first scroll. A pane that
   *  mounts deep into a chapter — which is EXACTLY what a backward crossing does, landing on the
   *  previous chapter's last page — therefore started life reading "offset 0, so we must be at the
   *  top". Every downward drag from there was a request to leave, and the natural thing to do when
   *  you have just landed at the end of a chapter is drag downward to read back through it. One
   *  crossing became a cascade of them: scroll up, flash, and you are somewhere else entirely.
   *
   *  So the caller seeds it from where the list was TOLD to open and refines it from real scrolls,
   *  which is knowledge that exists at mount rather than knowledge that has to arrive. */
  atTop: SharedValue<boolean>;
  /** UI-thread mirror of the zoom state. A zoomed page owns one-finger drags — and this is a
   *  shared value rather than the render's own boolean because the zoom hook needs THIS gesture to
   *  compose against, so it cannot also be what decides whether it exists. */
  zoomed: SharedValue<boolean>;
  height: number;
  onGoBack?: () => void;
}) {
  const fromTop = useSharedValue(false);
  return useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!onGoBack)
        .maxPointers(1)
        .activeOffsetY([-PULL_ACTIVATE_PX, PULL_ACTIVATE_PX])
        .failOffsetX([-PULL_FAIL_PX, PULL_FAIL_PX])
        .onBegin(() => {
          'worklet';
          fromTop.set(!zoomed.value && atTop.value);
          trace('webtoon.pull', 'begin', { fromTop: fromTop.value, atTop: atTop.value, zoomed: zoomed.value });
        })
        .onEnd((e) => {
          'worklet';
          // Downward only: dragging the content DOWN is asking for what sits above it.
          const committed =
            fromTop.value && e.translationY > 0 && releaseCommitted(e.translationY, e.velocityY, height * PULL_COMMIT_FRACTION);
          trace('webtoon.pull', 'end', {
            fromTop: fromTop.value,
            ty: Math.round(e.translationY),
            vy: Math.round(e.velocityY),
            committed,
          });
          if (committed && onGoBack) runOnJS(onGoBack)();
        }),
    [onGoBack, height, fromTop, atTop, zoomed],
  );
}

/**
 * Vertical webtoon reader — dispatches to one of two genuinely different
 * reading models depending on `pageFit`. Both are LegendLists, and the whole
 * distance between them is what they can say about a row's size: the continuous
 * strip can only ESTIMATE (a page's height isn't known until its image is), so
 * it leans on measurement plus size anchoring to stay still while those
 * estimates are replaced; the paginated variant KNOWS (every row is exactly one
 * viewport), so it fixes the size, snaps like pages, and needs no anchoring at
 * all.
 */
export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(props, ref) {
  return props.pageFit === 'fit-page' ? <WebtoonPaged {...props} ref={ref} /> : <WebtoonContinuous {...props} ref={ref} />;
});

/**
 * Vertical continuous (webtoon) reader: a vertical LegendList of full-width
 * pages. Current page comes from viewability.
 *
 * Row heights are the whole problem here — a page's height isn't known until its
 * image has loaded, so most of a chapter is an estimate at any moment and those
 * estimates are replaced, out of order, as images arrive. The list measures rows
 * itself and holds the visible content still while that happens; a deep entry
 * point (a page-thumbnail tap into the middle of a chapter) lands on estimates
 * and tightens as the rows between are measured, with nothing on screen moving
 * while it does.
 *
 * A per-item tap overlay carries the testID only; chrome/pinch/zoom live on the
 * detector wrapping the list (see `nativeScroll`).
 */
const WebtoonContinuous = forwardRef<WebtoonReaderHandle, Props>(function WebtoonContinuous(
  {
    pages,
    width,
    height,
    initialPage,
    onPageChange,
    onToggleChrome,
    onZoomChange,
    nextChapterName,
    onAdvance,
    onGoBack,
    standby,
  },
  ref,
) {
  const listRef = useRef<LegendListRef>(null);
  // Seeded from where this pane was told to open, then refined by real scrolls — see useBackPull.
  const atTop = useSharedValue(initialPage <= 0);
  const n = pages.length;

  // Pinch / double-tap / pan-while-zoomed for the whole viewport — the same shared
  // primitive the paged reader uses. Zooming scales the current on-screen strip and
  // freezes the scroll (the list is disabled while zoomed, below) so a one-finger
  // drag pans the magnified view; unzoom to resume scrolling. The pan is bounded to
  // the scaled viewport, which is exactly the content that was already on screen (and
  // therefore rendered), so panning never exposes un-virtualized blanks.
  // The list's own scroll, as a gesture RNGH can reason about. Without this the pinch/tap on the
  // wrapping detector never fire — the native ScrollView swallows the touch. The zoom hook is given
  // this AND the back-pull as `simultaneousExternal`, so its gestures run alongside both (a
  // 2-finger pinch, or a stationary tap) instead of losing to whichever claims the touch first.
  const nativeScroll = useMemo(() => Gesture.Native(), []);

  // Declared before the zoom hook, because the zoom hook composes against it. Its own zoom check
  // therefore reads a shared value rather than the render's boolean — see useBackPull.
  const zoomedSV = useSharedValue(false);
  const backPull = useBackPull({ atTop, zoomed: zoomedSV, height, onGoBack });
  const zoomExternals = useMemo(() => [nativeScroll, backPull], [nativeScroll, backPull]);
  // Both of them mounted on the list together.
  const listGesture = useMemo(() => Gesture.Simultaneous(nativeScroll, backPull), [nativeScroll, backPull]);

  // Whole zoom gesture (pinch / double-tap / pan) plus the chrome-toggle single tap,
  // composed by the shared hook. Chrome toggle ignores the tap's x.
  const { gesture, animatedStyle, zoomed } = useZoomable({
    width,
    height,
    onZoomChange,
    onSingleTap: onToggleChrome,
    simultaneousExternal: zoomExternals,
  });

  useEffect(() => {
    zoomedSV.set(zoomed);
  }, [zoomed, zoomedSV]);

  // Unmounting (switching reader modes, leaving the reader) must not leave the parent
  // thinking a zoom is still active — that would keep its swipe-dismiss disabled.
  useEffect(() => () => onZoomChange?.(false), [onZoomChange]);

  // Auto-advance when the reader SCROLLS to the very end (where the sentinel sits).
  //
  // Scrolls to, not "is at" — and the difference is a chapter's worth of navigation. Arriving at
  // the end is not the same as reaching it, and this reader can now arrive there: crossing BACKWARD
  // lands on the previous chapter's last page, which is the bottom of the list, which used to read
  // as "they scrolled to the end, load the next chapter" the instant the pane mounted. It sent you
  // straight back to the chapter you had just left. (Recorded, from a real trace: crossing to the
  // 17-page chapter, mounting its pages 16-17, and 146ms later back on page 1 of the 15-page one.)
  //
  // So it ARMS on being somewhere that isn't the end, and only then can fire. Reading a chapter
  // through arms it on the first scroll event and behaves exactly as before; landing at the end
  // arms nothing until the reader has actually moved away from it.
  //
  // `scrollable` stays: a short chapter that fits on screen shouldn't auto-skip either, and its
  // sentinel is tap-only. `firedRef` keeps it once-per-chapter; both reset when the chapter does.
  const firedRef = useRef(false);
  const armedRef = useRef(false);
  useEffect(() => {
    firedRef.current = false;
    armedRef.current = false;
  }, [pages]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      atTop.set(contentOffset.y <= AT_TOP_EPSILON);
      if (!onAdvance || firedRef.current) return;
      const scrollable = contentSize.height > layoutMeasurement.height + ADVANCE_TRIGGER_PX;
      const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - ADVANCE_TRIGGER_PX;
      if (!atBottom) {
        armedRef.current = true;
        return;
      }
      if (armedRef.current && scrollable) {
        firedRef.current = true;
        traceJS('webtoon', 'advance', { pages: pages.length });
        onAdvance();
      }
    },
    [onAdvance, atTop, pages],
  );



  useImperativeHandle(
    ref,
    () => ({
      goToPage(index: number, animated = true) {
        void listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(n - 1, index)), animated });
      },
    }),
    [n],
  );

  // ── What used to live here, and why none of it does any more ────────────────────────────────
  // A running aspect-ratio estimate, a per-row measured-height table, a recomputed offset table
  // feeding a hand-written `getItemLayout`, and a jump-then-jump-again dance at mount (scroll to
  // the entry page,
  // wait 200ms for the rows in between to report real heights, scroll again at the tightened
  // guess). All of it was one job: telling a FlatList where rows it has never measured were going
  // to be, in a list where every row is a different height that isn't known until its image loads.
  //
  // That is the job LegendList exists to do. It measures rows as they render, keeps the sizes by
  // key, and — this is the part the hand-rolled version could never do — holds the VISIBLE content
  // still while it happens (`maintainVisibleContentPosition`'s size anchoring, on by default). The
  // old code had no answer for a row ABOVE the viewport growing when its image finally decoded: the
  // strip lurched under the reader, which is the long-standing "it jumped while I was reading"
  // in vertical mode. Nothing here schedules a correction any more because nothing here needs to.
  // Identity-stable, and reading the latest callback through a ref that is written AFTER render
  // rather than during it (the paged reader's arrangement, and the React Compiler's rule).
  const onPageChangeRef = useRef(onPageChange);
  useLayoutEffect(() => {
    onPageChangeRef.current = onPageChange;
  });
  // Topmost VIEWABLE row, by index — `[0]` would trust an ordering nothing promises.
  const [onViewable] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken<ReaderPageItem>[] }) => {
        let first: ViewToken<ReaderPageItem> | undefined;
        for (const token of viewableItems) if (!first || token.index < first.index) first = token;
        if (first) onPageChangeRef.current(first.index);
      },
  );

  return (
    // Fixed-size clip so the scaled strip can grow past the viewport and be masked;
    // the zoom transform lives on the inner Animated.View, and the list's own
    // GestureDetector (nativeScroll) is what the zoom gestures compose against.
    <View style={{ width, height, overflow: 'hidden' }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <GestureDetector gesture={listGesture}>
            <AnimatedLegendList
              ref={listRef}
              style={{ width, height }}
              estimatedListSize={{ width, height }}
              data={pages}
              keyExtractor={(item) => item.key}
              // Frozen while zoomed so the pan gesture owns one-finger drags; scrolling
              // resumes the instant it's back at 1×.
              scrollEnabled={!zoomed}
              showsVerticalScrollIndicator={false}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={VIEWABILITY_CONTINUOUS}
              // Where the reader is resuming to. A deep entry point lands on estimates and tightens
              // as the rows between here and there measure — which is precisely what the anchoring
              // below is for, and what the old jump-twice-and-hope dance was standing in for.
              initialScrollIndex={Math.max(0, Math.min(n - 1, initialPage))}
              // A page's height isn't known until its image is; this is the guess until then, and
              // LegendList replaces it per row with the real thing as each one lands.
              estimatedItemSize={width * ESTIMATED_ASPECT}
              // Both halves matter here. SIZE: hold the visible content still while rows resize — a
              // row above the viewport growing when its image decodes used to shove the strip down
              // mid-read. DATA: hold it still when a CHAPTER joins the window in front of the
              // reader, which is what makes scrolling up into the previous chapter a scroll rather
              // than a jump (see the paged reader for the long version of why this needs a list
              // that anchors on the item).
              maintainVisibleContentPosition={{ data: true, size: true }}
              // Rows own per-page load state (and their own Retry), so hand each page its own cell
              // rather than passing an instance around.
              recycleItems={false}
              // One viewport of pages kept mounted either side — enough to have the next screenful
              // decoded before it arrives, without holding a long run of full-width bitmaps.
              drawDistance={height}
              // Kept explicit: the auto-advance below reads the scroll AS IT MOVES, so this can't
              // be left to whatever the list would otherwise pick.
              onScroll={onScroll}
              scrollEventThrottle={16}
              ListFooterComponent={
                nextChapterName ? <ChapterSentinel name={nextChapterName} onPress={onAdvance} /> : null
              }
              renderItem={({ item, index }) => (
                <WebtoonRow
                  uri={item.uri}
                  page={item.pageNumber}
                  width={width}
                  fadeMs={standby ? STANDBY_FADE_MS : undefined}
                  testID={testId('reader.page.tap', index + 1)}
                />
              )}
            />
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

/** One webtoon row. The chrome-toggle / pinch / double-tap gestures now live on the
 *  list's container (see WebtoonContinuous), so the per-row overlay is just an inert
 *  marker: it carries the `reader.page.tap.*` testID (asserted by the webtoon Maestro
 *  flow) and `pointerEvents: none` so it never claims a touch away from those
 *  gestures or from a failed page's own Retry chip. Suspended while the page is in
 *  its failed state, matching the previous behaviour.
 *
 *  No `onLayout` reporting any more: the list measures its own rows and holds the
 *  viewport still while their sizes settle (see WebtoonContinuous). */
function WebtoonRow({
  uri,
  page,
  width,
  fadeMs,
  testID,
}: {
  uri: string;
  /** Per-CHAPTER page number (what a placeholder or a failed page names), not the flat index. */
  page: number;
  width: number;
  fadeMs?: number;
  testID: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View>
      <ReaderPage uri={uri} page={page} fit="width" width={width} fadeMs={fadeMs} onFailedChange={setFailed} />
      {!failed && <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none" />}
    </View>
  );
}

/**
 * Vertical PAGINATED webtoon reader ('fit-page'): one full page at a time,
 * each row exactly one viewport height, snapping like pages — a genuinely
 * different reading model from the continuous strip above, not a tweak of it.
 * Every row's layout is exact (`getFixedItemSize`, no estimation and no
 * anchoring), so unlike the continuous variant nothing here has to correct
 * itself after the fact, and page tracking can stay on `onMomentumScrollEnd`:
 * with fixed sizes and no inserts, `contentOffset / height` IS the index.
 *
 * Because each row is exactly one non-scrolling viewport, zoom lives INSIDE the
 * row (like the horizontal paged reader's `ZoomablePage`) rather than wrapping
 * the list — the proven arrangement where a pinch/tap actually reaches the
 * gesture instead of being eaten by the scroll. While any page is zoomed the
 * list's paging is frozen so a one-finger drag pans instead of turning.
 */
const WebtoonPaged = forwardRef<WebtoonReaderHandle, Props>(function WebtoonPaged(
  {
    pages,
    width,
    height,
    initialPage,
    onPageChange,
    onToggleChrome,
    onZoomChange,
    onEndReached,
    onGoBack,
    standby,
  },
  ref,
) {
  const listRef = useRef<LegendListRef>(null);
  // Same seed-then-refine as the continuous variant — and the same reason. See useBackPull.
  const atTop = useSharedValue(initialPage <= 0);
  // …and the same arming, for the same reason: `onEndReached` fires on ARRIVING at the end, and a
  // backward crossing arrives there by definition. Without this it bounces straight back into the
  // chapter it just left. Armed by being anywhere that isn't the end.
  const armedRef = useRef(false);
  useEffect(() => {
    armedRef.current = false;
  }, [pages]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      atTop.set(contentOffset.y <= AT_TOP_EPSILON);
      if (contentOffset.y + layoutMeasurement.height < contentSize.height - ADVANCE_TRIGGER_PX) {
        armedRef.current = true;
      }
    },
    [atTop],
  );
  const handleEndReached = useCallback(() => {
    if (armedRef.current) onEndReached?.();
  }, [onEndReached]);
  const n = pages.length;

  // Whichever page is on screen owns the zoom (only one is ever interacted with
  // in a hard-snapping list); its state gates the list's scroll and the reader's
  // swipe-away, exactly like the horizontal paged reader.
  const [zoomed, setZoomed] = useState(false);
  const handleZoom = useCallback(
    (z: boolean) => {
      setZoomed(z);
      onZoomChange?.(z);
    },
    [onZoomChange],
  );
  useEffect(() => () => onZoomChange?.(false), [onZoomChange]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(index: number, animated = true) {
        void listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(n - 1, index)), animated });
      },
    }),
    [n],
  );

  // Same "pull down at the top" as the continuous strip — nothing about a paginated list makes the
  // question different, and it keeps the offset arithmetic below free of a header to subtract.
  const zoomedSV = useSharedValue(false);
  const backPull = useBackPull({ atTop, zoomed: zoomedSV, height, onGoBack });
  const nativeScroll = useMemo(() => Gesture.Native(), []);
  const listGesture = useMemo(() => Gesture.Simultaneous(nativeScroll, backPull), [nativeScroll, backPull]);
  // Handed to each row, whose own pinch/tap/double-tap live inside this scroller and would
  // otherwise arbitrate against both of these without saying so.
  const rowExternals = useMemo(() => [nativeScroll, backPull], [nativeScroll, backPull]);
  useEffect(() => {
    zoomedSV.set(zoomed);
  }, [zoomed, zoomedSV]);

  const onPageChangeRef = useRef(onPageChange);
  useLayoutEffect(() => {
    onPageChangeRef.current = onPageChange;
  });
  const settledRef = useRef(initialPage);
  const [onViewable] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken<ReaderPageItem>[] }) => {
        let first: ViewToken<ReaderPageItem> | undefined;
        for (const token of viewableItems) if (!first || token.index < first.index) first = token;
        if (first) settledRef.current = first.index;
      },
  );
  const onMomentumScrollEnd = useCallback(() => {
    onPageChangeRef.current(Math.max(0, Math.min(n - 1, settledRef.current)));
  }, [n]);

  return (
    <GestureDetector gesture={listGesture}>
    <AnimatedLegendList
      ref={listRef}
      style={{ width, height }}
      estimatedListSize={{ width, height }}
      data={pages}
      keyExtractor={(item) => item.key}
      pagingEnabled
      // Frozen while a page is zoomed so its own pan owns one-finger drags.
      scrollEnabled={!zoomed}
      showsVerticalScrollIndicator={false}
      initialScrollIndex={Math.max(0, Math.min(n - 1, initialPage))}
      // Every row is exactly one viewport tall — known, not measured, which is what keeps paging
      // snapping on page boundaries and `contentOffset / height` an exact index below.
      getFixedItemSize={() => height}
      estimatedItemSize={height}
      // SIZE anchoring off — every row is a known fixed height, so there are no measurement
      // corrections to hold still for. DATA anchoring ON, for the one thing that does move: a
      // chapter joining the window in front of the reader, which is what turns scrolling back into
      // a page turn instead of a jump. (Which is also why the settle below reads viewability rather
      // than dividing the offset: an anchored insert can leave a leading adjustment, and the
      // division would name the wrong page.)
      maintainVisibleContentPosition={{ data: true, size: false }}
      recycleItems={false}
      drawDistance={height}
      onMomentumScrollEnd={onMomentumScrollEnd}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY_PAGED}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onEndReachedThreshold={0.05}
      onEndReached={handleEndReached}
      renderItem={({ item, index }) => (
        <WebtoonPagedRow
          uri={item.uri}
          page={item.pageNumber}
          index={index}
          width={width}
          height={height}
          onToggleChrome={onToggleChrome}
          onZoomChange={handleZoom}
          fadeMs={standby ? STANDBY_FADE_MS : undefined}
          testID={testId('reader.page.tap', index + 1)}
          externals={rowExternals}
        />
      )}
    />
    </GestureDetector>
  );
});

/** One paginated-webtoon row: fixed to exactly one viewport, whole page visible
 *  (letterboxed), and independently zoomable via the shared `useZoomable` (pinch
 *  / double-tap / pan-with-momentum). The gesture lives on the row itself — a
 *  non-scrolling cell — so it fires reliably. A single tap toggles chrome
 *  (Exclusive with the double-tap). Suspended while the page shows its Retry state. */
function WebtoonPagedRow({
  uri,
  page,
  index,
  width,
  height,
  onToggleChrome,
  onZoomChange,
  fadeMs,
  testID,
  externals,
}: {
  uri: string;
  /** Per-CHAPTER page number — see WebtoonRow. */
  page: number;
  index: number;
  width: number;
  height: number;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  fadeMs?: number;
  testID: string;
  /** The gestures the LIST has mounted (its scroll, and the back-pull) — this row lives inside
   *  them, so its own must declare they can run alongside or lose the arbitration. */
  externals: GestureType[];
}) {
  const [failed, setFailed] = useState(false);
  // Whole zoom gesture + the chrome-toggle single tap, composed by the shared hook
  // (the chrome toggle ignores the tap's x). Same primitive the paged reader uses.
  const { gesture, animatedStyle } = useZoomable({
    width,
    height,
    enabled: !failed,
    onZoomChange,
    onSingleTap: onToggleChrome,
    singleTapEnabled: !failed,
    simultaneousExternal: externals,
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, overflow: 'hidden' }}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <ReaderPage uri={uri} page={page} fit="contain" width={width} height={height} fadeMs={fadeMs} onFailedChange={setFailed} />
        </Animated.View>
        {/* Inert marker for the reader.page.tap.* testID (asserted by Maestro). */}
        {!failed && <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none" />}
      </View>
    </GestureDetector>
  );
}

/** End-of-chapter row appended below the last page of the continuous webtoon list
 *  (mirrors comical-web's scroll-mode "Next: … →" sentinel). Tappable, and also the
 *  visual cue for the scroll-to-end auto-advance — scrolling it into view loads the
 *  next chapter.
 *
 *  There is deliberately no counterpart above page 1: going BACK is a pull at the top
 *  (see useBackPull), not a page of nothing to scroll through. */
function ChapterSentinel({ name, onPress }: { name: string; onPress?: () => void }) {
  return (
    <Pressable testID="reader.chapter-sentinel" style={styles.sentinel} onPress={onPress}>
      <Text style={styles.sentinelText} numberOfLines={2}>
        Next: {name} →
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sentinel: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  sentinelText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
