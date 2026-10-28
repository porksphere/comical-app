import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, { type useAnimatedStyle } from 'react-native-reanimated';

import { BridgeThumbRadius } from '@/components/selector';
import { showToast } from '@/components/toast';
import { runBrowseHoldAction, useBrowseHoldAction, useBrowseHoldSound } from '@/data/browse-hold-action';
import { useRampedHold } from '@/hooks/use-ramped-hold';

const HOLD_HINT = 'Hold to show NSFW content until the app is closed';

/**
 * The hold gesture Settings binds (`useBrowseHoldAction`) as press handlers: the ramp of haptic
 * beats from `useRampedHold`, committing the bound action and a toast at the top. `enabled` is
 * false while the gesture is bound to 'none', when the handlers must not be attached at all (see
 * HoldActionTarget). Shared by the mark that takes the press itself and the native bar hold
 * (`NativeTabHeader`), which gets its phases from UIKit.
 */
export function useHoldAction(): {
  enabled: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
  pulseStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
} {
  const [holdAction] = useBrowseHoldAction();
  const [sound] = useBrowseHoldSound();
  const enabled = holdAction !== 'none';
  const hold = useRampedHold(
    () => {
      const message = runBrowseHoldAction();
      if (message) showToast(message);
    },
    { sound: enabled && sound },
  );
  return { enabled, ...hold };
}

/**
 * A top-bar identity mark — Browse's bridge icon or its title, Library's collection icon — that
 * runs whatever Settings has the hold gesture bound to: three haptic beats ramp up while holding,
 * then it commits (see useRampedHold) and a toast says what happened. A plain tap does nothing.
 *
 * With `size` it is a square tile clipping its pulse to the tile's corner; without, it hugs its
 * content (a title) and the pulse swells the text as it is. `label` names the content for
 * assistive tech, the gesture then being the hint, where the mark isn't only the gesture.
 *
 * Bound to 'none' the gesture is GONE, not merely inert: the handlers come off entirely, so a long
 * press never even starts the haptic ramp. Arming it and dropping the result would still buzz three
 * times at someone who turned it off.
 */
export function HoldActionTarget({
  size,
  label,
  testID,
  children,
}: {
  size?: number;
  label?: string;
  testID?: string;
  children: ReactNode;
}) {
  const hold = useHoldAction();
  return (
    <Pressable
      testID={testID}
      {...(hold.enabled && { onPressIn: hold.onPressIn, onPressOut: hold.onPressOut })}
      accessibilityRole="button"
      accessibilityLabel={label ?? HOLD_HINT}
      accessibilityHint={label ? HOLD_HINT : undefined}
      style={[styles.target, size !== undefined && { width: size, height: size }]}>
      {/* The ramp's beats swell the tile in step with the haptics. */}
      <Animated.View style={[size !== undefined ? styles.pulse : styles.text, hold.pulseStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    alignSelf: 'center',
  },
  // The corner clip lives on the pulsing view, not the Pressable, so a beat swells the whole
  // rounded tile instead of being cut off at the tile's own edge.
  pulse: {
    flex: 1,
    borderRadius: BridgeThumbRadius,
    overflow: 'hidden',
  },
  text: {
    flexShrink: 1,
    minWidth: 0,
  },
});
