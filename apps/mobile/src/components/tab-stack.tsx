import { Slot, Stack } from 'expo-router';
import type { ReactNode } from 'react';

import { TabRootScrollContext } from '@/components/tab-scroll-marker';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { TabRouteContext } from '@/lib/focused-tab';
import { NESTED_SEARCH_BAR } from '@/lib/series-nav';

/**
 * The layout of every tab directory. On iOS each tab is its own native Stack so the tab screen
 * gets a UINavigationBar INSIDE the UITabBarController — that is what lets UIKit carry the bar's
 * toolbar items over to the side column together with the tabs. Elsewhere the tab is just its
 * screen, which draws the custom TabTitleBar overlay as before.
 *
 * The bar is transparent so the content scrolls behind it exactly as it did behind the overlay
 * (and pads itself by useTopChromeHeight). No blur material of its own: on iOS 26 the bar's items
 * are already Liquid Glass, and a glass bar under glass buttons read as two layers of frosting.
 * What keeps the bar legible over covers is the scroll-edge effect instead — the system's own
 * soft fade of the content under the bar, which is what Apple's apps show above a feed.
 *
 * The stack also carries the tab's own copies of the pages a tab pushes — series, search, results
 * (one-line re-exports under each tab directory; `inTabHref` in lib/nav sends a push there) — so
 * they open under the tab bar like any system app's detail page, rather than over the whole shell.
 * All of them are plain pushed cards sharing this one bar, so each push animates it natively: the
 * tab's leading item morphs into the card's back button. The series page included — unlike the
 * root `/series` route, which is a transparent modal zooming out of its card (app/_layout), the
 * tab's copy is `series/index`, a screen of THIS stack: its directory has no layout on purpose,
 * so the page is the pushed screen itself and its `Stack.Screen` options (bar, edge-pop) land on
 * it. `useNativePush` in app/series/index is where the page gives up its own transitions for the
 * system's. Its tag search is the sibling `series/search`, pushed over it with the search bar.
 *
 * The tab's root screen is the one whose list the system tab bar follows (minimize on scroll,
 * scroll-to-top): `TabRootScrollContext` is what lets that list register itself — see
 * `tab-scroll-marker`.
 *
 * `tab` is this directory's route name, which the layout cannot read for itself (the segments
 * hooks report the FOCUSED tab, and every tab stays mounted); a series card under it builds its
 * zoom Link's href from it — see `TabRouteContext`.
 */
export default function TabStack({ tab }: { tab: string }) {
  if (!NATIVE_HEADER) return <Slot />;
  return (
    <TabRouteContext.Provider value={tab}>
      <Stack
        screenOptions={{
          headerTransparent: true,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          scrollEdgeEffects: { top: 'soft' },
        }}
        screenLayout={tabScreenLayout}>
        {/* The page shows the bar itself, details only (reader: none) — see its Stack.Screen. */}
        <Stack.Screen name="series/index" options={{ headerShown: false }} />
        <Stack.Screen name="series/search" options={NESTED_SEARCH_BAR} />
      </Stack>
    </TabRouteContext.Provider>
  );
}

function tabScreenLayout({ route, children }: { route: { name: string }; children: ReactNode }) {
  if (route.name !== 'index') return <>{children}</>;
  return <TabRootScrollContext.Provider value={true}>{children}</TabRootScrollContext.Provider>;
}
