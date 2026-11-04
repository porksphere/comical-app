import type { Stack } from 'expo-router';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import type { ComponentProps } from 'react';
import { useWindowDimensions } from 'react-native';

import { NATIVE_HEADER } from '@/hooks/use-native-header';

type ScreenOptions = ComponentProps<typeof Stack.Screen>['options'];

/**
 * The bar slides away as the content scrolls down and comes back as soon as it scrolls up: iOS 27's
 * bar minimization, the way Settings' own pages behave. UIKit leaves it to the system by default,
 * and the system keeps our bars in place, so it is asked for outright. The safe area stays put
 * while the bar goes (`safeAreaAdjustment`): the content pads itself past the bar, and following
 * the bar would move every row under the finger. Older iOS ignores both.
 *
 * Through react-native-screens' header config, which expo-router passes on as is; the props are
 * new in react-native-screens 4.31.
 */
export const SLIDE_AWAY_BAR = {
  headerConfig: { minimizationBehavior: 'onScrollDown', safeAreaAdjustment: 'disabled' },
} as const;

/**
 * The frosted material behind a bar, UIKit's own: a `UIBlurEffect` in the bar's appearance, the
 * lightest of the system's. Always on, at the top of a list too: UIKit never switched these bars
 * from a bare scroll-edge appearance to this one on a device, and the bar is out of the way once
 * the content scrolls anyway.
 *
 * None on the folded iPhone Duo. UIKit starts the bar below a strip at the top of that panel, and
 * no bar background reaches into it: a material stops short and leaves a gap, in a bare UIKit app
 * too (FB24859353). The frost there is the scroll edge's, which does run to the top of the screen
 * (`useFoldedBarEdge`).
 *
 * It goes in a stack's `screenOptions` and on the series details, the pages that set their own bar.
 */
export function useBarMaterial() {
  const folded = useIsFoldedDuo();
  if (!NATIVE_HEADER) return undefined;
  return folded ? ('none' as const) : ('systemUltraThinMaterial' as const);
}

/**
 * The hard scroll edge on the folded iPhone Duo, the system's near-opaque backing under the bar once
 * content scrolls beneath it, where the bar can have no material. Undefined elsewhere: leave the edge
 * as it was. For a tab's stack, a settings screen and a tab root list's marker, since the last one set
 * on the scroll view wins.
 */
export function useFoldedBarEdge() {
  return useIsFoldedDuo() ? HARD_TOP_EDGE : undefined;
}

const HARD_TOP_EDGE = { top: 'hard' } as const;

/**
 * No system scroll edge under the bar: on a screen whose bar switches its own material with the
 * scroll (`bar-scrolled.tsx`), where the soft edge fading in behind the bar's buttons was a
 * half-backed bar for the first points. The folded Duo keeps its hard edge: it is the backing there.
 */
export const HIDDEN_TOP_EDGE = { top: 'hidden' } as const;

// A vertical bar in a tall window: open in portrait there is no vertical bar, and open in landscape
// the window is wide and the bar's background does reach the top.
function useIsFoldedDuo() {
  const verticalBarEdge = useVerticalBarEdgeIOS();
  const { width, height } = useWindowDimensions();
  return NATIVE_HEADER && verticalBarEdge != null && height > width;
}

/**
 * The system navigation bar on an iOS screen: title, back chevron, over a soft scroll edge that
 * backs the status bar once the bar has slid away — see `tab-stack`. The stack adds the material
 * (`useBarMaterial`). `headerShown` is explicit so the options also stand inside a stack whose
 * default hides it (the series page's).
 */
export const NATIVE_BAR: ScreenOptions = {
  headerShown: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  scrollEdgeEffects: { top: 'soft' },
  unstable_nativeProps: SLIDE_AWAY_BAR,
};

/**
 * A pushed screen that titles itself (results): the system bar on iOS, elsewhere hidden behind the
 * screen's own TopBar. The in-tab copies of the same screen get this from the tab's stack.
 */
export const pushedScreen: ScreenOptions = NATIVE_HEADER ? NATIVE_BAR : { headerShown: false };

/**
 * The options of a settings screen: the system bar on iOS, titled for its first frame — the screen's
 * `TopBar` retitles it as it goes (a selection's count) and adds its actions. Elsewhere the bar is
 * hidden behind that `TopBar`. The screens pad past whichever is there via
 * `useSettingsScrollPadding`.
 */
export function useSettingsScreen() {
  const foldedEdge = useFoldedBarEdge();
  return (title: string): ScreenOptions =>
    NATIVE_HEADER
      ? { title, ...NATIVE_BAR, ...(foldedEdge && { scrollEdgeEffects: foldedEdge }) }
      : { headerShown: false };
}
