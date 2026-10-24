import { Host, Slider } from '@expo/ui/swift-ui';
import { StyleSheet, View } from 'react-native';

import { snapToStep, type RangeSliderProps } from '@/components/settings/range-slider-shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveColorScheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

export type { RangeSliderProps } from '@/components/settings/range-slider-shared';

// iOS: the system slider, hosted from SwiftUI, stepping between the stops. The value reads beside
// it as ordinary text (SwiftUI's own label would sit above the track). The host is given its frame
// outright and told to ignore the safe area, for the reasons IntStepper's iOS sibling gives.
const TRACK_WIDTH = 160;
const TRACK_HEIGHT = 32;

export function RangeSlider({ value, min, max, step, onChange, format, testIdPrefix }: RangeSliderProps) {
  const scheme = useActiveColorScheme();
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {format(value)}
      </ThemedText>
      <Host colorScheme={scheme} style={styles.host} ignoreSafeArea="all">
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => onChange(snapToStep(v, min, max, step))}
        />
      </Host>
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
