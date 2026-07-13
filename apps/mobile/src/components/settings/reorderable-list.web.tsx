import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ArrowDownIcon, ArrowUpIcon } from '@/components/icons/ui-icons';
import { SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

import type { ReorderableListProps } from './reorderable-list.types';

/**
 * Web reorder is a lightweight mode, not in-place drag: mouse-dragging a row isn't worth it (see
 * `SwipeableSettingsRow`'s web split), and our native long-press drag (`reorderable-list.tsx`) is
 * touch-only. Normal state renders the page's real rows; `editing` collapses them to `label` + ▲/▼.
 */
export function ReorderableList<T>({ data, keyOf, renderRow, label, leading, onReorder, editing }: ReorderableListProps<T>) {
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const move = (from: number, to: number) => {
    if (to < 0 || to >= data.length) return;
    const keys = data.map(keyOf);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k as string);
    onReorder(keys);
  };
  return (
    <ScrollView contentContainerStyle={contentPadding} style={styles.host}>
      {editing ? (
        data.map((item, i) => (
          <ThemedView key={keyOf(item)} type="backgroundElement" style={styles.row}>
            {leading?.(item)}
            <ThemedText type="small" style={styles.label} numberOfLines={1}>
              {label(item)}
            </ThemedText>
            <Pressable
              disabled={i === 0}
              onPress={() => move(i, i - 1)}
              style={[styles.moveBtn, i === 0 && styles.moveBtnOff]}
              accessibilityRole="button"
              accessibilityLabel={`Move ${label(item)} up`}>
              <ArrowUpIcon color={theme.text} size={18} />
            </Pressable>
            <Pressable
              disabled={i === data.length - 1}
              onPress={() => move(i, i + 1)}
              style={[styles.moveBtn, i === data.length - 1 && styles.moveBtnOff]}
              accessibilityRole="button"
              accessibilityLabel={`Move ${label(item)} down`}>
              <ArrowDownIcon color={theme.text} size={18} />
            </Pressable>
          </ThemedView>
        ))
      ) : (
        <SettingsSection>{data.map((item) => renderRow(item))}</SettingsSection>
      )}
    </ScrollView>
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
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  label: {
    flex: 1,
  },
  moveBtn: {
    padding: Spacing.two,
    cursor: 'pointer',
  },
  moveBtnOff: {
    opacity: 0.3,
  },
});
