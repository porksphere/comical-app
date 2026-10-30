/**
 * `nav-bar-leading` — owns a screen's leading navigation bar item: its picture, its name and its
 * menu. react-native-screens builds a bar item from the header config and replaces EVERY item,
 * unanimated, whenever any part of the config changes, so a menu pick that changes the button's
 * picture or a row's checkmark tore the whole bar down and redrew it. With this the screen gives
 * react-native-screens a placeholder that never changes, and `NavBarLeading` sets the live
 * picture, label and menu on the item itself: in place when they change, and again whenever the
 * bar rebuilds its items, as it does on every return to the screen. See `nav-bar-leading-menu`.
 *
 * The pictures are `file://` tiles already the size and shape they are drawn at
 * (`lib/menu-thumb-files.ts`), decoded here at the screen's scale and kept for the session: read
 * through React Native's loader the bar's would be blank for the first part of each pop back,
 * and a menu row's would never show at all.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type NavBarLeadingRow = {
  id: string;
  title: string;
  /** A `file://` picture for the row; it wins over `symbol`. */
  image?: string;
  /** An SF Symbol for a row without a picture. */
  symbol?: string;
  /** Whether the row carries the checkmark. */
  on?: boolean;
};

/** One inline section of the menu, its title over its rows. */
export type NavBarLeadingSection = { title: string; rows: NavBarLeadingRow[] };

export type NavBarLeadingProps = ViewProps & {
  /** The `file://` picture of the button, drawn as it is; `symbol` stands in without one. */
  image?: string;
  symbol: string;
  /** The button's name for assistive tech. */
  label: string;
  sections: NavBarLeadingSection[];
  onSelect: (event: NativeSyntheticEvent<{ id: string }>) => void;
};

export const NavBarLeading: ComponentType<NavBarLeadingProps> | null = requireOptionalNativeModule('NavBarLeading')
  ? requireNativeView<NavBarLeadingProps>('NavBarLeading')
  : null;
