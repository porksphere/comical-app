/**
 * `menu-anchor` — the system popup menu over a row React Native draws. Laid over a settings row
 * (`select-row.ios.tsx`) it is an invisible UIButton whose tap opens a UIMenu of checkmarked
 * options, each with its picture where it has one. The pictures are `file://` tiles already the
 * size and shape the menu shows them at (`lib/menu-thumb-files.ts`, clipped by `shaped-image`),
 * decoded natively at the screen's scale: a UIMenu draws the bitmap it is handed, and every
 * picture that reaches it through a JS-side loader arrives at 1× — blurry on a 3× screen.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type MenuAnchorOption = {
  value: string;
  label: string;
  /** A `file://` picture for the row, or undefined for a text-only row. */
  image?: string;
  /** Whether the row carries the checkmark. */
  on: boolean;
};

export type MenuAnchorProps = ViewProps & {
  /** The menu's heading, over its first option. */
  title?: string;
  options: MenuAnchorOption[];
  /** The button's name for assistive tech. */
  label?: string;
  onSelect?: (event: NativeSyntheticEvent<{ value: string }>) => void;
};

export const MenuAnchor: ComponentType<MenuAnchorProps> | null = requireOptionalNativeModule('MenuAnchor')
  ? requireNativeView<MenuAnchorProps>('MenuAnchor')
  : null;
