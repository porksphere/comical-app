import { Slot, Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { useSeriesReaderBackdropDimStyle, useSeriesReaderBackdropStyle } from '@/lib/series-backdrop';

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
 * The series copy is the same contained transparent modal the root route is (its rationale is in
 * app/_layout), with no native edge-swipe: the page runs its own back-swipe and collapse. Search
 * and results take the stack's bar as it is — search puts its field in it (`Stack.SearchBar`).
 */
export default function TabStack() {
  if (!NATIVE_HEADER) return <Slot />;
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        scrollEdgeEffects: { top: 'soft' },
      }}
      screenLayout={tabScreenLayout}>
      <Stack.Screen
        name="series"
        options={{
          headerShown: false,
          animation: 'none',
          presentation: 'containedTransparentModal',
          gestureEnabled: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  );
}

/**
 * Every screen but the series page sits in the backdrop the series page opens over: scaled back
 * and dimmed behind it, restored under its swipe-away. Per screen, inside the stack, so the
 * series page — in this same stack, transparent — is the one thing not receding behind itself.
 * (Before the pages moved in here the whole tab shell was the backdrop.)
 */
function tabScreenLayout({ route, children }: { route: { name: string }; children: ReactNode }) {
  return route.name === 'series' ? <>{children}</> : <TabBackdrop>{children}</TabBackdrop>;
}

function TabBackdrop({ children }: { children: ReactNode }) {
  const backdropStyle = useSeriesReaderBackdropStyle();
  const dimStyle = useSeriesReaderBackdropDimStyle();
  return (
    <Animated.View style={[styles.backdrop, backdropStyle]}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  dim: { backgroundColor: '#000' },
});
