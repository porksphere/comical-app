import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from 'react-native';

import { ReaderPage } from '@/components/reader/reader-page';

export type WebtoonReaderHandle = { goToPage: (index: number) => void };

type Props = {
  pages: string[];
  width: number;
  initialPage: number;
  onPageChange: (index: number) => void;
  onToggleChrome: () => void;
  /** Fires as the list nears its end. The caller still checks whether the
   *  current page is actually the last one before acting on it — a short
   *  chapter can otherwise fire this before it's been scrolled through. */
  onEndReached?: () => void;
};

// Height/width ratio assumed for a page before it has rendered (matches
// ReaderPage's own DEFAULT_ASPECT). Refined at runtime — see `aspectRef` below.
const ESTIMATED_ASPECT = 3 / 2;

function recomputeOffsets(heights: (number | null)[], fallback: number): number[] {
  const offsets = new Array(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + (heights[i] ?? fallback);
  return offsets;
}

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
export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(
  { pages, width, initialPage, onPageChange, onToggleChrome, onEndReached },
  ref,
) {
  const listRef = useRef<FlatList<string>>(null);
  const n = pages.length;

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
      goToPage(index: number) {
        listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(n - 1, index)), animated: true });
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
    <FlatList
      ref={listRef}
      data={pages}
      keyExtractor={(uri, i) => `${uri}:${i}`}
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={getItemLayout}
      onEndReachedThreshold={0.05}
      onEndReached={onEndReached}
      onScrollToIndexFailed={(info) => {
        const offset = offsetsRef.current[info.index] ?? info.averageItemLength * info.index;
        listRef.current?.scrollToOffset({ offset, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: info.index, animated: false });
        }, 60);
      }}
      renderItem={({ item, index }) => (
        <WebtoonRow
          uri={item}
          index={index}
          width={width}
          onRowLayout={onRowLayout}
          onToggleChrome={onToggleChrome}
        />
      )}
    />
  );
});

/** One webtoon row. Tracks its own failed state so a failed page's overlay
 *  (which would otherwise swallow every tap, including the Retry chip) is
 *  suspended while that page is showing its Retry state. */
function WebtoonRow({
  uri,
  index,
  width,
  onRowLayout,
  onToggleChrome,
}: {
  uri: string;
  index: number;
  width: number;
  onRowLayout: (index: number, height: number) => void;
  onToggleChrome: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View onLayout={(e: LayoutChangeEvent) => onRowLayout(index, e.nativeEvent.layout.height)}>
      <ReaderPage uri={uri} page={index + 1} fit="width" width={width} onFailedChange={setFailed} />
      {!failed && <Pressable style={StyleSheet.absoluteFill} onPress={onToggleChrome} />}
    </View>
  );
}
