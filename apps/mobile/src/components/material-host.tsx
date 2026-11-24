import { Host, type HostProps } from '@expo/ui/jetpack-compose';

import { useMaterialHostTheme } from '@/hooks/use-theme';

/**
 * The host of every Jetpack Compose island: themed from the palette `useTheme` hands the React
 * Native views around it (the wallpaper's or the seeded one, pure black or not), so the two cannot
 * disagree. Imported by `.android` files only, so no other bundle carries Compose.
 */
export function MaterialHost(props: Omit<HostProps, 'colorScheme' | 'seedColor' | 'colorOverrides'>) {
  return <Host {...useMaterialHostTheme()} {...props} />;
}
