import { Switch, type SwitchProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** `Switch` tinted with the app's accent color instead of the OS default (green
 *  on iOS/Android), so every toggle in Settings reads as the same control. */
export function ThemedSwitch(props: SwitchProps) {
  const theme = useTheme();
  return (
    <Switch
      trackColor={{ false: theme.backgroundSelected, true: theme.accent }}
      thumbColor={theme.accentOn}
      ios_backgroundColor={theme.backgroundSelected}
      {...props}
    />
  );
}
