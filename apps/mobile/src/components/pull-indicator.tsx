import { ActivityIndicator, Platform, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '@/hooks/use-theme';

const HEIGHT = 56;

/**
 * The pull-to-refresh overlay — **web only**.
 *
 * iOS and Android use RN's `RefreshControl` and draw their own OS spinner, so this renders nothing
 * there. It exists because `react-native-web`'s `RefreshControl` is an inert stub that discards
 * `onRefresh` and renders a bare `<View>`, leaving web with nothing to fall back on. See
 * `usePullToRefresh`, which owns that split and feeds this from `useTouchPullToRefresh`'s `pullY`.
 *
 * Slides down from behind the top bar as the user pulls, and stays fully shown for as long as
 * `refreshing` is true (independent of `pullY`, which has sprung back to 0 by then — see the hook).
 *
 * The spinner is core RN's `ActivityIndicator`, which is indeterminate-only: there's no way to hand
 * it the drag's progress, so the pull is expressed by the *container* — it fades and slides into
 * place as `pullY` climbs. What marks the commit is the spinner starting to turn: it's held still
 * during the pull (`animating={refreshing}`, which react-native-web honours by pausing the
 * rotation) so that a spinner already spinning can't claim to be working before anything has been
 * requested. That mirrors `UIRefreshControl`, where the spin is precisely the "it fired" signal.
 */
export function PullIndicator({
  pullY,
  pullThreshold,
  refreshing,
  top,
}: {
  pullY: SharedValue<number>;
  pullThreshold: number;
  refreshing: boolean;
  /** Where the bar's resting bottom edge is — the indicator settles just below it. */
  top: number;
}) {
  const theme = useTheme();

  const style = useAnimatedStyle(() => {
    // Clamped at BOTH ends. `SETTLE_SPRING` in the touch hook is deliberately underdamped (damping
    // ratio ~0.73 — it describes itself as "barely-overshooting"), so `pullY` undershoots below
    // zero on every spring-back. Clamping only the top let that through as negative opacity and a
    // translateY past the hidden position.
    const progress = refreshing ? 1 : Math.min(1, Math.max(0, pullY.value / pullThreshold));
    return {
      opacity: progress,
      transform: [{ translateY: -HEIGHT + progress * HEIGHT }],
    };
  });

  // After the hooks, so the hook count stays fixed — `Platform.OS` is constant for the process
  // anyway, so this is a compile-time-ish branch, not a conditional-hooks hazard.
  if (Platform.OS !== 'web') return null;

  return (
    <Animated.View style={[styles.container, { top }, style]}>
      <ActivityIndicator
        size="small"
        color={theme.textSecondary}
        animating={refreshing}
        // Required for the held-still state above to be visible at all — the default hides a
        // stopped indicator outright.
        hidesWhenStopped={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
