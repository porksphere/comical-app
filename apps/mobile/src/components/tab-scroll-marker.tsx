import { createContext, use, useEffect, useRef, type ReactNode } from 'react';
import { findNodeHandle, Platform, StyleSheet, View, type ViewInstance } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens/experimental';

import navBarScroll from '../../modules/nav-bar-scroll';

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
 * which scroll view to hand UIKit; without it UIKit walks the screen's first-descendant chain, and
 * a feed whose first child is a backdrop (Browse) is never found.
 *
 * Only under a tab's root screen: the registration is a strong hand-off to UIKit that nothing
 * takes back, so a pushed page's list registered and then popped would leave the tab following a
 * dead scroll view. The root's list lives as long as the tab. `markerKey` must change whenever the
 * child list remounts (RecyclerList's `listKey`) — the marker registers once per attach, so a new
 * scroll view under an old marker would go unregistered.
 *
 * The marker reaches the TAB screen only; the stack screen holding the navigation bar is never
 * told, and UIKit's own first-subview walk from it misses the same backdrop. For a tab whose
 * bar is bare at the top and a material once scrolled (`scrolledMaterial`), the list is handed
 * to that screen outright through the local `nav-bar-scroll` module, which is what lets UIKit
 * switch the bar between its two appearances. The soft scroll-edge effect is off on those lists:
 * it is itself a fade of the content under the bar, and over the material it was the two
 * stacked. The other tabs keep the edge effect the marker applies by default (`automatic`, soft
 * under a bar), their bar's whole treatment.
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
  const scrolledMaterial = tabRoot?.scrolledMaterial ?? false;
  const anchor = useRef<ViewInstance>(null);
  // Once per attach, like the marker's own registration: the handed-over view stands as long as
  // the list, and a remount brings a new key. A frame later, in case the native views have not
  // been mounted when the effect runs; after that nothing scrolls under a bare marker anyway.
  useEffect(() => {
    const module = navBarScroll;
    if (!scrolledMaterial || !module) return;
    let cancelled = false;
    const follow = async () => {
      const tag = anchor.current ? findNodeHandle(anchor.current) : null;
      if (tag == null) return;
      const found = await module.follow(tag);
      if (!found && !cancelled) requestAnimationFrame(() => void follow());
    };
    void follow();
    return () => {
      cancelled = true;
    };
  }, [scrolledMaterial, markerKey]);
  if (Platform.OS !== 'ios' || !tabRoot) return children;
  const marker = (
    <ScrollViewMarker key={markerKey} style={styles.fill} {...(scrolledMaterial ? { scrollEdgeEffects: NO_TOP_EDGE } : {})}>
      {children}
    </ScrollViewMarker>
  );
  if (!scrolledMaterial) return marker;
  return (
    <View ref={anchor} style={styles.fill}>
      {marker}
    </View>
  );
}

const NO_TOP_EDGE = { top: 'hidden' } as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
