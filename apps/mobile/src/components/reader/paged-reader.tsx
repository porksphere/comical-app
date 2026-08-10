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
  FlatList,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { STANDBY_FADE_MS } from '@/components/reader/reader-page';
import { ZoomablePage } from '@/components/reader/zoomable-page';
import type { PageFit } from '@/hooks/use-reader-settings';
import { BACK_ACTIVATE_DOMINANCE } from '@/lib/back-swipe';
import { releaseCommittedEitherWay } from '@/lib/gesture-release';

export type PagedReaderHandle = {
  goToPage: (logical: number, animated?: boolean) => void;
  /** Continuous seek: `logical` may be FRACTIONAL (1.5 = halfway between pages 2 and 3), and the
   *  move is never animated. This is what the bottom scrubber drives — dragging scrolls the reader
   *  through the chapter's whole pixel space 1:1 with the finger, rather than stepping page to page,
   *  so a settle to the nearest page only happens on release (a plain `goToPage`). */
  scrubTo: (logical: number) => void;
};

/** One pager cell. The pager itself is chapter-agnostic — the reader screen may
 *  stitch SEVERAL chapters' pages into one `pages` array (seamless
 *  chapter-to-chapter swiping), so each item carries a stable identity (`key`,
 *  unique across chapters AND stable across window slides — that's what lets the
 *  pager re-anchor the visible page when segments come and go) and its own
 *  per-chapter display number (`pageNumber`, what ReaderPage's failed state shows). */
export type ReaderPageItem = { uri: string; key: string; pageNumber: number };

/** Module-level so it's stable without a hook — FlatList keeps the first one it's given. */
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
 * Horizontal paged reader. A native `pagingEnabled` FlatList with a fixed
 * item width (via getItemLayout) so paging snaps and `scrollToIndex` is exact.
 *
 * RTL: the data array is reversed and a single logical↔physical mapping keeps
 * "next" = reading order +1 (which sits to the left in RTL). Tap zones live
 * INSIDE each page (descendants of the scroller), so a horizontal drag is
 * handed to the FlatList while a stationary tap fires the zone.
 *
 * Each page also supports pinch / double-tap zoom (see ZoomablePage). While a
 * page is zoomed the FlatList scroll is disabled so a one-finger drag pans the
 * image instead of turning the page.
 *
 * A swipe that runs off either END of the list — where the scroller has nothing
 * left to give and can only rubber-band — is handed to `onPrev`/`onNext` as a
 * chapter turn, the same thing a tap in that zone does there (see `edgeTurn`).
 *
 * The reader screen stitches adjacent chapters into `pages`, extending that
 * window as you cross a boundary. It appends at the tail wherever it can, so the
 * current position usually doesn't move; when a chapter does land ahead of it,
 * see `useLayoutEffect` below for how the visible page is kept put.
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
  // An animated ref: still an ordinary ref for the imperative calls below
  // (`.current` is the FlatList), but ALSO usable from a worklet, which is what
  // lets the scrubber reaction scroll without a hop to JS.
  const listRef = useAnimatedRef<FlatList<ReaderPageItem>>();
  const n = pages.length;

  const toPhysical = (logical: number) => (rtl ? n - 1 - logical : logical);
  const toLogical = (physical: number) => (rtl ? n - 1 - physical : physical);

  const data = useMemo(() => (rtl ? [...pages].reverse() : pages), [pages, rtl]);

  const [zoomed, setZoomed] = useState(false);
  const handleZoomChange = useCallback(
    (z: boolean) => {
      setZoomed(z);
      onZoomChange?.(z);
    },
    [onZoomChange],
  );
  // Unmounting (e.g. switching reader modes) must not leave the parent thinking
  // a page is still zoomed — that would keep its swipe-dismiss disabled.
  useEffect(() => () => onZoomChange?.(false), [onZoomChange]);
  const [activeIndex, setActiveIndex] = useState(toPhysical(Math.max(0, Math.min(n - 1, initialPage))));

  useImperativeHandle(
    ref,
    () => ({
      goToPage(logical: number, animated = true) {
        const clamped = Math.max(0, Math.min(n - 1, logical));
        listRef.current?.scrollToIndex({ index: toPhysical(clamped), animated });
      },
      // The JS-side fallback for the same move (the webtoon reader's scrubber path
      // and web). The native paged scrubber doesn't come through here at all — it
      // drives `scrubTarget` and never touches the JS thread; see the reaction below.
      scrubTo(logical: number) {
        const clamped = Math.max(0, Math.min(n - 1, logical));
        listRef.current?.scrollToOffset({ offset: toPhysical(clamped) * width, animated: false });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, rtl, width],
  );

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const physical = Math.round(e.nativeEvent.contentOffset.x / width);
    onPageChange(toLogical(Math.max(0, Math.min(n - 1, physical))));
  };

  // Reported live from viewability below. Kept in a ref because that callback has
  // to stay identity-stable — FlatList throws if it changes — so it can't close
  // over the current `rtl`/`n` mapping itself.
  const reportVisibleRef = useRef<(physical: number) => void>(() => {});

  // Track which page is on screen so off-screen pages reset their zoom, report it
  // to the reader for its page counter, and remember it as `anchorRef` — the page
  // the scroll is parked on, identified by its stable key plus the index it
  // occupies in the CURRENT `data`. The token carries the item itself, so the
  // anchor needs no `data` closure either.
  const anchorRef = useRef<{ key: string; index: number } | null>(null);
  // Mid-scrub, both JS-side effects are skipped and only the anchor is kept up to
  // date. `setActiveIndex` re-renders every mounted cell, and reporting the
  // visible page re-renders the whole reader screen (its counter and stitched-
  // segment state hang off it) — a drag across a chapter would do each once per
  // page swept past, on the thread the list needs to render those pages. Neither
  // is worth anything during the drag: the navigator shows the scrub's own
  // position (it knows where the finger is sooner and more exactly than
  // viewability can), and the zoom state nothing can be touching mid-drag. The
  // release re-syncs both — viewability fires again on the settle, and the
  // reader's seek names the landing page directly.
  const scrubbingRef = useRef(false);
  const [onViewableItemsChanged] = useState(() => ({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index == null) return;
    anchorRef.current = { key: (first.item as ReaderPageItem).key, index: first.index };
    if (scrubbingRef.current) return;
    setActiveIndex(first.index);
    reportVisibleRef.current(first.index);
  });

  // Where the list is PARKED, for the edge pan further down to read on the UI thread. Shared values
  // rather than the render's own `activeIndex` so that pan never has to be rebuilt as the reader
  // moves: a gesture rebuilt mid-drag is one whose criteria changed under the finger, and this
  // particular one would change them on the most ordinary turn there is (page 1 → 2 flips
  // `atStart` while the finger is still down).
  const atStart = useSharedValue(false);
  const atEnd = useSharedValue(false);

  // Both refs above (and the two shared values) are rewritten AFTER each render rather than during
  // it.
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
  });

  // The scrubber's live drag, resolved entirely on the UI thread — a shared value
  // in, a native scroll command out, with the JS thread never in the loop. Every
  // cell is exactly one viewport wide (getItemLayout), so a fractional page index
  // is just an offset; `pagingEnabled` only snaps at the end of a real drag, never
  // against a programmatic scroll, so the list rests between pages under a finger.
  useAnimatedReaction(
    () => scrubTarget?.value ?? -1,
    (target) => {
      if (target < 0) return;
      const logical = Math.max(0, Math.min(n - 1, target));
      scrollTo(listRef, (rtl ? n - 1 - logical : logical) * width, 0, false);
    },
    [scrubTarget, n, rtl, width],
  );

  // Keep the visible page put when anything lands AHEAD of the current position,
  // which shifts every cell after it while the scroll offset — a raw pixel value
  // — knows nothing about it. The reader screen extends its stitched window at
  // the TAIL ONLY (a run takes its previous chapter at creation or not at all),
  // so nothing should reach this any more except a current segment whose page
  // count changed under it. Kept as the backstop for that: the correction itself
  // is what the user sees as a flash, because the cells at the corrected offset
  // are not rendered yet — the render window was computed from the old position.
  // If this starts firing again, the fix belongs in whatever changed the window,
  // not here.
  //
  // Deliberately NOT `maintainVisibleContentPosition`: that tracks the first
  // visible *view* across a commit and shifts contentOffset by how far that view
  // moved, which yields a garbage delta the moment the view it's tracking is
  // recycled — which is what happens here, since the render window is computed
  // from the pre-change offset and a whole chapter (~30 pages) lands far outside
  // it. Measured on a real LTR crossing: dropping the 31-page previous chapter
  // off the head snapped the offset to 0, i.e. back into the chapter just
  // finished. It also misfired mid-fling on plain virtualization commits.
  //
  // Keys are stable across window changes (`chapterId:page`), so the correction
  // is exact in JS: find where the anchored page went and scroll there. Every
  // cell is one page wide, so this always lands page-aligned.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const index = data.findIndex((item) => item.key === anchor.key);
    if (index < 0 || index === anchor.index) return;
    anchorRef.current = { key: anchor.key, index };
    listRef.current?.scrollToOffset({ offset: index * width, animated: false });
    // `activeIndex` must shift with the anchor: viewability tracks items by KEY, and the visible
    // item's key hasn't changed — so no viewability callback fires for this correction, and the
    // state would keep pointing a whole chapter away. Harmless while every window cell renders,
    // but in STANDBY (the collapsed strip) the placeholder branch blanks every cell EXCEPT
    // `activeIndex` — with it stale, the strip blanked the very page it was showing (a black band
    // until the next real page turn re-synced it). First-boot-only in practice: a warm cache
    // delivers the neighbour chapters before mount, so nothing prepends late.
    setActiveIndex(index);
    // `listRef` is stable (an animated ref, which the lint rule can't tell from a
    // plain one); it's listed only to keep exhaustive-deps quiet.
  }, [data, width, listRef]);

  // Tap-zone meaning flips with direction (RTL: left = next, right = prev),
  // mirroring the reference's `t(±l())`.
  const leftAction = rtl ? onNext : onPrev;
  const rightAction = rtl ? onPrev : onNext;

  // ── A swipe off either END of the list is a chapter turn ───────────────────
  //
  // The list holds the whole stitched window, so its ends are the ends of what has been stitched —
  // and past them a `pagingEnabled` FlatList can only rubber-band. That is fine wherever the window
  // is going to grow into the gap (the reader screen appends the next chapter as soon as its page
  // list lands), and it is a dead end at the HEAD: a run takes its previous chapter at the instant
  // it is created or never, precisely so nothing is ever inserted in front of a live pager (the
  // shift that costs is written up at the screen's `run` machinery). A cold open — page list for
  // the previous chapter still in flight when the run is made — therefore parks the reader on a
  // first page with nothing behind it, and swiping back from there did nothing at all.
  //
  // What it should do, and what the WEB pager has always done with the same swipe (see
  // paged-reader.web.tsx's finalizeSwipe), is hand the drag to the reader as a chapter turn:
  // `onPrev`/`onNext` — the very callbacks the tap zones already fire at this boundary. So this is
  // the tap-zone answer, reached by swiping. Nothing about the window changes, which is the point:
  // the crossing goes through the screen's explicit-jump path (remount, seeded on the neighbouring
  // chapter's landing page) instead of growing the pager under the reader's feet.
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
  const fromStart = useSharedValue(false);
  const fromEnd = useSharedValue(false);
  const edgeTurn = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!zoomed && !standby)
        .maxPointers(1)
        .activeOffsetX([-EDGE_ACTIVATE_PX, EDGE_ACTIVATE_PX])
        .failOffsetY([-EDGE_FAIL_PX, EDGE_FAIL_PX])
        .onBegin(() => {
          'worklet';
          fromStart.set(atStart.value);
          fromEnd.set(atEnd.value);
        })
        .onEnd((e) => {
          'worklet';
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
    [zoomed, standby, width, leftAction, rightAction, atStart, atEnd, fromStart, fromEnd],
  );
  // The list's own scroll as a gesture RNGH can reason about, so the pan above runs ALONGSIDE it
  // rather than winning the touch off it.
  const listGesture = useMemo(() => Gesture.Simultaneous(Gesture.Native(), edgeTurn), [edgeTurn]);

  return (
    <View style={{ width, height }}>
      {/* Nothing full-screen is painted here on purpose. A virtualized list draws NOTHING where it
          hasn't mounted a cell, so a scrub that outruns virtualization shows whatever is behind the
          list — which is the screen's STATIC reader surface, deliberately tinted to the same
          composite an unloaded page shows (PAGED_BACKDROP, see reader-page.tsx). A fill here used
          to provide that tint, but this subtree is the part that translates/scales during a
          swipe-away, so any full-screen fill inside it reads as the background travelling with
          the page. */}
      <GestureDetector gesture={listGesture}>
      <FlatList
        ref={listRef}
        // Sized explicitly: it used to BE this component's root and take the size
        // from whatever hosted it, and a scroller that sizes to its content is
        // not what wants to decide the reader's dimensions.
        style={{ width, height }}
        data={data}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={toPhysical(Math.max(0, Math.min(n - 1, initialPage)))}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        // Window tuning matters more here than in a normal list: a cell is a
        // FULL-SCREEN image, so the default windowSize of 21 keeps ~10 pages of
        // decoded bitmap mounted either side and re-renders all of them on every
        // virtualization pass. Two pages either side is enough to have the next
        // page ready before you reach it, and it's what makes a long scrub survive:
        // the shorter the window, the faster the list catches up with the offset
        // and the less time you spend looking at unmounted (blank) cells.
        //
        // Mid-scrub the window stays that size but is filled FASTER: after a jump
        // the list has ~5 cells to build, and at the resting batch size that's
        // three passes ~50ms apart before the page under the finger exists at all.
        //
        // UNMEASURED TRADE-OFF, if the scrubber ever feels less responsive than
        // it should: this spends JS-thread time on the same thread the navigator's
        // page number and haptic tick arrive on (one runOnJS hop per ~45ms, see
        // chapter-navigator.tsx). Pages fill sooner; the number and buzz queue
        // behind whatever cell work is in flight. Nothing has been observed —
        // walking these back toward the resting values (3 / 32) is the first
        // thing to try if it has.
        initialNumToRender={1}
        maxToRenderPerBatch={scrubbing ? 5 : 2}
        updateCellsBatchingPeriod={scrubbing ? 16 : 50}
        windowSize={5}
        onMomentumScrollEnd={onMomentumEnd}
        onScrollToIndexFailed={() => {}}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={({ item, index }) =>
          // Standby (a decorative background strip): NEIGHBOUR cells hold their slot but mount no
          // page — no neighbour images requested. Gated per cell rather than by dropping
          // `windowSize` to 1: flipping windowSize on the live list re-ran virtualization right
          // as the reader expanded, which could flash the visible page. The on-screen cell
          // renders identically in both states, so standby lifting is invisible.
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
            />
          )
        }
      />
      </GestureDetector>
    </View>
  );
});

