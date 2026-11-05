import { Stack } from 'expo-router';

import type { AddFabProps } from '@/components/add-fab';
import { useHidesNativeTabBar } from '@/lib/native-tab-bar';

/**
 * The add affordance as the screen's system bottom toolbar, where iOS 26 puts it (Notes, Reminders):
 * a plus at the trailing end. Under the system tab bar the toolbar is laid out BENEATH it, so the
 * tab bar is hidden while this is on screen (a page pushed inside the Settings tab); the position
 * props are the floating button's and go unused. The select mode's toolbar
 * (`select-pill-bar.ios`) takes the same slot while it is on, as the caller swaps the two.
 */
export function AddFab({ onPress, label = 'Add' }: AddFabProps) {
  useHidesNativeTabBar();
  return (
    <Stack.Toolbar placement="bottom">
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button icon="plus" accessibilityLabel={label} onPress={onPress} />
    </Stack.Toolbar>
  );
}
