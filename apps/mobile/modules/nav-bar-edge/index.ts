/**
 * `nav-bar-edge` reports how far the screen's navigation bar has slid away under iOS bar
 * minimization (0 at rest, minus the bar's height once gone), which UIKit tells nobody.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarEdgeProps = ViewProps & {
  onEdgeChange?: (event: { nativeEvent: { offset: number } }) => void;
};

export const NavBarEdge: ComponentType<NavBarEdgeProps> | null = requireOptionalNativeModule('NavBarEdge')
  ? requireNativeView<NavBarEdgeProps>('NavBarEdge')
  : null;
