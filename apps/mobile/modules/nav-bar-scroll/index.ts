/**
 * `nav-bar-scroll` — names the scroll view a screen's iOS navigation bar follows, so the bar can
 * be bare while the list is at the top and take its material once scrolled (`tab-stack`'s
 * scrolled material). UIKit finds that scroll view by itself only down a screen's first
 * subviews, which a feed with a backdrop in front of its list defeats; see `TabScrollMarker`.
 *
 * `NavBarScrollAnchor` wraps the list: natively, each time it enters a window (the mount, and
 * every return to the screen), it hands the first scroll view under it to the view controller
 * owning it. `onFollow` reports each hand-off or failure once, as the outcome changes.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed): the bar
 * then keeps whichever appearance UIKit settles on by itself.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarScrollReport = { ok: true; [detail: string]: unknown } | { ok: false; reason: string };

export type NavBarScrollAnchorProps = ViewProps & {
  onFollow?: (event: { nativeEvent: NavBarScrollReport }) => void;
};

export const NavBarScrollAnchor: ComponentType<NavBarScrollAnchorProps> | null = requireOptionalNativeModule(
  'NavBarScroll',
)
  ? requireNativeView<NavBarScrollAnchorProps>('NavBarScroll')
  : null;
