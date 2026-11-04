import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { ReanimatedScreenProvider } from 'react-native-screens/reanimated';

import { barExtentLayout } from '@/components/bar-extent';
import { TabRootScrollContext } from '@/components/screen-scroll-marker';
import { TabRouteContext } from '@/lib/focused-tab';
import { NATIVE_BAR, useBarMaterial, useFoldedBarEdge } from '@/lib/native-bar';
import { NESTED_SEARCH_BAR } from '@/lib/series-nav';
import { TabBarClearanceReporter } from '@/lib/tab-bar-clearance';

/**
 * The layout of every tab directory on iOS: each tab is its own native Stack so the tab screen
 * gets a UINavigationBar INSIDE the UITabBarController — that is what lets UIKit carry the bar's
 * toolbar items over to the side column together with the tabs. Elsewhere the tab is just its
 * screen, which draws the custom TabTitleBar overlay (tab-stack.tsx).
 *
 * The content scrolls behind the bar exactly as it did behind the overlay (and pads itself by
 * useTopChromeHeight). The bar has the system's frosted material (`useBarMaterial`), always: UIKit
 * never once switched these bars from a bare scroll-edge appearance to the frosted standard one.
 * It slides away as the content scrolls down and back as it scrolls up, the iOS 27 minimization
 * every bar takes (`NATIVE_BAR`); each screen measures the bar it pads past, since the height the
 * stack reports follows the bar out (`barExtentLayout`). The soft scroll-edge effect stays on under
 * it: the material hides it while the bar is there, and it backs the status bar once the bar has
 * gone.
 *
 * The stack also carries the tab's own copies of the pages a tab pushes — series, search, results
 * (one-line re-exports under each tab's `in-tab/`; `destinationHref` in lib/nav sends a push there) —
 * so they open under the tab bar like any system app's detail page, rather than over the whole shell.
 * The `in-tab` segment keeps their URLs apart from the root pages': expo-router resolves a plain
 * `/series` to whichever matching route shares the most groups with the current one, so a copy at
 * `<tab>/series` would capture every push made from that tab, on web and Android too, where the
 * tab is a Slot and the page would replace it.
 * All of them are plain pushed cards sharing this one bar, so each push animates it natively: the
 * tab's leading item morphs into the card's back button. The series page included — unlike the
 * root `/series` route, which is a transparent modal zooming out of its card (app/_layout), the
 * tab's copy is `in-tab/series/index`, a screen of THIS stack: its directory has no layout on purpose,
 * so the page is the pushed screen itself and its `Stack.Screen` options (bar, edge-pop) land on
 * it. `useNativePush` (components/series/viewport) is where the page gives up its own transitions for the
 * system's. Its tag search is the sibling `in-tab/series/search`, pushed over it with the search
 * bar, and its reader the sibling `in-tab/series/read`, which grows out of the page's strip.
 *
 * The tab's root screen is the one whose list the system tab bar follows (the status bar's
 * tap-to-top): `TabRootScrollContext` is what lets that list register itself — see
 * `screen-scroll-marker`.
 *
 * `tab` is this directory's route name, which the layout cannot read for itself (the segments
 * hooks report the FOCUSED tab, and every tab stays mounted); a series card under it builds its
 * zoom Link's href from it — see `TabRouteContext`. The tab also reports its bottom inset, the
 * one place that knows where UIKit put the tab bar, for the root overlays (`tab-bar-clearance`).
 *
 * The provider makes each screen of the stack hand its own transition progress to reanimated, which
 * is what a reader zooming out of a History or Activity row times its copy of the cover by (see
 * ZoomCoverCopy). It only samples while a transition runs.
 */
export default function TabStack({ tab }: { tab: string }) {
  const barMaterial = useBarMaterial();
  const foldedEdge = useFoldedBarEdge();
  return (
    <TabRouteContext.Provider value={tab}>
      <TabBarClearanceReporter />
      <ReanimatedScreenProvider>
        <Stack
          screenOptions={{ ...NATIVE_BAR, headerBlurEffect: barMaterial, ...(foldedEdge && { scrollEdgeEffects: foldedEdge }) }}
          screenLayout={tabScreenLayout}>
          {/* The page shows the bar itself, details only (reader: none) — see its Stack.Screen. */}
          <Stack.Screen name="in-tab/series/index" options={{ headerShown: false }} />
          <Stack.Screen name="in-tab/series/read" options={{ headerShown: false }} />
          <Stack.Screen name="in-tab/series/search" options={NESTED_SEARCH_BAR} />
        </Stack>
      </ReanimatedScreenProvider>
    </TabRouteContext.Provider>
  );
}

function tabScreenLayout(args: Parameters<NonNullable<ComponentProps<typeof Stack>['screenLayout']>>[0]) {
  const screen = barExtentLayout(args);
  if (args.route.name !== 'index') return screen;
  return <TabRootScrollContext.Provider value>{screen}</TabRootScrollContext.Provider>;
}
