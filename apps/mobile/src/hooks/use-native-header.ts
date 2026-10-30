import { use, useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderHeightContext } from 'expo-router/build/react-navigation/elements/Header/HeaderHeightContext.js';

import { useTopBarHeight } from '@/hooks/use-responsive';

/**
 * Whether the tab screens and the settings screens draw their top chrome as the system navigation
 * bar (a per-tab native Stack with Stack.Title / Stack.Toolbar / Stack.SearchBar items) instead of
 * the custom absolute TopBar / TabTitleBar overlay.
 *
 * iOS only: there the bar lives inside the UITabBarController, so when the system tab bar moves
 * to a side column (iPad sidebar, wide iPhones) the bar's toolbar items move with it — which is the
 * whole point. Android and web keep the custom overlay, which the icon rail already handles.
 */
export const NATIVE_HEADER = Platform.OS === 'ios';

/**
 * The height of the native navigation bar above this screen, status bar included, or 0 when the
 * screen has no native header (headerShown: false, or no native Stack around it at all).
 *
 * Read from the context directly rather than through useHeaderHeight, which throws outside a
 * header-bearing stack — and most of the app is outside one.
 *
 * A bar that hides (the reader's, with its chrome) reports 0 while it is gone, and the content
 * under it must not jump up and back, so the last height it showed at stands. A bar that is shown
 * is taken at its word, smaller included: a rotation to landscape shrinks it, and the content that
 * padded for the portrait bar would keep a band of dead space above it.
 */
export function useNativeHeaderHeight(): number {
  const reported = use(HeaderHeightContext) ?? 0;
  const [shown, setShown] = useState(reported);
  if (reported > 0 && reported !== shown) setShown(reported);
  return reported > 0 ? reported : shown;
}

/**
 * How far the top of the screen's content is from the top edge: the native bar's height on iOS,
 * the status bar plus the custom overlay bar elsewhere. Either way the content scrolls behind the
 * bar and pads itself by this much, so screens can swap one for the other without relayout.
 */
export function useTopChromeHeight(): number {
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  const native = useNativeHeaderHeight();
  return NATIVE_HEADER ? native : insets.top + barHeight;
}
