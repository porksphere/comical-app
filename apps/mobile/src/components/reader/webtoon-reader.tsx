import type { LegendListRef, ViewToken } from '@legendapp/list/react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { ReaderPage, STANDBY_FADE_MS } from '@/components/reader/reader-page';
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

// How close (px) to the bottom of the continuous list the scroll must get before
// the next chapter auto-loads — roughly where the end-of-chapter sentinel enters view.
const ADVANCE_TRIGGER_PX = 120;

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
  { pages, width, height, initialPage, onPageChange, onToggleChrome, onZoomChange, nextChapterName, onAdvance, standby },
  ref,
) {
  const listRef = useRef<LegendListRef>(null);
  const n = pages.length;

  // Pinch / double-tap / pan-while-zoomed for the whole viewport — the same shared
  // primitive the paged reader uses. Zooming scales the current on-screen strip and
  // freezes the scroll (the list is disabled while zoomed, below) so a one-finger
  // drag pans the magnified view; unzoom to resume scrolling. The pan is bounded to
  // the scaled viewport, which is exactly the content that was already on screen (and
  // therefore rendered), so panning never exposes un-virtualized blanks.
  // The list's own scroll, as a gesture RNGH can reason about. Without this the
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
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  // Topmost VIEWABLE row, by index — `[0]` would trust an ordering nothing promises.
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<string>[] }) => {
    let first: ViewToken<string> | undefined;
    for (const token of viewableItems) if (!first || token.index < first.index) first = token;
    if (first) onPageChangeRef.current(first.index);
  }).current;

  return (
    // Fixed-size clip so the scaled strip can grow past the viewport and be masked;
    // the zoom transform lives on the inner Animated.View, and the list's own
    // GestureDetector (nativeScroll) is what the zoom gestures compose against.
    <View style={{ width, height, overflow: 'hidden' }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <GestureDetector gesture={nativeScroll}>
            <AnimatedLegendList
              ref={listRef}
              style={{ width, height }}
              estimatedListSize={{ width, height }}
              data={pages}
              keyExtractor={(uri, i) => `${uri}:${i}`}
              // Frozen while zoomed so the pan gesture owns one-finger drags; scrolling
              // resumes the instant it's back at 1×.
              scrollEnabled={!zoomed}
              showsVerticalScrollIndicator={false}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={viewabilityConfig}
              // Where the reader is resuming to. A deep entry point lands on estimates and tightens
              // as the rows between here and there measure — which is precisely what the anchoring
              // below is for, and what the old jump-twice-and-hope dance was standing in for.
              initialScrollIndex={Math.max(0, Math.min(n - 1, initialPage))}
              // A page's height isn't known until its image is; this is the guess until then, and
              // LegendList replaces it per row with the real thing as each one lands.
              estimatedItemSize={width * ESTIMATED_ASPECT}
              // THE one that matters in vertical mode: hold the visible content still while rows
              // resize. A row above the viewport growing when its image decodes used to shove the
              // strip down mid-read. `data: false` — a chapter change remounts this reader outright,
              // so there is no data anchoring to do.
              maintainVisibleContentPosition={{ data: false, size: true }}
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
                  uri={item}
                  index={index}
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
  index,
  width,
  fadeMs,
  testID,
}: {
  uri: string;
  index: number;
  width: number;
  fadeMs?: number;
  testID: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View>
      <ReaderPage uri={uri} page={index + 1} fit="width" width={width} fadeMs={fadeMs} onFailedChange={setFailed} />
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
  { pages, width, height, initialPage, onPageChange, onToggleChrome, onZoomChange, onEndReached, standby },
  ref,
) {
  const listRef = useRef<LegendListRef>(null);
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
    <AnimatedLegendList
      ref={listRef}
      style={{ width, height }}
      estimatedListSize={{ width, height }}
      data={pages}
      keyExtractor={(uri, i) => `${uri}:${i}`}
      pagingEnabled
      // Frozen while a page is zoomed so its own pan owns one-finger drags.
      scrollEnabled={!zoomed}
      showsVerticalScrollIndicator={false}
      initialScrollIndex={Math.max(0, Math.min(n - 1, initialPage))}
      // Every row is exactly one viewport tall — known, not measured, which is what keeps paging
      // snapping on page boundaries and `contentOffset / height` an exact index below.
      getFixedItemSize={() => height}
      estimatedItemSize={height}
      // Nothing to anchor: the sizes are fixed (so no measurement corrections) and a chapter change
      // remounts this reader (so no data change to hold a position across). Off on both counts, so
      // the offset arithmetic below can't be quietly shifted under it.
      maintainVisibleContentPosition={{ data: false, size: false }}
      recycleItems={false}
      drawDistance={height}
      onMomentumScrollEnd={onMomentumScrollEnd}
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
          fadeMs={standby ? STANDBY_FADE_MS : undefined}
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
  fadeMs,
  testID,
}: {
  uri: string;
  index: number;
  width: number;
  height: number;
  onToggleChrome: () => void;
  onZoomChange: (zoomed: boolean) => void;
  fadeMs?: number;
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
          <ReaderPage uri={uri} page={index + 1} fit="contain" width={width} height={height} fadeMs={fadeMs} onFailedChange={setFailed} />
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
