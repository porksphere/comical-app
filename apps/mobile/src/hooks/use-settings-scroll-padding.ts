import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, SettingsGutter, SettingsTopGap, Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';

/**
 * The scroll-content padding shared by every settings screen — the landing tab, the pushed category
 * screens, and the detail screens (bridge/tracker settings, registry browse, diagnostics) alike.
 *
 * This exists because all ten of them were spelling the same expression out by hand:
 *
 *     paddingTop: topBarInset + SettingsTopGap,
 *     paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
 *     paddingHorizontal: SettingsGutter,
 *
 * which meant ten chances to drift. The horizontal one matters most: rows cancel exactly
 * `SettingsGutter` with a negative margin to reach the screen's edge, so a screen that padded itself
 * differently would have its rows overhang or fall short. Getting it from here makes that impossible.
 *
 * The top bar is an absolute overlay on all of these screens, so the content pads PAST it (and
 * scrolls behind it) rather than starting below it.
 */
export function useSettingsScrollPadding() {
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();
  return {
    // Same value `useTopBarInset()` returns — the tab screen and the pushed screens have the same
    // bar, so they get the same inset without one of them having to know which it is.
    paddingTop: insets.top + barHeight + SettingsTopGap,
    paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
    paddingHorizontal: SettingsGutter,
  };
}
