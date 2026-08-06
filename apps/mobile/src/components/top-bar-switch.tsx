import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * TopBarSwitch — a persistent top-of-screen SLOT that crossfades between whole bar
 * implementations as the screen's mode changes: the X/Reddit morphing-header treatment, where
 * the bar itself never moves or remounts — only its face (title, icons, surface) dissolves over.
 *
 * Every mode's bar stays MOUNTED, absolutely stacked in the slot; on a mode change the incoming
 * bar fades in while the outgoing fades out, and only the active layer takes touches. Bars are
 * ordinary top-bar components that position themselves at the top of the screen (`TopBar`,
 * `ReaderToolbar`, …) — the slot is zero-height and box-none, purely a shared stacking position.
 *
 * FRAMEWORK PIECE: introduced for the series page (details bar ⇄ reader toolbar),
 * but deliberately screen-agnostic — any screen that swaps its top chrome between modes should
 * render one of these instead of conditionally mounting different bars.
 */
export function TopBarSwitch({
  mode,
  bars,
  persistent,
}: {
  mode: string;
  bars: Record<string, ReactNode>;
  /** Chrome that belongs IDENTICALLY to every mode (e.g. a back button that must not blink or
   *  move through the handoff): stacked above the crossfading layers and never faded by the
   *  switch — the element itself decides any state of its own. */
  persistent?: ReactNode;
}) {
  return (
    <View style={styles.slot} pointerEvents="box-none">
      {Object.entries(bars).map(([key, node]) => (
        <BarLayer key={key} active={key === mode}>
          {node}
        </BarLayer>
      ))}
      {persistent != null && (
        <View style={styles.layer} pointerEvents="box-none">
          {persistent}
        </View>
      )}
    </View>
  );
}

const CROSSFADE_MS = 220;

function BarLayer({ active, children }: { active: boolean; children: ReactNode }) {
  const shown = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    shown.set(withTiming(active ? 1 : 0, { duration: CROSSFADE_MS }));
  }, [active, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[styles.layer, style]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Zero-height by design: the bars inside position themselves (absolute, top-anchored); the slot
  // only provides the shared stacking position above the screen's content.
  slot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
