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

/**
 * How long a tab takes to appear. Short enough that the tap still feels instant — past ~200ms it
 * reads as a transition you have to wait out, which on a bar you tap dozens of times a session is
 * worse than the cut it replaces.
 *
 * Linear, unlike the bars' `settleEase`. A settle curve is right for a gesture hand-off — the bar
 * leaves at the speed the finger left it. There's no gesture behind this one, and an eased opacity
 * ramp just makes it arrive lopsided. `ReduceMotion.System` honours the OS setting for free: with it
 * on, Reanimated lands the value immediately, degrading this back to the instant swap.
 */
const FADE = { duration: 140, easing: Easing.linear, reduceMotion: ReduceMotion.System } as const;

/**
 * A `<TabSlot />` `renderFn` that fades a tab in instead of cutting to it.
 *
 * `renderFn` is expo-router's documented hook for this ("advanced functionality such as
 * animations") and replaces `defaultTabsSlotRender` — so the guards below have to match it, but
 * everything around it (the navigator, the lazy `loaded` bookkeeping, the per-screen `TabContext`)
 * stays expo-router's.
 *
 * Only the ARRIVING screen animates. The one being left is `display: none` the moment focus moves,
 * which is `TabSlot`'s own behaviour and not something a `renderFn` can change: the container above
 * it is fixed at `hasTwoStates: true`, which on iOS is `RNSScreenNavigationContainer` — one view
 * controller, by construction. So there is never a second screen on screen to dissolve between, and
 * this is a fade up from the page rather than a crossfade. Since a tab screen paints no background
 * of its own, that page is the root Stack's background it was already sitting on, so what you see is
 * the content arriving, not a flash.
 *
 * A component rather than the animation inline, because `renderFn` is called once per route inside
 * a map — hooks can't run there, and the opacity has to be per screen anyway. Per screen is also
 * what makes it correct on the render that changes focus: a blurred screen is already sitting at 0,
 * so the first frame it's focused is already the first frame of its fade, with no reset to schedule.
 * One shared fade value could not do that — the effect resetting it would land a frame after the
 * arriving screen had already been committed at whatever the last switch left behind.
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

  // Focused at mount = the tab the app opened on, which must NOT fade: a launch should land on the
  // home, not dissolve into it.
  //
  // Only the launch tab ever hits that branch, and that depends on where this component sits.
  // `useTabSlot` calls `renderFn` for EVERY registered route from the moment the slot mounts, so
  // returning an element here mounts all five of these at startup — four of them unfocused, at 0 —
  // whatever `lazy` then does about rendering their screens. Move the guards below up into
  // `renderFadingTabScreen` so an unloaded route never becomes an element, and a lazy tab would
  // instead mount on its first focus, at 1, and arrive with a cut the one time you'd most notice.
  // (Measured: first-ever visit to a tab fades from 0.)
  const opacity = useSharedValue(isFocused ? 1 : 0);
  useEffect(() => {
    // Straight back to 0 on blur — the screen is `display: none` by then, so there's nothing to
    // animate out, and this is what leaves it ready to fade in next time it's focused.
    opacity.set(isFocused ? withTiming(1, FADE) : 0);
  }, [isFocused, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  // `defaultTabsSlotRender`'s guards, unchanged: never render a blurred screen that asked to be
  // unmounted, or a lazy one that has never been navigated to. After the hooks, so a screen keeps
  // its opacity across a render that returns null.
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

// `TabSlot`'s own screen styles, kept verbatim — one screen is displayed at a time exactly as
// before, so the layout this slot had is the layout it should keep.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: 'relative',
    height: '100%',
  },
  focused: {
    zIndex: 1,
    display: 'flex',
    flexShrink: 0,
    flexGrow: 1,
  },
  unfocused: {
    zIndex: -1,
    display: 'none',
    flexShrink: 1,
    flexGrow: 0,
  },
  fill: {
    flex: 1,
  },
});
