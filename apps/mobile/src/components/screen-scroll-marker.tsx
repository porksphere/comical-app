import { createContext, use, type ComponentProps, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens';

import { ContentScrollAnchor } from '../../modules/content-scroll-view';

/**
 * True inside a tab's ROOT screen (the tab's own stack provides it — see `tab-stack`), false under
 * every page the tab pushes and outside the tabs.
 */
export const TabRootScrollContext = createContext(false);

/**
 * False under a layer another layer covers: layers on one route share its screen, and only the top
 * one's list is the screen's.
 */
export const ScreenScrollActiveContext = createContext(true);

/**
 * Marks a screen's main list on iOS, for the two things the system moves with it. Every screen's
 * goes through here; a page that is one ScrollView takes `ScreenScrollView`. The child must hold
 * the scroll view first in line, each first subview down.
 *
 * - The navigation bar sliding away (iOS 27 minimization, `SLIDE_AWAY_BAR`). The screen's view
 *   controller is told by `ContentScrollAnchor`, since UIKit left to find the list for itself
 *   stops at a wrapper or two, and the bar never moves.
 * - The system tab bar (iOS 26 `minimizeBehavior`, status-bar tap scroll-to-top), tab roots only:
 *   react-native-screens' `ScrollViewMarker`, whose ONE child must itself be the scroll view (a
 *   LegendList's root is its Animated.ScrollView). The registration is a strong hand-off to UIKit
 *   that nothing takes back, so a pushed page's list registered and then popped would leave the tab
 *   following a dead scroll view. The root's list lives as long as the tab.
 *
 * `markerKey` must change whenever the child list remounts (RecyclerList's `listKey`): both register
 * once per attach, so a new scroll view under an old marker would go unregistered.
 *
 * `ScrollViewMarker` reaches the TAB screen only. The stack screen holding the navigation bar still
 * walks to the list by itself, each first subview down, to put its scroll-edge effect on it. Nothing
 * may be laid in ahead of the list there: Browse draws its colour backdrop inside the list's content
 * on iOS for that reason (see `ContentFeed`). The marker sets an edge effect too, its default
 * (`automatic`, soft under a bar), and the last one set on the scroll view wins, so every tab root
 * leaves it there.
 *
 * On Android and web it renders the child alone.
 */
export function ScreenScrollMarker({
  markerKey,
  children,
}: {
  markerKey?: string;
  children: NonNullable<ReactNode>;
}) {
  const tabRoot = use(TabRootScrollContext);
  const active = use(ScreenScrollActiveContext);
  if (Platform.OS !== 'ios') return children;
  const list = tabRoot ? <ScrollViewMarker key={markerKey} style={styles.fill}>{children}</ScrollViewMarker> : children;
  if (!ContentScrollAnchor) return list;
  return (
    <ContentScrollAnchor key={markerKey} active={active} style={styles.fill}>
      {list}
    </ContentScrollAnchor>
  );
}

/** A ScrollView that is its screen's main list. */
export function ScreenScrollView(props: ComponentProps<typeof ScrollView>) {
  return (
    <ScreenScrollMarker>
      <ScrollView {...props} />
    </ScreenScrollMarker>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
