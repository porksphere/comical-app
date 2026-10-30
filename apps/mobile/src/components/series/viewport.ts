import { useSegments } from 'expo-router';
import { useMemo } from 'react';
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
 * iOS, inside a tab: the series page is a real pushed card of the tab's native stack
 * (components/tab-stack, route `in-tab/series/index`) and UIKit owns its transitions — the slide in, the
 * bar morphing out of the tab's leading item, the left-edge pop — so the zoom rig stands down on
 * the depth-0 instance: no entrance (the page lands open in one frame, as on web), no collapse on
 * the way out, no back-swipe or swipe-away of its own, nothing dimmed behind it, and leaving is
 * just the pop. The root `/series` route (deep links, a reader opened from a notification) and
 * Android/web keep the contained transparent modal with the zoom; so does a layer drilled over
 * the root page, since a layer is never a route — inside a tab a related series is another push.
 */
export function useNativePush(): boolean {
  const segments: readonly string[] = useSegments();
  return IS_IOS && segments[0] === '(tabs)';
}
