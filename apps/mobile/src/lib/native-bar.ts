import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';

import { NATIVE_HEADER } from '@/hooks/use-native-header';

type ScreenOptions = ComponentProps<typeof Stack.Screen>['options'];

/**
 * The system navigation bar on a pushed iOS screen: title, back chevron, the same transparent bar
 * over a soft scroll edge the tab stacks use — see `tab-stack`. `headerShown` is explicit so the
 * options also stand inside a stack whose default hides it (the series page's).
 */
export const NATIVE_BAR: ScreenOptions = {
  headerShown: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  scrollEdgeEffects: { top: 'soft' },
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
