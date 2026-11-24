/**
 * `material-navigation` — Material 3 Expressive's navigation components, which `@expo/ui` does not
 * ship: the short navigation bar, and the wide navigation rail for a window wide enough for one.
 * One Jetpack Compose view, composed inside a `MaterialHost`, whose theme it takes. Android only;
 * `components/material-nav.android.tsx` is what draws it.
 */
import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type MaterialNavigationItem = {
  key: string;
  label: string;
  /** A Material Symbol's path, in its 960 by 960 viewport (`icons/material-nav-icons.ts`). */
  icon: string;
  /** Drawn in place of `icon` while the item is the selected one. */
  selectedIcon?: string;
  /** A count on the icon. */
  badge?: string;
  /** The item's id to a UI test. */
  testTag?: string;
};

export type MaterialNavigationProps = {
  items: MaterialNavigationItem[];
  /** The selected item's `key`. */
  selected: string;
  /** The rail down a side, in place of the bar along the bottom. */
  rail?: boolean;
  onSelect: (event: { nativeEvent: { key: string } }) => void;
  style?: StyleProp<ViewStyle>;
};

export const MaterialNavigationView: ComponentType<MaterialNavigationProps> = requireNativeView(
  'MaterialNavigation',
  'MaterialNavigationView',
);
