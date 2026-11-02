import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';

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
 * The frosted material behind a bar, UIKit's own: a `UIBlurEffect` in the bar's appearance. Always
 * on, at the top of a list too: UIKit never switched these bars from a bare scroll-edge appearance
 * to this one on a device, and the bar is out of the way once the content scrolls anyway.
 */
export const BAR_MATERIAL = 'systemChromeMaterial';

/**
 * The system navigation bar on an iOS screen: title, back chevron, the frosted material, over a
 * soft scroll edge that backs the status bar once the bar has slid away — see `tab-stack`.
 * `headerShown` is explicit so the options also stand inside a stack whose default hides it (the
 * series page's).
 */
export const NATIVE_BAR: ScreenOptions = {
  headerShown: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerBlurEffect: BAR_MATERIAL,
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
 * A settings screen: the system bar on iOS, titled for its first frame — the screen's `TopBar`
 * retitles it as it goes (a selection's count) and adds its actions. Elsewhere the bar is hidden
 * behind that `TopBar`. The screens pad past whichever is there via `useSettingsScrollPadding`.
 */
export function settingsScreen(title: string): ScreenOptions {
  return NATIVE_HEADER ? { title, ...NATIVE_BAR } : { headerShown: false };
}
