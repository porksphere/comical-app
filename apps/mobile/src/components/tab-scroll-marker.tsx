import { createContext, use, type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens/experimental';

import { logDiagnostic } from '@/lib/diagnostics';
import { NavBarScrollAnchor, type NavBarScrollReport } from '../../modules/nav-bar-scroll';

/**
 * Set inside a tab's ROOT screen (the tab's own stack provides it — see `tab-stack`), null under
 * every page the tab pushes and outside the tabs. `largeTitle` is true for the tabs whose screen
 * heads its list with the system large title (tab-stack's LARGE_TITLE).
 */
export const TabRootScrollContext = createContext<{ largeTitle: boolean } | null>(null);

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
 * screen heads the list with the system large title (`largeTitle`), the list is handed to that
 * screen outright by the local `nav-bar-scroll` module's anchor, natively, on the mount and
 * again on every return to the screen, which is what the large title collapses off. Each
 * hand-off is written to the Diagnostics screen as its outcome changes, the one way to read a
 * release build. Every list keeps the edge effect the marker applies by default (`automatic`,
 * soft under a bar), the bar's whole treatment.
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
  const largeTitle = tabRoot?.largeTitle ?? false;
  if (Platform.OS !== 'ios' || !tabRoot) return children;
  const marker = (
    <ScrollViewMarker key={markerKey} style={styles.fill}>
      {children}
    </ScrollViewMarker>
  );
  if (!largeTitle || !NavBarScrollAnchor) return marker;
  return (
    <NavBarScrollAnchor key={markerKey} style={styles.fill} onFollow={reportFollow}>
      {marker}
    </NavBarScrollAnchor>
  );
}

function reportFollow({ nativeEvent }: { nativeEvent: NavBarScrollReport }) {
  if (nativeEvent.ok) {
    const { ok: _ok, ...detail } = nativeEvent;
    logDiagnostic('nav-bar', 'list handed to the bar', { context: JSON.stringify(detail) });
  } else {
    logDiagnostic('nav-bar', nativeEvent.reason);
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
