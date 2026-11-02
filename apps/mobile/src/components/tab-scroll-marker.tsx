import { createContext, use, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens';

import { ContentScrollAnchor } from '../../modules/content-scroll-view';

/**
 * True inside a tab's ROOT screen (the tab's own stack provides it — see `tab-stack`), false under
 * every page the tab pushes and outside the tabs.
 */
export const TabRootScrollContext = createContext(false);

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
 * The marker reaches the TAB screen only. The stack screen holding the navigation bar is told by
 * `ContentScrollAnchor`, since a tab root's list is too deep for UIKit to find, and the bar can't
 * slide away from a list it hasn't found. That screen still finds the list by a walk of its own,
 * each first subview down, to put its scroll-edge effect on it. Nothing may be laid in ahead of
 * the list there: Browse draws its colour backdrop inside the list's content on iOS for that
 * reason (see `ContentFeed`). The marker sets an edge effect too, its default (`automatic`, soft
 * under a bar), and the last one set on the scroll view wins, so every tab root leaves it there.
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
  const marker = (
    <ScrollViewMarker key={markerKey} style={styles.fill}>
      {children}
    </ScrollViewMarker>
  );
  if (!ContentScrollAnchor) return marker;
  return (
    <ContentScrollAnchor key={markerKey} style={styles.fill}>
      {marker}
    </ContentScrollAnchor>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
