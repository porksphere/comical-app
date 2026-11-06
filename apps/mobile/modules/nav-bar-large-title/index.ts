/**
 * `nav-bar-large-title` — the mode of a screen's iOS large title. react-native-screens sets
 * `always` (a row of its own under the items, collapsing on scroll) or `never`; `inline` is
 * UIKit's third, the large title on the bar's own row beside the trailing items, never
 * collapsing, the way Photos titles its tabs. `NavBarLargeTitle` is a zero-size view in the page
 * that sets the mode on the screen and keeps it set across the library's header updates. See
 * `native-tab-header`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed): the screen
 * then shows the library's `always` large title.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarLargeTitleProps = ViewProps & {
  mode: 'inline' | 'always' | 'never';
};

export const NavBarLargeTitle: ComponentType<NavBarLargeTitleProps> | null = requireOptionalNativeModule('NavBarLargeTitle')
  ? requireNativeView<NavBarLargeTitleProps>('NavBarLargeTitle')
  : null;
