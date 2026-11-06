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
 * The frosted material behind a bar, UIKit's own: a `UIBlurEffect` in the bar's standard
 * appearance, the lightest of the system's. A tab root's scroll-edge appearance is bare instead
 * (`NativeTabHeader`), so UIKit shows the material once content is under the bar; a pushed page
 * switches it as an option at its list's crossing (`TopBar`), and the series details at its own
 * line. It reaches the top of the folded iPhone Duo's panel too: the gap a bar background once
 * left there (FB24859353) is gone on the current iOS, checked on a device.
 *
 * It goes in a stack's `screenOptions` and on the series details, the pages that set their own bar.
 */
export function useBarMaterial() {
  if (!NATIVE_HEADER) return undefined;
  return 'systemUltraThinMaterial' as const;
}

/**
 * No system scroll edge under the bar: on a screen whose bar switches its own material with the
 * scroll (`bar-scrolled.tsx`), where the soft edge fading in behind the bar's buttons was a
 * half-backed bar for the first points, and on the tab roots, whose material is their backing.
 */
export const HIDDEN_TOP_EDGE = { top: 'hidden' } as const;

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
  return (title: string): ScreenOptions => (NATIVE_HEADER ? { title, ...NATIVE_BAR } : { headerShown: false });
}
