import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';
import Animated, { type AnimatedProps } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

/**
 * The shell every top bar in the app is built on: the safe-area top padding, the hairline bottom
 * border, and the bar's background — a flat, fully opaque `theme.background`, the same colour as the
 * page itself, so a bar reads as the page continuing rather than as a surface laid over it.
 *
 * It exists so the bars can't drift. They used to each hand-roll this, and the Search screen's bars
 * came out visibly different from Browse's. Anything that changes how a bar reads — its fill, the
 * divider — changes here once and every top bar inherits it. The one bar that isn't a `BarSurface`
 * is the bottom tab bar (it can't be — see `app-tabs`), which paints the same `theme.background`.
 *
 * These bars were frosted until recently: a real blur (iOS `UIVisualEffectView` / web
 * `backdrop-filter`) under a partial scrim of the bar's own colour, with a solid fallback on Android,
 * so content scrolled under them and showed through. That's gone, deliberately — the bars are now
 * plainly opaque, and content that passes behind one is simply hidden.
 *
 * Deliberately NOT opinionated about layout: bars differ genuinely (an overlaid bar the content
 * scrolls under vs. an in-flow one; a title row vs. selectors vs. a search field), so positioning and
 * content stay with the caller via `style` + `children`. An Animated.View, so a caller can hand it a
 * Reanimated style for a collapsing/sliding bar (Browse, Search) without a second wrapper.
 */
export function BarSurface({
  children,
  style,
  safeAreaTop = true,
}: {
  children?: ReactNode;
  /** Positioning + any animated transform/border for this particular bar. Accepts Reanimated styles
   *  (a collapsing bar's translate, an animated hairline/shadow), hence Animated.View's own style type. */
  style?: AnimatedProps<ViewProps>['style'];
  /** Pads the status bar out of the content's way. True for a bar at the top of the SCREEN; pass
   *  false for a secondary bar stacked BELOW one (e.g. Search's filter bar), which would otherwise
   *  add the inset a second time and sit too tall. */
  safeAreaTop?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      // box-none so the bar's own controls stay tappable while taps outside them fall through.
      pointerEvents="box-none"
      style={[
        styles.bar,
        {
          // On the bar's own view rather than an absolute-fill layer behind it: a flat colour needs
          // nothing to sample, so the extra view the frosted version required (a blur that had to
          // sit UNDER the content) buys nothing now.
          backgroundColor: theme.background,
          paddingTop: safeAreaTop ? insets.top : 0,
          borderBottomColor: theme.hairline,
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
