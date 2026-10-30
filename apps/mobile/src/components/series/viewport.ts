import { useNavigation, useRoute, useSegments } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSeriesPaneWidth } from '@/lib/series-pane-context';

const IS_IOS = Platform.OS === 'ios';

/**
 * The box this page is laid out in — the window, unless it is being rendered in the right-hand pane
 * (see `components/series-pane`), where it is the pane's width and the window's height.
 *
 * Every width in here is a layout question ("how wide is the hero", "how far does a layer slide in
 * from"), and in a pane the honest answer is the pane's. Reading the window instead put the details
 * card's two-column threshold, the action column and the push parallax on a number nothing in this
 * subtree is that wide.
 */
export function useViewport(): { width: number; height: number } {
  const win = useWindowDimensions();
  const pane = useSeriesPaneWidth();
  return useMemo(
    () => (pane === null ? { width: win.width, height: win.height } : { width: pane, height: win.height }),
    [pane, win.width, win.height],
  );
}

/**
 * iOS: the series page is a real pushed card of a native stack and UIKit owns its transitions — the
 * slide or zoom in, the bar morphing out of the item it was pushed from, the left-edge pop — so
 * the zoom rig stands down on the depth-0 instance: no entrance (the page lands open in one
 * frame, as on web), no collapse on the way out, no back-swipe or swipe-away of its own, nothing
 * dimmed behind it, and leaving is just the pop. Inside a tab every series page is one
 * (components/tab-stack, route `in-tab/series/index`). At the root `/series` route (deep links, a
 * page opened from a root screen) the FIRST page is the contained transparent modal with the zoom,
 * and a page pushed over it in the route's nested stack, the reader over its details or the
 * details over a reader opened cold, is a pushed card again. Android/web keep the zoom
 * everywhere, and so does a layer drilled over the root page, since a layer is never a route.
 */
export function useNativePush(): boolean {
  const segments: readonly string[] = useSegments();
  const navigation = useNavigation();
  const { key } = useRoute();
  // Once: nothing is ever put beneath a page, so whether one is there is fixed for its life.
  const [pushed] = useState(() => navigation.getState()?.routes[0]?.key !== key);
  return IS_IOS && (segments[0] === '(tabs)' || pushed);
}
