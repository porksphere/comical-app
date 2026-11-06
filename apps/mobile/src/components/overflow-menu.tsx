import type { ReactNode } from 'react';

import type { MenuRowSpec } from '@/components/context-menu-material';

export type OverflowMenuProps = {
  /** Built when the button is pressed, so the labels read the current state. */
  rows: () => MenuRowSpec[];
  testID: string;
  /** What the button is, to a screen reader. */
  label: string;
  disabled?: boolean;
};

/** Whether this platform reaches an item's actions through its ⋮ rather than by holding it. */
export const OVERFLOW_MENU: boolean = false;

/**
 * A ⋮ button with a menu of an item's actions, the way Android offers them
 * (overflow-menu.android.tsx). iOS and web reach the same rows by holding or right-clicking the
 * item, so here it renders nothing.
 */
export const OverflowMenu: (props: OverflowMenuProps) => ReactNode = () => null;
