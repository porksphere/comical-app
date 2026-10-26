import { usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { useSettingsBadgeCount } from '@/data/use-settings-badge';
import { ContentWidthProvider } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { scrollToTopFor } from '@/lib/reselect-scroll';
import { ROOT_TAB_PATHS } from '@/lib/root-tabs';
import { setBackdropRecede, useSeriesReaderBackdropDimStyle, useSeriesReaderBackdropStyle } from '@/lib/series-backdrop';

/**
 * iOS: the real `UITabBarController`, through `NativeTabs`. Android and web keep the custom bar in
 * `app-tabs.tsx` (Metro picks this file by platform; the route layout imports `app-tabs`).
 *
 * The point is what UIKit does with the bar on its own: the sidebar on iPad, and the side-mounted
 * symbol bar the system draws when a resizable scene is at the regular width class — the layout an
 * adaptable app gets for free and a custom bar can only imitate. `sidebarAdaptable` is what opts the
 * controller into that (iOS 18+ on iPad; iOS 27+ on the wide iPhones). Nothing here asks for a minimize
 * behaviour: `tabBarMinimizeBehavior` was the dead end that got the previous native shell reverted
 * (it only re-expanded at the very top), and the default bar is what every system app shows.
 *
 * Route NAMES (`index`, `library`, …) are the trigger names; the TABS table in `app-tabs.tsx` keys
 * everything else by the tab's own name (`browse`, …), so the two are mapped here once.
 */
const TAB_OF_ROUTE: Record<string, keyof typeof ROOT_TAB_PATHS> = {
  index: 'browse',
  library: 'library',
  history: 'history',
  activity: 'activity',
  settings: 'settings',
};

/** The tabs whose rows reorder as you read — see `noRecede` in `app-tabs.tsx`. */
const NO_RECEDE = new Set<string>([ROOT_TAB_PATHS.history, ROOT_TAB_PATHS.activity]);

export default function AppTabs() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const pathname = usePathname();
  const activityBadge = useActivityBadgeCount();
  const settingsBadge = useSettingsBadgeCount();
  const backdropStyle = useSeriesReaderBackdropStyle();
  const dimStyle = useSeriesReaderBackdropDimStyle();

  useEffect(() => {
    if ((Object.values(ROOT_TAB_PATHS) as string[]).includes(pathname)) setBackdropRecede(!NO_RECEDE.has(pathname));
  }, [pathname]);

  // The content column's width: the window on a phone, less the sidebar when UIKit mounts the bar
  // beside the content (iPad, a regular-width resizable scene). Each trigger's native screen view is
  // laid out to exactly that column, and the grids divide it into cards.
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const onContentLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setContentWidth(w);
  }, []);
  // The screen's props are typed without `ViewProps`, but the native spec extends it and the iOS
  // component spreads every unlisted prop onto the screen view, so the layout callback does arrive.
  const measured = { onLayout: onContentLayout } as ComponentProps<typeof NativeTabs.Trigger>['unstable_nativeProps'];

  // Emitted before the selection moves, so the tab whose root the pathname is on was re-tapped.
  // (The listener is re-read at emit time, so the pathname it closes over is the current one.)
  const screenListeners = useCallback(
    ({ route }: { route: { name: string } }) => ({
      tabPress: () => {
        const tab = TAB_OF_ROUTE[route.name];
        if (tab && ROOT_TAB_PATHS[tab] === pathname) scrollToTopFor(tab);
      },
    }),
    [pathname],
  );

  return (
    <Animated.View style={[styles.root, backdropStyle]}>
      <ContentWidthProvider width={contentWidth ?? windowWidth} sidebar={false}>
        <NativeTabs
          sidebarAdaptable
          tintColor={theme.tabIconActive}
          iconColor={theme.tabIconInactive}
          screenListeners={screenListeners}>
          <NativeTabs.Trigger name="index" disableAutomaticContentInsets unstable_nativeProps={measured}>
            <NativeTabs.Trigger.Label>Browse</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={{ default: 'safari', selected: 'safari.fill' }} />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="library" disableAutomaticContentInsets unstable_nativeProps={measured}>
            <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }} />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="history" disableAutomaticContentInsets unstable_nativeProps={measured}>
            <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="activity" disableAutomaticContentInsets unstable_nativeProps={measured}>
            <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} />
            <NativeTabs.Trigger.Badge hidden={activityBadge === 0}>{String(activityBadge)}</NativeTabs.Trigger.Badge>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="settings" disableAutomaticContentInsets unstable_nativeProps={measured}>
            <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
            <NativeTabs.Trigger.Badge hidden={settingsBadge === 0}>{String(settingsBadge)}</NativeTabs.Trigger.Badge>
          </NativeTabs.Trigger>
        </NativeTabs>
      </ContentWidthProvider>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dim: { backgroundColor: '#000' },
});
