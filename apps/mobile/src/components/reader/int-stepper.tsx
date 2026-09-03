import { Pressable, StyleSheet, View } from 'react-native';

import { MinusIcon, PlusIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

// A bounded whole number, on the reader sheet's dark palette. This is the WEB (and fallback)
// version: a −/+ pair around the value, the same control the Settings screen gives a numeric
// field. iOS and Android each get the platform's own control instead — see the `.ios.tsx` and
// `.android.tsx` siblings — since neither platform draws a stepper the way the other does, and
// a native control is what a settings row is expected to hold there.

export type IntStepperProps = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** `<prefix>.value` names the number; the web control adds `.decrement` / `.increment`. */
  testIdPrefix: string;
};

export function IntStepper({ value, min, max, onChange, testIdPrefix }: IntStepperProps) {
  return (
    <View style={styles.row}>
      <StepButton
        icon="minus"
        testID={testId(testIdPrefix, 'decrement')}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
      />
      <ThemedText testID={testId(testIdPrefix, 'value')} style={styles.value}>
        {value}
      </ThemedText>
      <StepButton
        icon="plus"
        testID={testId(testIdPrefix, 'increment')}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
      />
    </View>
  );
}

function StepButton({ icon, onPress, disabled, testID }: { icon: 'minus' | 'plus'; onPress: () => void; disabled: boolean; testID: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.button, disabled && styles.buttonDisabled]}>
      {icon === 'minus' ? <MinusIcon color="#fff" size={16} /> : <PlusIcon color="#fff" size={16} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  value: {
    minWidth: 24,
    textAlign: 'center',
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  button: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    ...ContinuousCorner,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
