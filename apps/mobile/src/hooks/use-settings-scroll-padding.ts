import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useInSettingsPane } from '@/lib/settings-pane';


import { BottomTabInset, SettingsGutter, SettingsTopGap, Spacing } from '@/constants/theme';
import { useTopBarHeight } from '@/hooks/use-responsive';

/** Height of the settings modal's floating close button plus the inset it sits at — the room a pane
 *  has to leave at its top so a row's trailing control never lands beneath it. */
export const SettingsCloseClearance = 32 + 8 * 2;

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
  // In the settings modal the screen has neither of the things this reserves room for: its `TopBar`
  // stands down (see `settings-pane`) and there is no tab bar under the panel. Paying for them
  // anyway left a bar's worth of empty space above the first row and a tab bar's worth below.
  const inPane = useInSettingsPane();
  if (inPane) {
    // `SettingsCloseClearance`, not a bare gap: the modal floats its close button in this corner, and
    // the first row's own trailing control would otherwise sit under it.
    return { paddingTop: SettingsCloseClearance, paddingBottom: Spacing.five, paddingHorizontal: SettingsGutter };
  }
  return {
    // Same value `useTopBarInset()` returns — the tab screen and the pushed screens have the same
    // bar, so they get the same inset without one of them having to know which it is.
    paddingTop: insets.top + barHeight + SettingsTopGap,
    paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
    paddingHorizontal: SettingsGutter,
  };
}
