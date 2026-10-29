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
 * (and pads itself by useTopChromeHeight). What keeps it legible is the iOS 26 scroll-edge
 * effect: the system's own treatment of the content under a bar, shown only once the list has
 * scrolled under it. Most tabs take the soft one, a fade, since the bar's items are already
 * Liquid Glass and a glass bar under glass buttons read as two layers of frosting. Over the
 * covers of Browse and Library it is the hard one (`SCROLLED_MATERIAL`), the near-opaque
 * backing that stands in for the old bar material. Not a background in the bar's appearance:
 * on iOS 26 that sits on top of the edge effect, and UIKit never once switched these bars from
 * their scroll-edge appearance to the standard one.
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
 * system's. Its tag search is the sibling `series/search`, pushed over it with the search bar, and
 * its reader the sibling `series/read`, which grows out of the page's strip.
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
        <Stack.Screen name="series/read" options={{ headerShown: false }} />
        <Stack.Screen name="series/search" options={NESTED_SEARCH_BAR} />
      </Stack>
    </TabRouteContext.Provider>
  );
}

/** The tabs whose root list is covers, over which the bar needs a material once scrolled. */
const SCROLLED_MATERIAL_TABS = new Set(['(home)', 'library']);

/** The bar of a covers tab: the hard scroll-edge effect, which the list's marker sets too. */
const SCROLLED_MATERIAL: ComponentProps<typeof Stack.Screen>['options'] = {
  scrollEdgeEffects: { top: 'hard' },
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
