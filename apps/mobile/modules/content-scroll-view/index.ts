/**
 * `content-scroll-view` tells the screen's view controller which list under it is its content, so
 * the navigation bar can follow a list UIKit wouldn't find for itself. See `ScreenScrollMarker`.
 *
 * `tabBar` names the list for the tab bar too, and `scrollToTop` (on the ref) scrolls it: for a
 * tab root whose list is a SwiftUI one (the Settings form), which react-native-screens' marker
 * can't hold and so can't scroll on the tab's reselect. `scrolledPast` has it report, through
 * `onScrolledPast`, whether the list has scrolled past that many points from its rest at the top,
 * for a bar that takes its material only once content is under it. `topEdge` sets the list's top
 * scroll edge effect (iOS 26) where the list is found: for a list react-native-screens can't reach
 * with the screen's own option, a SwiftUI one deep in its host.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, Ref } from 'react';
import type { ViewProps } from 'react-native';

export type ContentScrollAnchorRef = { scrollToTop(): Promise<void> };

export type ContentScrollAnchorProps = ViewProps & {
  active?: boolean;
  tabBar?: boolean;
  scrolledPast?: number;
  onScrolledPast?: (event: { nativeEvent: { past: boolean } }) => void;
  topEdge?: 'hidden' | 'soft' | 'hard' | 'automatic';
  ref?: Ref<ContentScrollAnchorRef>;
};

export const ContentScrollAnchor: ComponentType<ContentScrollAnchorProps> | null = requireOptionalNativeModule('ContentScrollView')
  ? requireNativeView<ContentScrollAnchorProps>('ContentScrollView')
  : null;
