import { StyleSheet, View } from 'react-native';

import type { RangeSliderProps } from '@/components/settings/range-slider';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

export type { RangeSliderProps } from '@/components/settings/range-slider';

// The browser's own range input, tinted with the accent (`accent-color` restyles the thumb and the
// filled track in every engine without replacing the control, so the keyboard and the scroll wheel
// keep working on it). The value reads beside it, since a bare thumb says nothing about where it is.
const TRACK_WIDTH = 160;

export function RangeSlider({ value, min, max, step, onChange, format, testIdPrefix }: RangeSliderProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {format(value)}
      </ThemedText>
      <input
        data-testid={testId(testIdPrefix, 'track')}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={{ width: TRACK_WIDTH, margin: 0, accentColor: theme.accent, cursor: 'pointer' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  value: {
    minWidth: 40,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
