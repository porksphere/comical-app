import { useTabTrigger } from 'expo-router/ui';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { MaterialNavigationView } from '../../modules/material-navigation';
import { MATERIAL_NAV_ICONS } from '@/components/icons/material-nav-icons';
import { MaterialHost } from '@/components/material-host';
import type { MaterialNavProps } from '@/components/material-nav';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { useSettingsBadgeCount } from '@/data/use-settings-badge';
import { setBackdropRecede } from '@/lib/series-backdrop';

export const MATERIAL_NAV = true;

// Compose's short navigation bar and its collapsed wide rail.
export const MATERIAL_BAR_HEIGHT = 64;
export const MATERIAL_RAIL_WIDTH = 96;

const count = (n: number) => (n <= 0 ? undefined : n > 9 ? '9+' : String(n));

/**
 * Android's tab navigation: Material 3 Expressive's short navigation bar, or its rail, from the
 * `material-navigation` module. It addresses the routes the shell's hidden `TabList` registers,
 * as the shell's own buttons do, and fills the view it is put in.
 */
export function MaterialNav({ tabs, rail, onPress }: MaterialNavProps) {
  // One trigger's hook reaches every tab: `getTrigger` and `switchTab` take a name.
  const { switchTab, getTrigger } = useTabTrigger({ name: tabs[0]!.name });
  const badges: Record<string, string | undefined> = {
    activity: count(useActivityBadgeCount()),
    settings: count(useSettingsBadgeCount()),
  };
  const focused = tabs.find((tab) => getTrigger(tab.name)?.isFocused);
  const recedes = focused ? !focused.noRecede : undefined;
  useEffect(() => {
    if (recedes !== undefined) setBackdropRecede(recedes);
  }, [recedes]);
  return (
    <MaterialHost style={StyleSheet.absoluteFill}>
      <MaterialNavigationView
        rail={rail}
        selected={focused?.name ?? ''}
        items={tabs.map((tab) => ({
          key: tab.name,
          label: tab.label,
          ...MATERIAL_NAV_ICONS[tab.name]!,
          badge: badges[tab.name],
          testTag: `tab.${tab.name}`,
        }))}
        onSelect={({ nativeEvent: { key } }) => {
          const isFocused = key === focused?.name;
          onPress(key, isFocused);
          if (!isFocused) switchTab(key, {});
        }}
      />
    </MaterialHost>
  );
}
