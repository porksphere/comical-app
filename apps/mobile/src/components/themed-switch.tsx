import { Switch, type SwitchProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';

/** `Switch` tinted with the app's accent color instead of the OS default (green
 *  on iOS/Android), so every toggle in Settings reads as the same control. Fires
 *  a light haptic tick on every flip, matching the native switch feel. */
export function ThemedSwitch({ onValueChange, ...props }: SwitchProps) {
  const theme = useTheme();
  return (
    <Switch
      trackColor={{ false: theme.backgroundSelected, true: theme.accent }}
      thumbColor={theme.accentOn}
      ios_backgroundColor={theme.backgroundSelected}
      onValueChange={(v) => {
        hapticSelection();
        onValueChange?.(v);
      }}
      {...props}
    />
  );
}
