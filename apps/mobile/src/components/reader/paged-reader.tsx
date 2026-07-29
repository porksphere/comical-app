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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';

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
  },
  ref,
) {
  const listRef = useRef<FlatList<ReaderPageItem>>(null);
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
      // Every cell is exactly one viewport wide (getItemLayout), so a fractional
      // index is just an offset — `pagingEnabled` only snaps at the end of a real
      // drag/fling, never against a programmatic offset, so the list happily rests
      // between pages while the finger is down.
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

  // Reported live from viewability below. Kept in a ref (rewritten every render)
  // because that callback has to stay identity-stable — FlatList throws if it
  // changes — so it can't close over the current `rtl`/`n` mapping itself.
  const reportVisibleRef = useRef<(physical: number) => void>(() => {});
  reportVisibleRef.current = (physical: number) => onVisiblePageChange?.(toLogical(physical));

  // Track which page is on screen so off-screen pages reset their zoom, report it
  // to the reader for its page counter, and remember it as `anchorRef` — the page
  // the scroll is parked on, identified by its stable key plus the index it
  // occupies in the CURRENT `data`. The token carries the item itself, so the
  // anchor needs no `data` closure either.
  const anchorRef = useRef<{ key: string; index: number } | null>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index == null) return;
    setActiveIndex(first.index);
    anchorRef.current = { key: (first.item as ReaderPageItem).key, index: first.index };
    reportVisibleRef.current(first.index);
  }).current;

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
  }, [data, width]);

  // Tap-zone meaning flips with direction (RTL: left = next, right = prev),
  // mirroring the reference's `t(±l())`.
  const leftAction = rtl ? onNext : onPrev;
  const rightAction = rtl ? onPrev : onNext;

  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={(item) => item.key}
      horizontal
      pagingEnabled
      scrollEnabled={!zoomed}
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={toPhysical(Math.max(0, Math.min(n - 1, initialPage)))}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      onMomentumScrollEnd={onMomentumEnd}
      onScrollToIndexFailed={() => {}}
      viewabilityConfig={viewabilityConfig}
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
  );
});
