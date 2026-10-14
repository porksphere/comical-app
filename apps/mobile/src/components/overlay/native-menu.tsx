import type { ReactElement } from 'react';

/** One row of a `NativeMenu`. `checked` makes it a selection row (a check when true); omit it for a
 *  plain action. */
export type NativeMenuItem = {
  key: string;
  label: string;
  checked?: boolean;
  onSelect: () => void;
};

/** A titled block of rows, drawn as the platform's own menu section. */
export type NativeMenuSection = {
  key: string;
  title?: string;
  items: NativeMenuItem[];
};

export type NativeMenuProps = {
  sections: NativeMenuSection[];
  testID: string;
  /** What the menu opens from. On iOS SwiftUI owns the tap, so this must not be a `Pressable`. */
  children: ReactElement;
};

/**
 * The OS's own pull-down menu — UIKit's on iOS, Material's on Android. Web has none, so its callers
 * keep the overlay menu there (`OptionMenuButton`); this stub only gives the platform files a shared
 * type and is never rendered on web.
 */
export function NativeMenu({ children }: NativeMenuProps) {
  return children;
}
