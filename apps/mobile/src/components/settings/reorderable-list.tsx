import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sortable, SortableItem, type SortableRenderItemProps } from 'react-native-reanimated-dnd';

import { GripIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

import type { ReorderableListProps } from './reorderable-list.types';

/**
 * Native reorder: long-press drag powered by `react-native-reanimated-dnd`'s `<Sortable>` — it owns
 * the drag physics, live shift, and edge autoscroll (all on Reanimated 4 worklets), so we just map
 * the data to `{ id }` items and render each row with a grip handle. Web ships up/down buttons
 * instead (`reorderable-list.web.tsx`); the DnD library has no web support.
 */
const ROW_HEIGHT = 56;

/** Sortable requires each item to carry a string `id`; wrap the caller's items so any T works. */
type Row<T> = { id: string; value: T };

export function ReorderableList<T>({ data, keyOf, label, leading, onReorder }: ReorderableListProps<T>) {
  const theme = useTheme();
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
          <ThemedView type="backgroundElement" style={styles.row}>
            {leading?.(item.value)}
            <ThemedText type="small" style={styles.label} numberOfLines={1}>
              {label(item.value)}
            </ThemedText>
            <SortableItem.Handle style={styles.handle}>
              <GripIcon color={theme.textSecondary} size={20} />
            </SortableItem.Handle>
          </ThemedView>
        </SortableItem>
      );
    },
    [handleDrop, label, leading, theme.textSecondary],
  );

  return (
    <View style={styles.host}>
      <Sortable data={rows} renderItem={renderItem} itemHeight={ROW_HEIGHT} contentContainerStyle={contentPadding} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    height: ROW_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  label: {
    flex: 1,
  },
  handle: {
    paddingHorizontal: Spacing.one,
  },
});
