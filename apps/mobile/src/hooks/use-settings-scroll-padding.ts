import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useInSettingsPane } from '@/lib/settings-pane';


import { BottomTabInset, MaxContentWidth, SettingsCardInset, SettingsGutter, SettingsTopGap, Spacing } from '@/constants/theme';
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
 * which meant ten chances to drift. The horizontal one is what insets every card from the screen's
 * edge, so a screen that padded itself differently would have its cards out of line with the rest.
 * Getting it from here makes that impossible.
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
    return {
      paddingTop: SettingsTopGap,
      paddingBottom: Spacing.five,
      paddingHorizontal: SettingsGutter,
      // Lifts the reading-column cap each screen's own content style carries, so a row runs the
      // pane's width the way it runs the screen's on a phone. It only works applied AFTER that
      // style, which is the order every screen already spreads this in.
      maxWidth: '100%' as const,
    };
  }
  return {
    // Same value `useTopBarInset()` returns — the tab screen and the pushed screens have the same
    // bar, so they get the same inset without one of them having to know which it is.
    paddingTop: insets.top + barHeight + SettingsTopGap,
    paddingBottom: BottomTabInset + insets.bottom + Spacing.five,
    paddingHorizontal: SettingsGutter,
  };
}

/**
 * The side padding for a settings screen whose rows are a virtualized list's own children: a list
 * ignores `maxWidth`/`alignSelf` on its content container, so its column is centred by padding
 * instead. In the pane there is no column to centre — see the `maxWidth` above.
 */
export function useSettingsSidePad(width: number): number {
  const inPane = useInSettingsPane();
  return SettingsGutter + (inPane ? 0 : Math.max(0, (width - MaxContentWidth) / 2));
}

/**
 * The content padding for such a list's ROWS. A virtualized list has no card (its rows are recycled
 * views, not a group), so it is laid out plain: the list is pulled in by the row's own text inset
 * and the rows' text lands at the gutter, where a card's would. Anything else in the list's content
 * (a header, an intro) pads itself back out by `SettingsCardInset`.
 */
export function useSettingsListPad(width: number): number {
  return useSettingsSidePad(width) - SettingsCardInset;
}
