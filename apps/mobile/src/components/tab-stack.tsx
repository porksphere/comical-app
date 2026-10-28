import { Slot, Stack } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';

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
 * (and pads itself by useTopChromeHeight). Over the covers of Browse and Library it takes the
 * chrome material once the list is scrolled and none at the top (`SCROLLED_MATERIAL`): the
 * bar's standard appearance carries the blur and its scroll-edge appearance is transparent,
 * and UIKit crossfades between the two as the list leaves its top edge — the arrangement the
 * system reads for every bar, given a scroll view to read it from (`TabScrollMarker`). The
 * other tabs stay bare: on iOS 26 the bar's items are already Liquid Glass, and a glass bar
 * under glass buttons read as two layers of frosting over a list of rows. What keeps those bars
 * legible is the scroll-edge effect — the system's own soft fade of the content under the bar.
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
  const scrolledMaterial = SCROLLED_MATERIAL_TABS.has(tab);
  return (
    <TabRouteContext.Provider value={tab}>
      <Stack
        screenOptions={{
          headerTransparent: true,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          scrollEdgeEffects: { top: 'soft' },
        }}
        screenLayout={scrolledMaterial ? materialTabScreenLayout : bareTabScreenLayout}>
        {scrolledMaterial ? <Stack.Screen name="index" options={SCROLLED_MATERIAL} /> : null}
        {/* The page shows the bar itself, details only (reader: none) — see its Stack.Screen. */}
        <Stack.Screen name="series/index" options={{ headerShown: false }} />
        <Stack.Screen name="series/search" options={NESTED_SEARCH_BAR} />
      </Stack>
    </TabRouteContext.Provider>
  );
}

/** The tabs whose root list is covers, over which the bar needs a material once scrolled. */
const SCROLLED_MATERIAL_TABS = new Set(['(home)', 'library']);

/**
 * The bar of a covers tab: the blur in the standard appearance, which UIKit shows once the list
 * has scrolled, and nothing in the scroll-edge appearance, which it shows at the top — the large
 * title style's background is what react-native-screens reads that appearance's colour from,
 * large title or not. The soft scroll-edge effect is off: it is a fade of the content under the
 * bar too, and the two stacked over the covers.
 */
const SCROLLED_MATERIAL: ComponentProps<typeof Stack.Screen>['options'] = {
  headerBlurEffect: 'systemChromeMaterial',
  headerLargeStyle: { backgroundColor: 'transparent' },
  scrollEdgeEffects: { top: 'hidden' },
};

const BARE_ROOT = { scrolledMaterial: false };
const MATERIAL_ROOT = { scrolledMaterial: true };

function bareTabScreenLayout({ route, children }: { route: { name: string }; children: ReactNode }) {
  if (route.name !== 'index') return <>{children}</>;
  return <TabRootScrollContext.Provider value={BARE_ROOT}>{children}</TabRootScrollContext.Provider>;
}

function materialTabScreenLayout({ route, children }: { route: { name: string }; children: ReactNode }) {
  if (route.name !== 'index') return <>{children}</>;
  return <TabRootScrollContext.Provider value={MATERIAL_ROOT}>{children}</TabRootScrollContext.Provider>;
}
