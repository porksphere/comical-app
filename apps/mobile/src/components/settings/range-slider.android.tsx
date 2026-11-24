import { Slider } from '@expo/ui/jetpack-compose';
import { StyleSheet, View } from 'react-native';

import { MaterialHost } from '@/components/material-host';
import { snapToStep, type RangeSliderProps } from '@/components/settings/range-slider-shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { testId } from '@/lib/test-id';

export type { RangeSliderProps } from '@/components/settings/range-slider-shared';

// Android: the Material slider, hosted from Jetpack Compose, with a tick per stop. The value reads
// beside it as ordinary text. The host is given its frame outright, as IntStepper's Android
// sibling is.
const TRACK_WIDTH = 160;
const TRACK_HEIGHT = 44;

export function RangeSlider({ value, min, max, step, onChange, format, testIdPrefix }: RangeSliderProps) {
  const stops = Math.round((max - min) / step);
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {format(value)}
      </ThemedText>
      <MaterialHost style={styles.host}>
        <Slider
          value={value}
          min={min}
          max={max}
          // Material counts the stops BETWEEN the ends.
          steps={Math.max(0, stops - 1)}
          onValueChange={(v) => onChange(snapToStep(v, min, max, step))}
        />
      </MaterialHost>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  host: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
  },
  value: {
    minWidth: 40,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
