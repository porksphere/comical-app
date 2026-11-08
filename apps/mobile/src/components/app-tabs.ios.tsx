import { usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Dimensions, type LayoutChangeEvent } from 'react-native';

import { navModeFor } from '@/constants/size-class';
import { useActivityBadgeCount } from '@/data/activity/use-activity-badge';
import { useSettingsBadgeCount } from '@/data/use-settings-badge';
import { ContentWidthProvider } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { useWindowSize } from '@/hooks/use-window-size';
import { useNativeTabBarHidden } from '@/lib/native-tab-bar';
import { scrollToTopFor } from '@/lib/reselect-scroll';
import { ROOT_TAB_PATHS } from '@/lib/root-tabs';
import { setBackdropRecede } from '@/lib/series-backdrop';

/**
 * iOS: the real `UITabBarController`, through `NativeTabs`. Android and web keep the custom bar in
 * `app-tabs.tsx` (Metro picks this file by platform; the route layout imports `app-tabs`).
 *
 * The point is what UIKit does with the bar on its own: the sidebar on iPad, and the side-mounted
 * symbol bar the system draws when a resizable scene is at the regular width class — the layout an
 * adaptable app gets for free and a custom bar can only imitate. `sidebarAdaptable` is what opts the
 * controller into that (iOS 18+ on iPad; iOS 27+ on the wide iPhones). Where the sidebar can show,
 * `preferredPlacement` (iOS 27+) asks for it at the widths Android and web give the labelled
 * sidebar (`navModeFor`), and leaves the choice to UIKit below that.
 *
 * The bar never minimizes (`minimizeBehavior="never"`): it stays as it is while the content scrolls,
 * as in most of Apple's own apps. iOS 26's hide-on-scroll shrank it to the selected tab's capsule
 * and brought it back only at the top or on a tap, which is UIKit's design and can't be changed from
 * outside (react-native-screens #3954). Each tab root's list is still registered with it through
 * `ScreenScrollMarker`, for the status bar's tap-to-top.
 *
 * Route NAMES (`(home)`, `library`, …) are the trigger names; the TABS table in `app-tabs.tsx` keys
 * everything else by the tab's own name (`browse`, …), so the two are mapped here once.
 *
 * The bar stays up over every page a tab pushes (they live in the tab's own stack — see
 * `tab-stack`) and goes only under the reader (`native-tab-bar`). The series page's backdrop —
 * the scale and dim behind it — is per screen inside the tab stacks now, not around this shell.
 */
const TAB_OF_ROUTE: Record<string, keyof typeof ROOT_TAB_PATHS> = {
  '(home)': 'browse',
  library: 'library',
  history: 'history',
  activity: 'activity',
  settings: 'settings',
};

/** The tabs whose rows reorder as you read — see `noRecede` in `app-tabs.tsx`. */
const NO_RECEDE = new Set<string>([ROOT_TAB_PATHS.history, ROOT_TAB_PATHS.activity]);

export default function AppTabs() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowSize();
  const pathname = usePathname();
  const activityBadge = useActivityBadgeCount();
  const settingsBadge = useSettingsBadgeCount();
  const hidden = useNativeTabBarHidden();

  useEffect(() => {
    if ((Object.values(ROOT_TAB_PATHS) as string[]).includes(pathname)) setBackdropRecede(!NO_RECEDE.has(pathname));
  }, [pathname]);

  // The content column's width: the window on a phone, less the sidebar when UIKit mounts the bar
  // beside the content (iPad, a regular-width resizable scene). Each trigger's native screen view is
  // laid out to exactly that column, and the grids divide it into cards.
  // Measured against the window it was measured in: the measure lands with the native layout, a
  // render after the window's new size does, and read as it stood it laid every grid out at the old
  // width first and the new one a beat later (an iPhone Duo folding or opening, ~130ms). Until it
  // catches up, the column is the new window less what the last measure took off it (the sidebar).
  const [measure, setMeasure] = useState<{ width: number; window: number } | null>(null);
  const onContentLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    // The window as it is when the layout lands, not as this render saw it: the event can arrive
    // before the render for the new size, and paired with the old window it read the whole new width
    // as a sidebar.
    if (w > 0) setMeasure({ width: w, window: Dimensions.get('window').width });
  }, []);
  const contentWidth = !measure
    ? null
    : measure.window === windowWidth
      ? measure.width
      : Math.max(0, windowWidth - (measure.window - measure.width));
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
    <ContentWidthProvider width={contentWidth ?? windowWidth} sidebar={false}>
      <NativeTabs
        sidebarAdaptable
        preferredPlacement={navModeFor(windowWidth, false) === 'sidebar' ? 'sidebar' : 'automatic'}
        minimizeBehavior="never"
        hidden={hidden}
        tintColor={theme.tabIconActive}
        iconColor={theme.tabIconInactive}
        screenListeners={screenListeners}>
        <NativeTabs.Trigger name="(home)" disableAutomaticContentInsets unstable_nativeProps={measured}>
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
          {/* Not `hidden`: expo-router sends any children as the badge text before it reads
              `hidden`, so a zero count showed a "0" pip. The badge leaves the tree instead. */}
          {activityBadge > 0 ? <NativeTabs.Trigger.Badge>{String(activityBadge)}</NativeTabs.Trigger.Badge> : null}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings" disableAutomaticContentInsets unstable_nativeProps={measured}>
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
          {settingsBadge > 0 ? <NativeTabs.Trigger.Badge>{String(settingsBadge)}</NativeTabs.Trigger.Badge> : null}
        </NativeTabs.Trigger>
      </NativeTabs>
    </ContentWidthProvider>
  );
}
