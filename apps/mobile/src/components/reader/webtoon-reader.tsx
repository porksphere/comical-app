import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { ReaderPage } from '@/components/reader/reader-page';
import { useZoomable } from '@/components/reader/use-zoomable';
import type { PageFit } from '@/hooks/use-reader-settings';
import { testId } from '@/lib/test-id';

/** `animated` defaults to true (a jump). The reader's page scrubber passes false: rows here have
 *  variable heights, so a scrub can't land between pages the way the paged reader does — it steps
 *  to the nearest page instead, and an animation per drag frame would fight the finger. */
export type WebtoonReaderHandle = { goToPage: (index: number, animated?: boolean) => void };

type Props = {
  pages: string[];
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
};

// Height/width ratio assumed for a page before it has rendered (matches
// ReaderPage's own DEFAULT_ASPECT). Refined at runtime — see `aspectRef` below.
const ESTIMATED_ASPECT = 3 / 2;

// How close (px) to the bottom of the continuous list the scroll must get before
// the next chapter auto-loads — roughly where the end-of-chapter sentinel enters view.
const ADVANCE_TRIGGER_PX = 120;

function recomputeOffsets(heights: (number | null)[], fallback: number): number[] {
  const offsets = new Array(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + (heights[i] ?? fallback);
  return offsets;
}

/**
 * Vertical webtoon reader — dispatches to one of two genuinely different
 * reading models depending on `pageFit`. They don't share machinery: the
 * continuous strip's `aspectRef`/`heightsRef` estimation exists specifically
 * for *unknown, variable* row heights, which doesn't apply to the paginated
 * variant (every row is exactly one viewport height).
 */
export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(props, ref) {
  return props.pageFit === 'fit-page' ? <WebtoonPaged {...props} ref={ref} /> : <WebtoonContinuous {...props} ref={ref} />;
});

/**
 * Vertical continuous (webtoon) reader: a vertical FlatList of full-width pages.
 * Current page comes from viewability. Page heights aren't known until each
 * image loads, so `getItemLayout` fills in unmeasured rows with a running
 * estimate (refined from real rows as they render) and `scrollToIndex` is
 * re-run once after mount so a deep jump — e.g. from a page-thumbnail tap —
 * can correct itself once nearby rows have reported their real height.
 * A per-item tap overlay toggles chrome (descendant of the scroller, so a
 * vertical drag still scrolls).
 */
const WebtoonContinuous = forwardRef<WebtoonReaderHandle, Props>(function WebtoonContinuous(
  { pages, width, height, initialPage, onPageChange, onToggleChrome, onZoomChange, nextChapterName, onAdvance },
  ref,
) {
  const listRef = useRef<FlatList<string>>(null);
  const n = pages.length;

  // Pinch / double-tap / pan-while-zoomed for the whole viewport — the same shared
  // primitive the paged reader uses. Zooming scales the current on-screen strip and
  // freezes the scroll (the FlatList is disabled while zoomed, below) so a one-finger
  // drag pans the magnified view; unzoom to resume scrolling. The pan is bounded to
  // the scaled viewport, which is exactly the content that was already on screen (and
  // therefore rendered), so panning never exposes un-virtualized blanks.
  // The FlatList's own scroll, as a gesture RNGH can reason about. Without this the
  // pinch/tap on the wrapping detector never fire — the native ScrollView swallows the
  // touch (the paged reader dodges this by living inside a non-scrolling cell). The
  // hook marks its gestures `simultaneousWithExternalGesture(nativeScroll)` so they run
  // alongside it (a 2-finger pinch, or a stationary tap) instead of losing to the scroll.
  const nativeScroll = Gesture.Native();

  // Whole zoom gesture (pinch / double-tap / pan) plus the chrome-toggle single tap,
  // composed by the shared hook. Chrome toggle ignores the tap's x.
  const { gesture, animatedStyle, zoomed } = useZoomable({
    width,
    height,
    onZoomChange,
    onSingleTap: onToggleChrome,
    simultaneousExternal: nativeScroll,
  });

  // Unmounting (switching reader modes, leaving the reader) must not leave the parent
  // thinking a zoom is still active — that would keep its swipe-dismiss disabled.
  useEffect(() => () => onZoomChange?.(false), [onZoomChange]);

  // Auto-advance when the reader scrolls to the very end (where the sentinel sits).
  // Gated on the content actually being scrollable, so a short chapter that fits on
  // screen doesn't auto-skip on mount — its sentinel stays tap-only. `firedRef`
  // makes it a once-per-chapter trigger; it resets when `pages` (the chapter) change.
  const firedRef = useRef(false);
  useEffect(() => {
    firedRef.current = false;
  }, [pages]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!onAdvance || firedRef.current) return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const scrollable = contentSize.height > layoutMeasurement.height + ADVANCE_TRIGGER_PX;
      const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - ADVANCE_TRIGGER_PX;
      if (scrollable && atBottom) {
        firedRef.current = true;
        onAdvance();
      }
    },
    [onAdvance],
  );

  const aspectRef = useRef(ESTIMATED_ASPECT);
  const heightsRef = useRef<(number | null)[]>([]);
  const offsetsRef = useRef<number[]>([]);
  const layoutKeyRef = useRef('');
  const layoutKey = `${n}:${width}`;
  if (layoutKeyRef.current !== layoutKey) {
    layoutKeyRef.current = layoutKey;
    heightsRef.current = new Array(n).fill(null);
    offsetsRef.current = recomputeOffsets(heightsRef.current, width * aspectRef.current);
  }

  const onRowLayout = useCallback(
    (index: number, h: number) => {
      if (h <= 0 || heightsRef.current[index] === h) return;
      // Fold this row's real height into the running estimate so the many
      // still-unmeasured rows (most of a long chapter) get a better guess. Runs
      // on every change (not just the first), since the first layout usually
      // fires before the image has loaded and only reflects the same default
      // aspect the estimate already assumes.
      if (width > 0) aspectRef.current = aspectRef.current * 0.8 + (h / width) * 0.2;
      heightsRef.current[index] = h;
      offsetsRef.current = recomputeOffsets(heightsRef.current, width * aspectRef.current);
    },
    [width],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, index: number) => ({
      length: heightsRef.current[index] ?? width * aspectRef.current,
      offset: offsetsRef.current[index] ?? 0,
      index,
    }),
    [width],
  );

  useImperativeHandle(
    ref,
    () => ({
      goToPage(index: number, animated = true) {
        listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(n - 1, index)), animated });
      },
    }),
    [n],
  );

  // Jump to the entry page once mounted, then re-jump shortly after: the first
  // attempt only has whatever heights were known at mount (mostly estimates for
  // a page deep into the list), and by the second pass the rows FlatList had to
  // render to land there have reported their real height, tightening the guess.
  useEffect(() => {
    if (initialPage <= 0) return;
    const target = Math.min(n - 1, initialPage);
    const t1 = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: target, animated: false });
    }, 0);
    const t2 = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: target, animated: false });
    }, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable viewability handler reading the latest callback via a ref (FlatList
  // throws if onViewableItemsChanged / viewabilityConfig change identity).
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewable = useRef((info: { viewableItems: ViewToken[] }) => {
    const first = info.viewableItems.find((v) => v.index != null);
    if (first?.index != null) onPageChangeRef.current(first.index);
  }).current;

  return (
    // Fixed-size clip so the scaled strip can grow past the viewport and be masked;
    // the zoom transform lives on the inner Animated.View, and the FlatList's own
    // GestureDetector (nativeScroll) is what the zoom gestures compose against.
    <View style={{ width, height, overflow: 'hidden' }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <GestureDetector gesture={nativeScroll}>
            <FlatList
              ref={listRef}
              style={{ width, height }}
              data={pages}
              keyExtractor={(uri, i) => `${uri}:${i}`}
              // Frozen while zoomed so the pan gesture owns one-finger drags; scrolling
              // resumes the instant it's back at 1×.
              scrollEnabled={!zoomed}
              showsVerticalScrollIndicator={false}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={viewabilityConfig}
              getItemLayout={getItemLayout}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onScrollToIndexFailed={(info) => {
                const offset = offsetsRef.current[info.index] ?? info.averageItemLength * info.index;
                listRef.current?.scrollToOffset({ offset, animated: false });
                setTimeout(() => {
                  listRef.current?.scrollToIndex({ index: info.index, animated: false });
                }, 60);
              }}
              ListFooterComponent={
                nextChapterName ? <ChapterSentinel name={nextChapterName} onPress={onAdvance} /> : null
              }
              renderItem={({ item, index }) => (
                <WebtoonRow uri={item} index={index} width={width} onRowLayout={onRowLayout} testID={testId('reader.page.tap', index + 1)} />
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
 *  its failed state, matching the previous behaviour. */
function WebtoonRow({
  uri,
  index,
  width,
  onRowLayout,
  testID,
}: {
  uri: string;
  index: number;
  width: number;
  onRowLayout: (index: number, height: number) => void;
  testID: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View onLayout={(e: LayoutChangeEvent) => onRowLayout(index, e.nativeEvent.layout.height)}>
      <ReaderPage uri={uri} page={index + 1} fit="width" width={width} onFailedChange={setFailed} />
      {!failed && <View testID={testID} style={StyleSheet.absoluteFill} pointerEvents="none" />}
    </View>
  );
}

/**
 * Vertical PAGINATED webtoon reader ('fit-page'): one full page at a time,
 * each row exactly one viewport height, snapping like pages — a genuinely
 * different reading model from the continuous strip above, not a tweak of it.
 * Every row's layout is exact (no estimation needed), so unlike the continuous
 * variant this needs no `onScrollToIndexFailed` retry dance, and page
 * tracking is via `onMomentumScrollEnd` (matching the *native Paged* reader's
 * own technique — more precise than viewability for a hard-snapping list).
 *
 * Because each row is exactly one non-scrolling viewport, zoom lives INSIDE the
 * row (like the horizontal paged reader's `ZoomablePage`) rather than wrapping
 * the list — the proven arrangement where a pinch/tap actually reaches the
 * gesture instead of being eaten by the scroll. While any page is zoomed the
 * list's paging is frozen so a one-finger drag pans instead of turning.
 */
const WebtoonPaged = forwardRef<WebtoonReaderHandle, Props>(function WebtoonPaged(
  { pages, width, height, initialPage, onPageChange, onToggleChrome, onZoomChange, onEndReached },
  ref,
) {
  const listRef = useRef<FlatList<string>>(null);
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
        listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(n - 1, index)), animated });
      },
    }),
    [n],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<string> | null | undefined, index: number) => ({ length: height, offset: height * index, index }),
    [height],
  );

  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.y / height);
      onPageChangeRef.current(Math.max(0, Math.min(n - 1, idx)));
    },
    [height, n],
  );

  return (
    <FlatList
      ref={listRef}
      data={pages}
      keyExtractor={(uri, i) => `${uri}:${i}`}
      pagingEnabled
      // Frozen while a page is zoomed so its own pan owns one-finger drags.
      scrollEnabled={!zoomed}
      showsVerticalScrollIndicator={false}
      initialScrollIndex={Math.max(0, Math.min(n - 1, initialPage))}
      getItemLayout={getItemLayout}
      onMomentumScrollEnd={onMomentumScrollEnd}
      onScrollToIndexFailed={() => {}}
      onEndReachedThreshold={0.05}
      onEndReached={onEndReached}
      renderItem={({ item, index }) => (
        <WebtoonPagedRow
          uri={item}
          index={index}
          width={width}
          height={height}
          onToggleChrome={onToggleChrome}
          onZoomChange={handleZoom}
          testID={testId('reader.page.tap', index + 1)}
        />
      )}
    />
  );
});

/** One paginated-webtoon row: fixed to exactly one viewport, whole page visible
 *  (letterboxed), and independently zoomable via the shared `useZoomable` (pinch
 *  / double-tap / pan-with-momentum). The gesture lives on the row itself — a
 *  non-scrolling cell — so it fires reliably. A single tap toggles chrome
 *  (Exclusive with the double-tap). Suspended while the page shows its Retry state. */
function WebtoonPagedRow({
  uri,
  index,
  width,
  height,
  onToggleChrome,
  onZoomChange,
  testID,
}: {
  uri: string;
  index: number;
  width: number;
  height: number;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  testID: string;
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
  });

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, overflow: 'hidden' }}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <ReaderPage uri={uri} page={index + 1} fit="contain" width={width} height={height} onFailedChange={setFailed} />
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
 *  next chapter. */
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
