/**
 * The multi-select header strip: "N selected" + All / Invert / Clear text actions, with the
 * consumer's primary CTA rendered full-width beneath (e.g. "Download 12"). List-agnostic — pairs
 * with `useMultiSelect` + `SelectableRow` on any screen.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

export function SelectBar({
  count,
  onAll,
  onInvert,
  onClear,
  cta,
  testID = 'multi-select',
}: {
  count: number;
  onAll: () => void;
  onInvert: () => void;
  onClear: () => void;
  cta: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const action = (label: string, onPress: () => void) => (
    <Pressable testID={testId(testID, label.toLowerCase())} onPress={onPress} hitSlop={6}>
      <ThemedText type="small" style={{ color: theme.accent }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.strip}>
        <ThemedText type="smallBold" testID={testId(testID, 'count')}>
          {count} selected
        </ThemedText>
        <View style={styles.actions}>
          {action('All', onAll)}
          {action('Invert', onInvert)}
          {action('Clear', onClear)}
        </View>
      </View>
      {cta}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
});
