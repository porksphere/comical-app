import { Host, Stepper } from '@expo/ui/swift-ui';
import { StyleSheet, View } from 'react-native';

import type { IntStepperProps } from '@/components/reader/int-stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { testId } from '@/lib/test-id';

// iOS: the system stepper, hosted from SwiftUI. Its own label is left empty and the value is
// drawn beside it as ordinary text, so the number is selectable by testID the same way the web
// control's is. Dark, like the sheet it sits in.
export function IntStepper({ value, min, max, onChange, testIdPrefix }: IntStepperProps) {
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {value}
      </ThemedText>
      <Host matchContents colorScheme="dark">
        <Stepper label="" value={value} min={min} max={max} step={1} onValueChange={(v) => onChange(Math.round(v))} />
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
  value: {
    minWidth: 24,
    textAlign: 'center',
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
