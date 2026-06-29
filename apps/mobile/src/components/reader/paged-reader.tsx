import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';

import { ZoomablePage } from '@/components/reader/zoomable-page';

export type PagedReaderHandle = { goToPage: (logical: number) => void };

type Props = {
  pages: string[];
  width: number;
  height: number;
  rtl: boolean;
  initialPage: number;
  onPageChange: (logical: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleChrome: () => void;
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
 */
export const PagedReader = forwardRef<PagedReaderHandle, Props>(function PagedReader(
  { pages, width, height, rtl, initialPage, onPageChange, onPrev, onNext, onToggleChrome },
  ref,
) {
  const listRef = useRef<FlatList<string>>(null);
  const n = pages.length;

  const toPhysical = (logical: number) => (rtl ? n - 1 - logical : logical);
  const toLogical = (physical: number) => (rtl ? n - 1 - physical : physical);

  const data = useMemo(() => (rtl ? [...pages].reverse() : pages), [pages, rtl]);

  const [zoomed, setZoomed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(toPhysical(Math.max(0, Math.min(n - 1, initialPage))));

  useImperativeHandle(
    ref,
    () => ({
      goToPage(logical: number) {
        const clamped = Math.max(0, Math.min(n - 1, logical));
        listRef.current?.scrollToIndex({ index: toPhysical(clamped), animated: true });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, rtl],
  );

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const physical = Math.round(e.nativeEvent.contentOffset.x / width);
    onPageChange(toLogical(Math.max(0, Math.min(n - 1, physical))));
  };

  // Track which page is on screen so off-screen pages reset their zoom.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  // Tap-zone meaning flips with direction (RTL: left = next, right = prev),
  // mirroring the reference's `t(±l())`.
  const leftAction = rtl ? onNext : onPrev;
  const rightAction = rtl ? onPrev : onNext;

  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={(uri, i) => `${uri}:${i}`}
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
          uri={item}
          page={toLogical(index) + 1}
          width={width}
          height={height}
          active={index === activeIndex}
          onLeft={leftAction}
          onRight={rightAction}
          onToggleChrome={onToggleChrome}
          onZoomChange={setZoomed}
        />
      )}
    />
  );
});
