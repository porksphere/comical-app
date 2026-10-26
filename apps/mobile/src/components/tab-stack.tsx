import { Slot, Stack } from 'expo-router';

import { NATIVE_HEADER } from '@/hooks/use-native-header';

/**
 * The layout of every tab directory. On iOS each tab is its own native Stack so the tab screen
 * gets a UINavigationBar INSIDE the UITabBarController — that is what lets UIKit carry the bar's
 * toolbar items over to the side column together with the tabs. Elsewhere the tab is just its
 * screen, which draws the custom TabTitleBar overlay as before.
 *
 * The bar is transparent so the content scrolls behind it exactly as it did behind the overlay
 * (and pads itself by useTopChromeHeight); the blur is what keeps it readable over covers.
 */
export default function TabStack() {
  if (!NATIVE_HEADER) return <Slot />;
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerBlurEffect: 'systemChromeMaterial',
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    />
  );
}
