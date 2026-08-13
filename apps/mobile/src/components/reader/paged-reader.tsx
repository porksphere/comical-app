import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { LegendListRef, ViewToken } from '@legendapp/list/react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { STANDBY_FADE_MS } from '@/components/reader/reader-page';
import { ScrubBackdrop } from '@/components/reader/scrub-backdrop';
import { ZoomablePage } from '@/components/reader/zoomable-page';
import type { PageFit } from '@/hooks/use-reader-settings';
import { BACK_ACTIVATE_DOMINANCE } from '@/lib/back-swipe';
import { releaseCommittedEitherWay } from '@/lib/gesture-release';
import { trace, traceJS } from '@/lib/gesture-trace';

export type PagedReaderHandle = {
  goToPage: (logical: number, animated?: boolean) => void;
  /** Seek, never animated — the JS-side path for a scrubber that has no shared value to write to
   *  (the webtoon reader). The CONTINUOUS drag, the one that pulls the reader through a chapter's
   *  whole pixel space 1:1 with the finger, is the `scrubTarget` shared value instead and never
   *  comes through here; a fractional `logical` therefore lands on the nearest page. */
  scrubTo: (logical: number) => void;
};

/** One pager cell. The pager itself is chapter-agnostic — the reader screen may
 *  stitch SEVERAL chapters' pages into one `pages` array (seamless
 *  chapter-to-chapter swiping), so each item carries a stable identity (`key`,
 *  unique across chapters AND stable across window slides — that's what lets the
 *  pager re-anchor the visible page when segments come and go) and its own
 *  per-chapter display number (`pageNumber`, what ReaderPage's failed state shows). */
export type ReaderPageItem = { uri: string; key: string; pageNumber: number };

/** Module-level so it's stable without a hook — a list may keep the first one it's given. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

/**
 * ── Swiping off either END of the list (see `edgeTurn`) ──────────────────────
 *
 * Rightward travel that hands the drag to the edge pan. Ten points, for the same reason
 * `lib/back-swipe.ts` uses ten: UIScrollView claims a touch at roughly that distance, and a pan
 * that asks for more than the scroller does is a pan the scroller has already stopped feeding.
 */
const EDGE_ACTIVATE_PX = 10;
/** Vertical travel that gives the drag up instead — in paged mode that axis belongs to the series
 *  page's collapse/dismiss pan. Derived from the activation distance through the same dominance the
 *  back-swipe activates on, never dialled on its own. */
const EDGE_FAIL_PX = Math.round(EDGE_ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);
/** How far across the page the release has to be HEADED (translation + projected velocity — see
 *  lib/gesture-release) to count as asking for the chapter next door. A quarter of the width, the
 *  same commitment the series page asks of a reveal. */
const EDGE_TURN_FRACTION = 0.25;

type Props = {
  pages: ReaderPageItem[];
  width: number;
  height: number;
  rtl: boolean;
  pageFit: PageFit;
  initialPage: number;
  /** The page the scroll SETTLED on — the committed position (progress, chapter
   *  relabel). Fires once per scroll, on momentum end. */
  onPageChange: (logical: number) => void;
  /** The page currently on screen, reported as it goes past — every page of a
   *  fast flick, not just the one it lands on. For display only (the pill and
   *  toolbar count along); nothing that writes should hang off it. */
  onVisiblePageChange?: (logical: number) => void;
  /** A page turn the list itself can't make: the tap zones fire these at any page, and a swipe off
   *  either END of the stitched window is handed to them too (see `edgeTurn`) — which is how a
   *  chapter boundary the window doesn't cover is crossed by swiping rather than only by tapping. */
  onPrev: () => void;
  onNext: () => void;
  onToggleChrome: () => void;
  /** Fires when the visible page's pinch-zoom state changes — the reader screen
   *  disables its swipe-away gesture while zoomed (a one-finger drag pans then). */
  onZoomChange?: (zoomed: boolean) => void;
  /** Where the bottom scrubber's finger is, as a FRACTIONAL page index into
   *  `pages` — or a negative number when nothing is being scrubbed. Driving it as
   *  a shared value rather than a callback keeps the whole drag on the UI thread:
   *  the scroll follows the finger even while JS is busy re-windowing the list. */
  scrubTarget?: SharedValue<number>;
  /** True for the duration of that drag. Suppresses the per-page JS work
   *  viewability would otherwise kick off — a re-render of every mounted cell
   *  plus one of the reader screen, for each page swept past. That work is the
   *  single biggest source of stutter in a long scrub, and mid-drag nothing
   *  reads its results. */
  scrubbing?: boolean;
  /** True while the pager is parked as a DECORATIVE background (the series page's collapsed
   *  strip): shrinks the virtualization window to the visible page only, so neighbouring pages
   *  aren't mounted — or their images requested — until the reader becomes primary again. */
  standby?: boolean;
};

/**
 * Horizontal paged reader. A `pagingEnabled` LegendList with a fixed item width
 * (`getFixedItemSize`) so paging snaps and `scrollToIndex` is exact.
 *
 * ── Why LegendList and not FlatList ──────────────────────────────────────────
 * Because the reader screen stitches ADJACENT CHAPTERS into `pages`, and that
 * window has to be able to grow at the HEAD — you read backward across a
 * boundary and the chapter before it joins the list in front of where you are.
 *
 * A FlatList cannot survive that. Its position is a raw pixel offset and its
 * render window is a range of INDICES derived from that offset, so prepending a
 * chapter moves every page after it by `chapterLength × width` while the offset
 * stays put: you are suddenly looking at a page you did not turn to. Correcting
 * it afterwards (find the anchored key, scroll there) is what this file used to
 * do, and the correction is the flash — the list arrives at the right offset
 * with nothing mounted there, because the window was computed from the old one.
 * RN's own `maintainVisibleContentPosition` doesn't save it either: that anchors
 * on the first visible VIEW, and a whole-chapter prepend is exactly the case
 * where the view it's tracking gets recycled out from under it.
 *
 * LegendList positions items itself, from sizes it holds BY KEY, and its
 * `maintainVisibleContentPosition={{ data: true }}` anchors a data change on the
 * item rather than on a view or an index. The prepend then costs nothing here:
 * no correction, no re-window, no flash, and the page under your thumb doesn't
 * move. (Same reason every other list in this app is built on it.)
 *
 * PAGING ALIGNMENT, the invariant to keep: `pagingEnabled` snaps to multiples of
 * the viewport from the content origin, and LegendList may carry a leading
 * adjustment after an anchored insert. Every insert here is a whole number of
 * PAGES, so any such adjustment is a multiple of `width` and the snap grid still
 * lands on page boundaries. If that ever stops being true, `snapToIndices` (real
 * item offsets, whatever the padding) is the escape hatch.
 *
 * RTL: the data array is reversed and a single logical↔physical mapping keeps
 * "next" = reading order +1 (which sits to the left in RTL). Tap zones live
 * INSIDE each page (descendants of the scroller), so a horizontal drag is
 * handed to the list while a stationary tap fires the zone.
 *
 * Each page also supports pinch / double-tap zoom (see ZoomablePage). While a
 * page is zoomed the list's scroll is disabled so a one-finger drag pans the
 * image instead of turning the page.
 *
 * A swipe that runs off either END of the list — where the scroller has nothing
 * left to give and can only rubber-band — is handed to `onPrev`/`onNext` as a
 * chapter turn, the same thing a tap in that zone does there (see `edgeTurn`).
 */
export const PagedReader = forwardRef<PagedReaderHandle, Props>(function PagedReader(
  {
    pages,
    width,
    height,
    rtl,
    pageFit,
    initialPage,
    onPageChange,
    onVisiblePageChange,
    onPrev,
    onNext,
    onToggleChrome,
    onZoomChange,
    scrubTarget,
    scrubbing,
    standby,
  },
  ref,
) {
  // Two refs onto the same scroller. `listRef` is LegendList's own handle (the imperative moves
  // below go through it, since only the list knows where an index actually SITS once it has
  // anchored an insert). `scrollRef` is the underlying scroll view as an ANIMATED ref — handed out
  // by `refScrollView`, and on the reanimated build that is a real Animated.ScrollView — which is
  // what lets the scrubber's reaction scroll from the UI thread without a hop to JS.
  const listRef = useRef<LegendListRef>(null);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const n = pages.length;

  const toPhysical = (logical: number) => (rtl ? n - 1 - logical : logical);
  const toLogical = (physical: number) => (rtl ? n - 1 - physical : physical);

  const data = useMemo(() => (rtl ? [...pages].reverse() : pages), [pages, rtl]);
  // Display numbers by the same index as `data`, for the scrub backdrop to read from a worklet — a
  // stitched window restarts at 1 per chapter, so the index is not the number.
  const pageNumbers = useMemo(() => data.map((item) => item.pageNumber), [data]);

  const [zoomed, setZoomed] = useState(false);
  const handleZoomChange = useCallback(
    (z: boolean) => {
      setZoomed(z);
      onZoomChange?.(z);
    },
    [onZoomChange],
  );
  // A pinch in progress, reported from the page at the START of the pinch (see ZoomablePage's
  // `onPinchChange`). It freezes the scroller for the duration — a page's pinch runs SIMULTANEOUSLY
  // with the list's own scroll (it has to; see `nativeScroll`), and a UIScrollView reads two
  // fingers as a two-finger drag, so the pinch that scales the page also drags the pager, sliding
  // the neighbouring pages in under the zoom.
  const [pinching, setPinching] = useState(false);
  // Unmounting (e.g. switching reader modes) must not leave the parent thinking
  // a page is still zoomed — that would keep its swipe-dismiss disabled.
  useEffect(() => () => onZoomChange?.(false), [onZoomChange]);
  // Where the pager opens, resolved once — the list reads `initialScrollIndex` at mount and never
  // again, so this must not be recomputed as the window grows around it.
  const [initialIndex] = useState(() => toPhysical(Math.max(0, Math.min(n - 1, initialPage))));

  // WHICH PAGE IS ON SCREEN — held as a KEY, and turned back into an index by looking it up in the
  // current data. That indirection is the whole point: a chapter joining at the head moves every
  // index after it, and an index remembered from before the insert would name a different page
  // (the standby strip's blanking and the zoom reset both hang off this, and both were wrong for a
  // beat under the old index-held version). A key can't drift.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeIndex = useMemo(() => {
    const found = activeKey ? data.findIndex((item) => item.key === activeKey) : -1;
    return found >= 0 ? found : initialIndex;
  }, [data, activeKey, initialIndex]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(logical: number, animated = true) {
        const clamped = Math.max(0, Math.min(n - 1, logical));
        void listRef.current?.scrollToIndex({ index: toPhysical(clamped), animated });
      },
      // The JS-side fallback for the same move (the webtoon reader's scrubber path
      // and web). The native paged scrubber doesn't come through here at all — it
      // drives `scrubTarget` and never touches the JS thread; see the reaction below.
      // Rounded, because an index is what the list can place exactly; the fractional
      // path is the UI-thread one.
      scrubTo(logical: number) {
        const clamped = Math.max(0, Math.min(n - 1, Math.round(logical)));
        void listRef.current?.scrollToIndex({ index: toPhysical(clamped), animated: false });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, rtl],
  );

  // ── UI-thread state, read by the scrub reaction and the edge pan further down ──
  // Where the list is PARKED. Shared values rather than the render's own `activeIndex` so the edge
  // pan never has to be rebuilt as the reader moves: a gesture rebuilt mid-drag is one whose
  // criteria changed under the finger, and this one would change them on the most ordinary turn
  // there is (page 1 → 2 flips `atStart` while the finger is still down).
  const atStart = useSharedValue(false);
  const atEnd = useSharedValue(false);
  // Whether the edge pan may ACT at all — false while a page is zoomed (a one-finger drag pans the
  // image then) or while the pager is a decorative strip. A shared value rather than `.enabled()`
  // for the same reason `atStart`/`atEnd` are: see `edgeTurn`.
  const edgeAllowed = useSharedValue(true);
  // The index the list is parked on, and where index 0 sits in scroll coordinates — the two halves
  // of the scrub's arithmetic. See the reaction below.
  const parkedIndex = useSharedValue(0);
  const scrubOrigin = useSharedValue(0);

  /**
   * WHERE INDEX 0 SITS, asked of the list rather than inferred from where the scroll happens to be.
   *
   * The scrub needs this because `index × width` is not a page's offset on its own: an anchored
   * insert leaves the list carrying a leading adjustment. It used to be derived on the first frame
   * of each drag, as `scrollOffset − parkedIndex × width`, which is only as good as its two inputs
   * and neither is dependable at that instant. The scroll offset comes from Reanimated's
   * `useScrollOffset`, which only ever updates on a scroll EVENT — so a pager that was positioned
   * by `initialScrollIndex` and not yet touched reports 0 while sitting twenty pages in. Measured
   * against a parked index that is right, that is a twenty-page error, and the recording shows
   * exactly that: a scrub aimed at flat 19–33 walking the pager through pages 3–17 of the chapter
   * BEFORE it.
   *
   * `positionAtIndex` is the list's own position map — the same one its viewability reads — so it
   * carries the adjustment by construction and owes nothing to scroll events. Index 0 first;
   * falling back to the parked index (certain to be in the computed range) and subtracting where it
   * would be from zero.
   */
  const measureScrubOrigin = useCallback(
    (at: number): number | null => {
      const state = listRef.current?.getState?.();
      if (!state) return null;
      const zero = state.positionAtIndex(0);
      if (typeof zero === 'number') return zero;
      const parked = state.positionAtIndex(at);
      return typeof parked === 'number' ? parked - at * width : null;
    },
    [width],
  );

  // The page a scroll SETTLED on, taken from viewability rather than from `contentOffset / width`.
  // The offset is no longer a reliable index: an anchored insert can leave the list carrying a
  // leading adjustment, and dividing through it would name the wrong page. Viewability answers the
  // question directly, and at rest exactly one page is over the threshold.
  const settledRef = useRef(initialIndex);
  const onMomentumEnd = () => {
    onPageChange(toLogical(Math.max(0, Math.min(n - 1, settledRef.current))));
  };

  // Reported live from viewability below. Kept in a ref so the callback can stay
  // identity-stable and not close over the current `rtl`/`n` mapping itself.
  const reportVisibleRef = useRef<(physical: number) => void>(() => {});

  // Mid-scrub, both JS-side effects are skipped and only the settled index is kept
  // up to date. `setActiveKey` re-renders every mounted cell, and reporting the
  // visible page re-renders the whole reader screen (its counter and stitched-
  // segment state hang off it) — a drag across a chapter would do each once per
  // page swept past, on the thread the list needs to render those pages. Neither
  // is worth anything during the drag: the navigator shows the scrub's own
  // position (it knows where the finger is sooner and more exactly than
  // viewability can), and the zoom state nothing can be touching mid-drag. The
  // release re-syncs both — viewability fires again on the settle, and the
  // reader's seek names the landing page directly.
  const scrubbingRef = useRef(false);
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken<ReaderPageItem>[] }) => {
        // Lowest index, not `[0]`: the page in front is the one with the smallest index, and
        // nothing promises the callback hands them over in that order.
        let first: ViewToken<ReaderPageItem> | undefined;
        for (const token of viewableItems) if (!first || token.index < first.index) first = token;
        if (!first) return;
        settledRef.current = first.index;
        if (scrubbingRef.current) return;
        setActiveKey(first.key);
        reportVisibleRef.current(first.index);
      },
  );

  // Where the pager sits, for the pinch freeze below to re-snap to — the same value `parkedIndex`
  // carries, on the thread that needs it.
  const activeIndexRef = useRef(initialIndex);

  // The refs above (and the shared values) are rewritten AFTER each render rather than during it.
  //
  // They were written inline in the render body until this pass, which the React
  // Compiler forbids — and it had never said so, because it was quietly bailing
  // out of this component altogether (giving up its memoization as well as its
  // diagnostics). Splitting the return into a wrapper for the backdrop is what
  // made it compilable, at which point four long-standing violations surfaced at
  // once. Nothing reads either ref before the first commit — viewability can only
  // fire once the list has laid out and scrolled — so a layout effect is early
  // enough, and it deliberately has no dependency array: every render's values
  // are the ones the next callback should see.
  useLayoutEffect(() => {
    reportVisibleRef.current = (physical: number) => onVisiblePageChange?.(toLogical(physical));
    scrubbingRef.current = !!scrubbing;
    atStart.set(activeIndex <= 0);
    atEnd.set(activeIndex >= n - 1);
    parkedIndex.set(activeIndex);
    edgeAllowed.set(!zoomed && !standby);
    activeIndexRef.current = activeIndex;
    // Kept fresh here rather than measured when a drag starts: the origin only moves when the
    // list's own layout does (an anchored insert), which is a render — never mid-drag, where
    // viewability is suppressed and nothing re-lays out. Skipped WHILE scrubbing for the same
    // reason the rest of the frame is latched: a drag is resolved in the coordinates it began in.
    if (!scrubbing) {
      const origin = measureScrubOrigin(activeIndex);
      if (origin !== null && origin !== scrubOrigin.value) {
        scrubOrigin.set(origin);
        traceJS('scrub', 'origin', { at: origin / width, idx: activeIndex });
      }
    }
  });

  // Put the pager back on its page for the duration of a pinch. The freeze above stops the drag
  // continuing, but not the point or two it already travelled before the pinch was recognized —
  // and a `pagingEnabled` list that has been frozen mid-page can't snap itself back, so the
  // neighbour would sit there in the corner of the zoom until the fingers came up.
  useEffect(() => {
    if (!pinching) return;
    void listRef.current?.scrollToIndex({ index: activeIndexRef.current, animated: false });
  }, [pinching]);

  // The scrubber's live drag, resolved entirely on the UI thread — a shared value
  // in, a native scroll command out, with the JS thread never in the loop. Every
  // cell is exactly one viewport wide (`getFixedItemSize`), so a fractional page
  // index is just an offset; `pagingEnabled` only snaps at the end of a real drag,
  // never against a programmatic scroll, so the list rests between pages under a
  // finger.
  //
  // `index × width` is no longer the offset of a page on its own: once the list has anchored an
  // insert it carries a leading adjustment, and a scrub computed without it would fly a whole
  // chapter wide. `scrubOrigin` carries that adjustment, asked of the list itself and kept fresh by
  // the layout effect above — see `measureScrubOrigin` for why it is no longer derived here from
  // where the scroll happens to be.
  useAnimatedReaction(
    () => scrubTarget?.value ?? -1,
    (target, previous) => {
      if (target < 0) return;
      const logical = Math.max(0, Math.min(n - 1, target));
      const to = scrubOrigin.value + (rtl ? n - 1 - logical : logical) * width;
      // Once per drag: what the first target mapped to, in pages. `to` against `target` is the
      // whole question — they should differ by nothing but the leading adjustment.
      if ((previous ?? -1) < 0) trace('scrub', 'map', { target, to: to / width, origin: scrubOrigin.value / width });
      scrollTo(scrollRef, to, 0, false);
    },
    [scrubTarget, n, rtl, width],
  );

  // Tap-zone meaning flips with direction (RTL: left = next, right = prev),
  // mirroring the reference's `t(±l())`.
  const leftAction = rtl ? onNext : onPrev;
  const rightAction = rtl ? onPrev : onNext;

  // ── A swipe off either END of the list is a chapter turn ───────────────────
  //
  // THE FALLBACK, not the way a chapter boundary is normally crossed. The window usually holds the
  // chapter on either side, and crossing one is then an ordinary page turn that happens to relabel
  // (the screen's `run` machinery, which waits for the previous chapter's page list before building
  // a window, exists to make that the common case). But a window can still come up short — a
  // neighbour list that never arrived, or a chapter the run has already crossed back into and can
  // no longer grow toward — and at those ends a `pagingEnabled` list can only rubber-band.
  //
  // A dead end is the wrong answer there. The WEB pager has always handed the same swipe on (see
  // paged-reader.web.tsx's finalizeSwipe), and so does the tap zone at that page, so this hands it
  // to the same place: `onPrev`/`onNext`, which cross by jumping — the screen remounts the pane on
  // the neighbouring chapter's landing page. Nothing about the window changes, which is the point:
  // growing a live pager at the head is the shift this whole design is built to avoid.
  //
  // Composed `Simultaneous` with the list's own scroll — the arrangement the webtoon reader uses to
  // put gestures over a live scroller — so the rubber-band still happens under the finger and this
  // pan only reads the release. It activates on horizontal travel alone, at the scroller's own
  // claim distance (see EDGE_ACTIVATE_PX), and one finger only, so a pinch stays a pinch.
  //
  // What it measures is where the list was parked when the FINGER LANDED, latched in `onBegin` —
  // not where it ended up. The difference is the whole correctness of the thing: turning back from
  // page 2 to page 1 ends AT the start, and reading the edge at release would take that ordinary
  // page turn for a request to leave the chapter.
  //
  // And it only EXISTS where it could act. Gating on the edge costs a gesture rebuild each time the
  // reader arrives at or leaves one — which is safe (a rebuilt gesture of the same shape updates
  // its handlers in place rather than reattaching) and buys something worth more: through the whole
  // middle of a chapter, which is nearly all of reading, there is no pan on this surface at all for
  // the page's own gestures to arbitrate against.
  //
  // ZOOM AND STANDBY ARE NOT PART OF THAT GATE, though they do disable it — they're latched off a
  // shared value at touch-down instead. Rebuilding this gesture rebuilds `pageExternals`, and
  // that's a prop of every page: a zoom starting or ending would re-render all of them and rebuild
  // the very pinch/double-tap handlers doing the zooming, mid-gesture. The edge in `.enabled()`
  // moves on a page turn, when nothing is mid-gesture; the zoom moves in the middle of one.
  const fromStart = useSharedValue(false);
  const fromEnd = useSharedValue(false);
  const fromAllowed = useSharedValue(false);
  const atAnEdge = activeIndex <= 0 || activeIndex >= n - 1;
  const edgeTurn = useMemo(
    () =>
      Gesture.Pan()
        .enabled(atAnEdge)
        .maxPointers(1)
        .activeOffsetX([-EDGE_ACTIVATE_PX, EDGE_ACTIVATE_PX])
        .failOffsetY([-EDGE_FAIL_PX, EDGE_FAIL_PX])
        .onBegin(() => {
          'worklet';
          fromStart.set(atStart.value);
          fromEnd.set(atEnd.value);
          fromAllowed.set(edgeAllowed.value);
        })
        .onEnd((e) => {
          'worklet';
          if (!fromAllowed.value) return;
          // The shared projected release (lib/gesture-release), judged along whichever way the drag
          // went — a flick back at the moment of lifting is someone changing their mind.
          if (!releaseCommittedEitherWay(e.translationX, e.velocityX, width * EDGE_TURN_FRACTION)) return;
          // Dragging the pages RIGHT asks for whatever sits to their LEFT, which is exactly what the
          // left tap zone asks for — RTL flip included, since `leftAction` already carries it. Off
          // the end of the list, the answer is a chapter rather than a page.
          if (e.translationX > 0) {
            if (fromStart.value) runOnJS(leftAction)();
          } else if (fromEnd.value) {
            runOnJS(rightAction)();
          }
        }),
    [atAnEdge, width, leftAction, rightAction, atStart, atEnd, edgeAllowed, fromStart, fromEnd, fromAllowed],
  );
  // The list's own scroll, as a gesture RNGH can reason about — so the pan above runs ALONGSIDE it
  // rather than winning the touch off it.
  //
  // Naming it has a second consequence that is NOT optional, and cost a working double-tap to
  // learn: a scroller inside a GestureDetector is in RNGH's arbitration graph, and everything
  // INSIDE it now has to say it can run alongside it or lose to it. This pager used to dodge that
  // entirely — no detector on the scroller, so each page's pinch/tap lived in a non-scrolling cell
  // and never arbitrated with the scroll at all — which is exactly why nothing here declared the
  // relation. The moment the edge pan put a detector on the list, the dodge stopped applying, and
  // the zoom gestures started losing the arbitration they had never had to enter. The pinch and the
  // single tap mostly survived it; the double-tap, which has to hold across two separate touch
  // sequences, did not. So the pages get told about it — the same `simultaneousExternal` wiring the
  // webtoon reader has always needed for the same reason.
  const nativeScroll = useMemo(() => Gesture.Native(), []);
  const listGesture = useMemo(() => Gesture.Simultaneous(nativeScroll, edgeTurn), [nativeScroll, edgeTurn]);
  // BOTH of them, handed to every page — see ZoomablePage's `scrollGesture`.
  const pageExternals = useMemo(() => [nativeScroll, edgeTurn], [nativeScroll, edgeTurn]);

  // EVERYTHING A PAGE CELL DEPENDS ON BEYOND ITS OWN ITEM, and the list's own hand-off for
  // re-rendering cells when it changes.
  //
  // This is not optional bookkeeping. LegendList re-invokes `renderItem` for a mounted cell when
  // that cell's item, its key, or `extraData` changes — and otherwise NOT: a re-render of the list
  // does not reach the cells the way a FlatList's did (VirtualizedList rebuilt every cell element
  // on any parent render, so an inline `renderItem` closure was enough, which is why the swap to
  // LegendList could take this away without anything looking different at the call site).
  //
  // Without it a cell keeps whatever it was FIRST rendered with, and the prop that matters most is
  // `active`. A page is mounted two pages ahead of being read, so it renders with `active: false`
  // and never hears otherwise — and ZoomablePage resets the zoom of a page that isn't active. So
  // pinching or double-tapping any page except the one the pager opened on zoomed it and then
  // undid the zoom on release, which is exactly what it looked like. The rest of these have the
  // same failure mode, more quietly: a page fit change reaching only unmounted pages, a rotation
  // resizing only new cells, a standby strip that never lifted, tap zones calling into a closure
  // from another chapter.
  //
  // `zoomed` and `pinching` are deliberately NOT here. No cell reads either one, and listing them
  // would re-render every page — rebuilding the very gestures in flight — at the moment a pinch
  // starts and again when it settles.
  const extraData = useMemo(
    () => ({
      activeIndex,
      standby,
      pageFit,
      width,
      height,
      leftAction,
      rightAction,
      onToggleChrome,
      handleZoomChange,
      pageExternals,
    }),
    [activeIndex, standby, pageFit, width, height, leftAction, rightAction, onToggleChrome, handleZoomChange, pageExternals],
  );

  return (
    <View style={{ width, height }}>
      {/* What a scrub sees where the list has nothing yet — see ScrubBackdrop. Nothing PERMANENT is
          painted here, which is the distinction that matters: this subtree translates and scales
          during a swipe-away, so a fill that was always on would ride along with the receding page
          (it used to, which is why the tint was moved out to the screen's static surface). This one
          is transparent unless a scrub is in progress, and the reader disables the dismiss gesture
          while the scrubber is held, so the two can never be on screen together. */}
      {scrubTarget && (
        <ScrubBackdrop target={scrubTarget} pageNumbers={pageNumbers} rtl={rtl} width={width} height={height} />
      )}
      <GestureDetector gesture={listGesture}>
      <AnimatedLegendList
        ref={listRef}
        // The scroll view itself, for the UI-thread scrub to drive. LegendList's own hand-off;
        // nothing here reaches inside it. (Its `sharedValues.scrollOffset` used to come out
        // alongside this, for the scrub to measure its origin against — see `measureScrubOrigin`
        // for why that number could not be trusted at the moment the scrub needed it.)
        //
        // The cast is a type-level mismatch, not a runtime one: LegendList declares this as
        // `Ref<ElementRef<typeof Reanimated.ScrollView>>`, which resolves to `Ref<never>` against
        // this Reanimated version, so no ref of any kind satisfies it. What arrives is the
        // Animated.ScrollView that `scrollTo` needs.
        refScrollView={scrollRef as unknown as Ref<never>}
        // Sized explicitly: it used to BE this component's root and take the size
        // from whatever hosted it, and a scroller that sizes to its content is
        // not what wants to decide the reader's dimensions.
        style={{ width, height }}
        // Seeded so the very first layout is at the real viewport rather than zero-width — a
        // horizontal list that lays out cold at width 0 puts every page at the same place and
        // then repositions once it measures (see the same seed on the rails).
        estimatedListSize={{ width, height }}
        data={data}
        keyExtractor={(item) => item.key}
        // What makes a mounted cell re-render — see the memo above. Everything `renderItem` reads
        // that isn't the item belongs in there.
        extraData={extraData}
        horizontal
        pagingEnabled
        // Frozen while a page is zoomed (its own pan owns one-finger drags then) and for the
        // duration of a pinch (see `pinching`).
        scrollEnabled={!zoomed && !pinching}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        // THE POINT OF THE WHOLE SWAP: anchor a data change on the ITEM, so a chapter joining at
        // the head leaves the page under your thumb exactly where it is. `size: false` for the
        // same reason the browse grid sets it — every cell is a known fixed width, so there are no
        // measurement corrections to retro-apply, and asking for them only invites a jitter.
        maintainVisibleContentPosition={{ data: true, size: false }}
        // A cell is a full-screen image with per-page state (load, zoom, aspect); handing an
        // instance to a different page would carry that state across. Mount per page instead.
        recycleItems={false}
        // Two pages either side. A cell is a FULL-SCREEN decoded bitmap, so this is as much as is
        // worth keeping warm — and the shorter the mounted run, the faster the list catches up
        // with a scrub that has outrun it.
        drawDistance={width * 2}
        // Known, not estimated: every page is exactly one viewport wide, which is what makes
        // paging snap and `scrollToIndex` exact.
        getFixedItemSize={() => width}
        estimatedItemSize={width}
        onMomentumScrollEnd={onMomentumEnd}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={({ item, index }) =>
          // Standby (a decorative background strip): NEIGHBOUR cells hold their slot but mount no
          // page — no neighbour images requested. Gated per cell rather than by shrinking the
          // mounted run: changing that on the live list re-runs virtualization right as the reader
          // expands, which could flash the visible page. The on-screen cell renders identically in
          // both states, so standby lifting is invisible.
          standby && index !== activeIndex ? (
            <View style={{ width, height }} />
          ) : (
            <ZoomablePage
              // Standing page, not a turned one — see ReaderPage's `fadeMs`.
              fadeMs={standby ? STANDBY_FADE_MS : undefined}
              uri={item.uri}
              page={item.pageNumber}
              width={width}
              height={height}
              pageFit={pageFit}
              active={index === activeIndex}
              onLeft={leftAction}
              onRight={rightAction}
              onToggleChrome={onToggleChrome}
              onZoomChange={handleZoomChange}
              onPinchChange={setPinching}
              scrollGesture={pageExternals}
            />
          )
        }
      />
      </GestureDetector>
    </View>
  );
});

