import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View, type ViewToken } from 'react-native';

import { ReaderPage } from '@/components/reader/reader-page';

export type WebtoonReaderHandle = { goToPage: (index: number) => void };

type Props = {
  pages: string[];
  width: number;
  initialPage: number;
  onPageChange: (index: number) => void;
  onToggleChrome: () => void;
};

/**
 * Vertical continuous (webtoon) reader: a vertical FlatList of full-width pages.
 * Current page comes from viewability. Page heights aren't known until each
 * image loads, so `scrollToIndex` is best-effort with an offset-estimate retry.
 * A per-item tap overlay toggles chrome (descendant of the scroller, so a
 * vertical drag still scrolls).
 */
export const WebtoonReader = forwardRef<WebtoonReaderHandle, Props>(function WebtoonReader(
  { pages, width, initialPage, onPageChange, onToggleChrome },
  ref,
) {
  const listRef = useRef<FlatList<string>>(null);
  const n = pages.length;

  useImperativeHandle(
    ref,
    () => ({
      goToPage(index: number) {
        listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(n - 1, index)), animated: true });
      },
    }),
    [n],
  );

  // Jump to the entry page once mounted (no getItemLayout here since heights are
  // dynamic, so this is best-effort with the scroll-to-index failure fallback).
  useEffect(() => {
    if (initialPage <= 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: Math.min(n - 1, initialPage), animated: false });
    }, 0);
    return () => clearTimeout(t);
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
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index: info.index, animated: false });
        }, 60);
      }}
      renderItem={({ item, index }) => (
        <View>
          <ReaderPage uri={item} page={index + 1} fit="width" width={width} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onToggleChrome} />
        </View>
      )}
    />
  );
});
