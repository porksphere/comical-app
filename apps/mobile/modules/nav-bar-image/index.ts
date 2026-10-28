/**
 * `nav-bar-image` — keeps a screen's leading navigation bar item showing its picture. The bar
 * reads a file picture through React Native's loader, off the main thread and uncached, and
 * react-native-screens rebuilds the items on every return to the screen, so the item would be
 * blank for the first part of each pop back. `NavBarLeadingImage` holds the decoded image and
 * sets it on the leading item as soon as the items are rebuilt; see `browse-native-toolbar`.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarLeadingImageProps = ViewProps & {
  /** The `file://` picture of the screen's leading bar item, or undefined while it has none. */
  uri?: string;
};

export const NavBarLeadingImage: ComponentType<NavBarLeadingImageProps> | null = requireOptionalNativeModule(
  'NavBarImage',
)
  ? requireNativeView<NavBarLeadingImageProps>('NavBarImage')
  : null;
