/**
 * `nav-bar-fade` crossfades a screen's navigation bar whenever react-native-screens changes its
 * title or its material, which it otherwise swaps in one frame. Loading it also stops a header
 * update from restarting a bar's slide-away (see `MinimizationGuard` in the Swift).
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export const NavBarFade: ComponentType<ViewProps> | null = requireOptionalNativeModule('NavBarFade')
  ? requireNativeView<ViewProps>('NavBarFade')
  : null;
