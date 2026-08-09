import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { pinTabBar } from '@/lib/tab-bar-visibility';

/**
 * The opposite of `useHideTabBarOnScroll`: this screen keeps the bottom bar, however far it scrolls.
 * Held only while the screen is focused, so it can't leak the pin to whatever the user goes to next.
 *
 * Use it INSTEAD of `useHideTabBarOnScroll` — a screen that reports its scroll would only be feeding
 * a store that now ignores it (see `setTabBarProgress`), and would still be broadcasting scroll
 * phases that other subscribers act on.
 *
 * Settings is where this earns its keep. The auto-hide is for reading surfaces — a grid or a reader
 * page you want the full screen for — and Settings is neither: it's a list of destinations you scan
 * and tap, where the nav sliding out from under the finger is pure loss. Every settings screen is
 * also short enough to reach the end of, and hiding chrome at the bottom of a list that's already
 * finished is the least useful moment to do it.
 */
export function usePinnedTabBar(): void {
  useFocusEffect(useCallback(() => pinTabBar(), []));
}
