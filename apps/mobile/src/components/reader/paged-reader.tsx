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
import {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';

import { ZoomablePage } from '@/components/reader/zoomable-page';
import type { PageFit } from '@/hooks/use-reader-settings';

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
  /** True while the pager is parked as a DECORATIVE background (the series-reader's collapsed
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

  // Both refs above are rewritten AFTER each render rather than during it.
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

  // Keep the visible page put when a segment lands AHEAD of the current position
  // (a previous chapter arriving late), which shifts every cell after it by a
  // whole chapter while the scroll offset — a raw pixel value — knows nothing
  // about it. The reader screen only ever extends its stitched window at the
  // tail while you read forward, precisely so this stays a rare case.
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
    // `listRef` is stable (an animated ref, which the lint rule can't tell from a
    // plain one); it's listed only to keep exhaustive-deps quiet.
  }, [data, width, listRef]);

  // Tap-zone meaning flips with direction (RTL: left = next, right = prev),
  // mirroring the reference's `t(±l())`.
  const leftAction = rtl ? onNext : onPrev;
  const rightAction = rtl ? onPrev : onNext;

  return (
    <View style={{ width, height }}>
      {/* Nothing full-screen is painted here on purpose. A virtualized list draws NOTHING where it
          hasn't mounted a cell, so a scrub that outruns virtualization shows whatever is behind the
          list — which is SwipeDismiss's STATIC backdrop, deliberately tinted to the same composite
          an unloaded page shows (PAGED_BACKDROP, see reader-page.tsx). A fill here used to provide
          that tint, but this subtree is the part that translates/scales during swipe-to-dismiss, so
          any full-screen fill inside it reads as the background travelling with the page. */}
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
        // Standby (a decorative background strip) keeps the window to the ON-SCREEN page only —
        // no neighbour cells mounted, no neighbour images requested.
        windowSize={standby ? 1 : 5}
        onMomentumScrollEnd={onMomentumEnd}
        onScrollToIndexFailed={() => {}}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={({ item, index }) => (
          <ZoomablePage
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
        )}
      />
    </View>
  );
});

