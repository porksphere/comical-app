/**
 * `nav-bar-image` — keeps a screen's leading navigation bar item showing its picture. The bar
 * reads a file picture through React Native's loader, off the main thread and uncached, and
 * react-native-screens rebuilds the items on every return to the screen, so the item would be
 * blank for the first part of each pop back. `NavBarLeadingImage` holds the decoded image and
 * sets it on the leading item as soon as the items are rebuilt; see `browse-native-toolbar`.
 * The item's menu rows never get a file picture at all that way — the loader's copy lands after
 * the menu was built and copied — so their pictures (`menuImages`) are set here too.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

export type NavBarLeadingImageProps = ViewProps & {
  /** The `file://` picture of the screen's leading bar item, or undefined while it has none. */
  uri?: string;
  /** The `file://` picture of each row of the item's menu, by the row's title. */
  menuImages?: Record<string, string>;
};

export const NavBarLeadingImage: ComponentType<NavBarLeadingImageProps> | null = requireOptionalNativeModule(
  'NavBarImage',
)
  ? requireNativeView<NavBarLeadingImageProps>('NavBarImage')
  : null;
