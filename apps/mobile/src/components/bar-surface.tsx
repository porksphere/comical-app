import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';
import Animated, { type AnimatedProps } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarBlur } from '@/components/bar-blur';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shell every top bar in the app is built on: the safe-area top padding, the hairline bottom
 * border, and — the point of this component — the frosted `BarBlur` background behind the content.
 *
 * It exists so the bars can't drift. They used to each hand-roll this, and the Search screen's bars
 * simply forgot the blur (they painted a solid background instead), so Browse looked frosted and
 * Search didn't. Anything that changes how a bar reads — the blur, its strength, the divider —
 * changes here once and every bar inherits it.
 *
 * Deliberately NOT opinionated about layout: bars differ genuinely (an overlaid bar the content
 * scrolls under vs. an in-flow one; a title row vs. selectors vs. a search field), so positioning and
 * content stay with the caller via `style` + `children`. An Animated.View, so a caller can hand it a
 * Reanimated style for a collapsing/sliding bar (Browse, Search) without a second wrapper.
 *
 * Note the blur is only *visible* where content passes beneath the bar — an overlaid bar with the
 * list scrolling under it. An in-flow bar with nothing behind it will read as solid, which is fine
 * and is why this doesn't force a position.
 */
export function BarSurface({
  children,
  style,
  fallback,
  safeAreaTop = true,
}: {
  children?: ReactNode;
  /** Positioning + any animated transform/border for this particular bar. Accepts Reanimated styles
   *  (a collapsing bar's translate, an animated hairline/shadow), hence Animated.View's own style type. */
  style?: AnimatedProps<ViewProps>['style'];
  /** Solid colour used where a real blur isn't available (Android — see BarBlur). Defaults to the
   *  theme background; the tab bar passes its own. */
  fallback?: string;
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
        { paddingTop: safeAreaTop ? insets.top : 0, borderBottomColor: theme.hairline },
        style,
      ]}>
      <BarBlur fallback={fallback ?? theme.background} />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
