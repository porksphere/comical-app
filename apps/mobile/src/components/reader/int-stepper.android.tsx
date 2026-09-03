import { Host, Slider } from '@expo/ui/jetpack-compose';
import { StyleSheet, View } from 'react-native';

import type { IntStepperProps } from '@/components/reader/int-stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { testId } from '@/lib/test-id';

// Android: a discrete Material slider, hosted from Jetpack Compose — Material has no stepper, and
// a slider with one stop per value is its control for a small bounded number. The value is drawn
// beside it as ordinary text, so the number is selectable by testID the same way the web
// control's is. Dark, on the app's accent, like the sheet it sits in.
const ACCENT = '#3478F6';
const TRACK_WIDTH = 160;

export function IntStepper({ value, min, max, onChange, testIdPrefix }: IntStepperProps) {
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {value}
      </ThemedText>
      <Host matchContents={{ vertical: true }} colorScheme="dark" style={styles.host}>
        <Slider
          value={value}
          min={min}
          max={max}
          // Material counts the stops BETWEEN the ends.
          steps={Math.max(0, max - min - 1)}
          colors={{ thumbColor: ACCENT, activeTrackColor: ACCENT, inactiveTrackColor: 'rgba(255,255,255,0.25)' }}
          onValueChange={(v) => onChange(Math.round(v))}
        />
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  host: {
    width: TRACK_WIDTH,
  },
  value: {
    minWidth: 24,
    textAlign: 'center',
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
