import type { TabsDescriptor, TabsSlotRenderOptions } from 'expo-router/ui';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Screen } from 'react-native-screens';

/** Linear, not the bars' `settleEase`: an eased opacity ramp arrives lopsided. */
const FADE = { duration: 140, easing: Easing.linear, reduceMotion: ReduceMotion.System } as const;

/**
 * A `<TabSlot />` `renderFn` that fades an arriving tab in. Replaces `defaultTabsSlotRender`, so
 * the guards below have to match it.
 *
 * Only the arriving screen animates: `TabSlot`'s container is fixed at `hasTwoStates: true`, which
 * on iOS is a one-view-controller container, so there is never a second screen to dissolve between.
 */
export function renderFadingTabScreen(descriptor: TabsDescriptor, options: TabsSlotRenderOptions) {
  return <FadingTabScreen descriptor={descriptor} {...options} />;
}

function FadingTabScreen({
  descriptor,
  isFocused,
  loaded,
  detachInactiveScreens,
}: TabsSlotRenderOptions & { descriptor: TabsDescriptor }) {
  const { lazy = true, unmountOnBlur, freezeOnBlur } = descriptor.options;

  // Focused at mount is the launch tab, which must not fade in. Every other screen mounts here
  // unfocused at 0 — `renderFn` runs for every registered route from the moment the slot mounts,
  // whatever `lazy` does about rendering them — so their first focus is already the first frame of
  // a fade. Moving the guards below up into `renderFadingTabScreen` would break that.
  const opacity = useSharedValue(isFocused ? 1 : 0);
  useEffect(() => {
    opacity.set(isFocused ? withTiming(1, FADE) : 0);
  }, [isFocused, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  if (unmountOnBlur && !isFocused) return null;
  if (lazy && !loaded && !isFocused) return null;

  return (
    <Screen
      enabled={detachInactiveScreens}
      activityState={isFocused ? 2 : 0}
      freezeOnBlur={freezeOnBlur}
      style={[styles.screen, isFocused ? styles.focused : styles.unfocused]}>
      <Animated.View style={[styles.fill, fadeStyle]}>{descriptor.render()}</Animated.View>
    </Screen>
  );
}

// `TabSlot`'s own screen styles, kept verbatim.
const styles = StyleSheet.create({
  screen: { flex: 1, position: 'relative', height: '100%' },
  focused: { zIndex: 1, display: 'flex', flexShrink: 0, flexGrow: 1 },
  unfocused: { zIndex: -1, display: 'none', flexShrink: 1, flexGrow: 0 },
  fill: { flex: 1 },
});
