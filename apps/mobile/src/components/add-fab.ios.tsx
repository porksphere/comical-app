import { Stack } from 'expo-router';

import type { AddFabProps } from '@/components/add-fab';

/**
 * The add affordance as the screen's system bottom toolbar, where iOS 26 puts it (Notes, Reminders):
 * a plus at the trailing end. The pushed settings screens sit over the tab bar, so the toolbar has
 * the bottom to itself; the position props are the floating button's and go unused. The select
 * mode's toolbar (`select-pill-bar.ios`) takes the same slot while it is on, as the caller swaps
 * the two.
 */
export function AddFab({ onPress, label = 'Add' }: AddFabProps) {
  return (
    <Stack.Toolbar placement="bottom">
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button icon="plus" accessibilityLabel={label} onPress={onPress} />
    </Stack.Toolbar>
  );
}
