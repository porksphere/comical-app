/**
 * `nav-bar-fade` crossfades a screen's navigation bar whenever react-native-screens changes its
 * title or its material, which it otherwise swaps in one frame.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarFadeProps = ViewProps & {
  /** TEMPORARY: the bar's state at each switch, for the Diagnostics screen. */
  onTrace?: (event: { nativeEvent: { message: string } }) => void;
};

export const NavBarFade: ComponentType<NavBarFadeProps> | null = requireOptionalNativeModule('NavBarFade')
  ? requireNativeView<NavBarFadeProps>('NavBarFade')
  : null;
