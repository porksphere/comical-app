import { Host, Slider } from '@expo/ui/jetpack-compose';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { IntStepperProps } from '@/components/reader/int-stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

// Android: a discrete Material slider, hosted from Jetpack Compose — Material has no stepper, and
// a slider with one stop per value is its control for a small bounded number. The value is drawn
// beside it as ordinary text, so the number is selectable by testID the same way the web
// control's is. The host is given its frame outright (see the iOS sibling for why).
const TRACK_WIDTH = 160;
const TRACK_HEIGHT = 44;

export function IntStepper({ value, min, max, onChange, testIdPrefix, tone = 'theme', deferMountMs = 0 }: IntStepperProps) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const dark = tone === 'dark';
  const mounted = useDeferredMount(deferMountMs);
  return (
    <View style={styles.row}>
      <ThemedText testID={testId(testIdPrefix, 'value')} style={[styles.value, { color: dark ? '#fff' : theme.text }]}>
        {value}
      </ThemedText>
      {!mounted && <View style={styles.host} />}
      {mounted && (
      <Host colorScheme={dark ? 'dark' : scheme} style={styles.host}>
        <Slider
          value={value}
          min={min}
          max={max}
          // Material counts the stops BETWEEN the ends.
          steps={Math.max(0, max - min - 1)}
          colors={{
            thumbColor: theme.accent,
            activeTrackColor: theme.accent,
            inactiveTrackColor: dark ? 'rgba(255,255,255,0.25)' : theme.backgroundSelected,
          }}
          onValueChange={(v) => onChange(Math.round(v))}
        />
      </Host>
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
    gap: Spacing.two,
  },
  host: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
  },
  value: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
