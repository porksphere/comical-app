import { Host, Stepper } from '@expo/ui/swift-ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { IntStepperProps } from '@/components/reader/int-stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

// iOS: the system stepper, hosted from SwiftUI. Its own label is left empty and the value is
// drawn beside it as ordinary text, so the number is selectable by testID the same way the web
// control's is.
//
// The host is given the control's size OUTRIGHT rather than asked to match its content, and
// told to ignore the safe area (see below). A UIStepper is 94×32pt on every iOS, so that is the
// frame.
const STEPPER_WIDTH = 94;
const STEPPER_HEIGHT = 32;

export function IntStepper({ value, min, max, onChange, testIdPrefix, tone = 'theme', deferMountMs = 0 }: IntStepperProps) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const mounted = useDeferredMount(deferMountMs);
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={[styles.value, { color: tone === 'dark' ? '#fff' : theme.text }]}>
        {value}
      </ThemedText>
      {/* `ignoreSafeArea`: SwiftUI keeps its content out of the safe area by default, and a host at
          the bottom of the sheet was pushed up by the home indicator's inset — the whole control
          drawn a row above where it belonged. */}
      {mounted ? (
        <Host colorScheme={tone === 'dark' ? 'dark' : scheme} style={styles.host} ignoreSafeArea="all">
          <Stepper label="" value={value} min={min} max={max} step={1} onValueChange={(v) => onChange(Math.round(v))} />
        </Host>
      ) : (
        <View style={styles.host} />
      )}
    </View>
  );
}

/** True once `ms` have passed since mount (at once for 0) — see `deferMountMs`. */
function useDeferredMount(ms: number): boolean {
  const [mounted, setMounted] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const id = setTimeout(() => setMounted(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return mounted;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  host: {
    width: STEPPER_WIDTH,
    height: STEPPER_HEIGHT,
  },
  value: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
