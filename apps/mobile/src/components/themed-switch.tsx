import { StyleSheet, Switch, type SwitchProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';

/** `Switch` tinted with the app's accent color instead of the OS default (green
 *  on iOS/Android), so every toggle in Settings reads as the same control. Fires
 *  a light haptic tick on every flip, matching the native switch feel. */
export function ThemedSwitch({ onValueChange, style, ...props }: SwitchProps) {
  const theme = useTheme();
  return (
    <Switch
      trackColor={{ false: theme.backgroundSelected, true: theme.accent }}
      thumbColor={theme.accentOn}
      ios_backgroundColor={theme.backgroundSelected}
      // RN's iOS Switch hard-codes `alignSelf: 'flex-start'` into its own style, which in a row
      // means TOP and silently beats the row's `alignItems: 'center'` — so on iOS (only) every
      // toggle floated above the middle of its settings row. Ours centers instead, and a caller's
      // own `style` still overrides it (it comes last in the array).
      style={[styles.centered, style]}
      onValueChange={(v) => {
        hapticSelection();
        onValueChange?.(v);
      }}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    alignSelf: 'center',
  },
});
