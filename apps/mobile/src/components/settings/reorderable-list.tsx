import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sortable, SortableItem, type SortableRenderItemProps } from 'react-native-reanimated-dnd';

import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';

import type { ReorderableListProps } from './reorderable-list.types';

/**
 * Native in-place reorder: the live list itself is `react-native-reanimated-dnd`'s `<Sortable>`, so a
 * ~200ms long-press on any row lifts it to drag — no separate "reorder mode". Each item is the page's
 * real row (`renderRow`), rendered UNCHANGED inside a `SortableItem`, so a swipe-to-uninstall row
 * keeps its exact gesture + animation; the library only adds the long-press drag on top (the two
 * disambiguate: a quick horizontal move is the swipe, a 200ms hold is the drag). No
 * `SortableItem.Handle` on purpose — a handle would disable the whole-row long-press.
 *
 * Dynamic heights are on because settings rows vary (a status line makes some taller). The Sortable
 * owns its own scroll (needed for drag autoscroll), so the page renders this in place of its scroll.
 */
const ESTIMATED_ROW_HEIGHT = 56;

/** Sortable requires each item to carry a string `id`; wrap the caller's items so any T works. */
type Row<T> = { id: string; value: T };

export function ReorderableList<T>({ data, keyOf, renderRow, onReorder }: ReorderableListProps<T>) {
  const contentPadding = useSettingsScrollPadding();
  const rows: Row<T>[] = data.map((v) => ({ id: keyOf(v), value: v }));

  // `allPositions` is an id→slot map; sort it into the committed key order for the caller to persist.
  const handleDrop = useCallback(
    (_id: string, _position: number, allPositions?: Record<string, number>) => {
      if (!allPositions) return;
      const ordered = Object.entries(allPositions)
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => k);
      onReorder(ordered);
    },
    [onReorder],
  );

  const renderItem = useCallback(
    (props: SortableRenderItemProps<Row<T>>) => {
      const { item, id, ...rest } = props;
      return (
        <SortableItem key={id} id={id} data={item} {...rest} onDrop={handleDrop}>
          {renderRow(item.value)}
        </SortableItem>
      );
    },
    [handleDrop, renderRow],
  );

  return (
    <View style={styles.host}>
      <Sortable
        data={rows}
        renderItem={renderItem}
        enableDynamicHeights
        estimatedItemHeight={ESTIMATED_ROW_HEIGHT}
        contentContainerStyle={contentPadding}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});
