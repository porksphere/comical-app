import { createContext, use, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens/experimental';

/**
 * Set inside a tab's ROOT screen (the tab's own stack provides it — see `tab-stack`), null under
 * every page the tab pushes and outside the tabs. `scrolledMaterial` is true for the tabs whose
 * bar takes a material once the list is scrolled (tab-stack's SCROLLED_MATERIAL).
 */
export const TabRootScrollContext = createContext<{ scrolledMaterial: boolean } | null>(null);

/**
 * Marks the scroll view the system tab bar follows (iOS 26 `minimizeBehavior`, status-bar tap
 * scroll-to-top): react-native-screens' `ScrollViewMarker`, whose ONE child must itself be the
 * scroll view (a LegendList's root is its Animated.ScrollView). The marker tells the tab screen
 * which scroll view to hand UIKit, rather than leaving it to UIKit's own first-descendant walk.
 *
 * Only under a tab's root screen: the registration is a strong hand-off to UIKit that nothing
 * takes back, so a pushed page's list registered and then popped would leave the tab following a
 * dead scroll view. The root's list lives as long as the tab. `markerKey` must change whenever the
 * child list remounts (RecyclerList's `listKey`) — the marker registers once per attach, so a new
 * scroll view under an old marker would go unregistered.
 *
 * The marker reaches the TAB screen only; the stack screen holding the navigation bar is never
 * told, and UIKit finds the list for it by that walk, each first subview down from the screen.
 * The walk is what lets the bar of a tab that is bare at the top and a material once scrolled
 * (`scrolledMaterial`) switch between its two appearances, so nothing may be laid in ahead of
 * the list on those screens: Browse draws its colour backdrop inside the list's content on iOS
 * for that reason (see `ContentFeed`). The soft scroll-edge effect is off on those lists: it is
 * itself a fade of the content under the bar, and over the material it was the two stacked. The
 * other tabs keep the edge effect the marker applies by default (`automatic`, soft under a
 * bar), their bar's whole treatment.
 *
 * Elsewhere, and on Android/web, it renders the child alone.
 */
export function TabScrollMarker({
  markerKey,
  children,
}: {
  markerKey?: string;
  children: NonNullable<ReactNode>;
}) {
  const tabRoot = use(TabRootScrollContext);
  if (Platform.OS !== 'ios' || !tabRoot) return children;
  return (
    <ScrollViewMarker
      key={markerKey}
      style={styles.fill}
      {...(tabRoot.scrolledMaterial ? { scrollEdgeEffects: NO_TOP_EDGE } : {})}>
      {children}
    </ScrollViewMarker>
  );
}

const NO_TOP_EDGE = { top: 'hidden' } as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
