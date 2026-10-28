import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { BridgeThumbRadius } from '@/components/selector';
import { showToast } from '@/components/toast';
import { runBrowseHoldAction, useBrowseHoldAction, useBrowseHoldSound } from '@/data/browse-hold-action';
import { useRampedHold } from '@/hooks/use-ramped-hold';

const HOLD_HINT = 'Hold to show NSFW content until the app is closed';

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
  const [holdAction] = useBrowseHoldAction();
  const [sound] = useBrowseHoldSound();
  const hold = useRampedHold(
    () => {
      const message = runBrowseHoldAction();
      if (message) showToast(message);
    },
    { sound: holdAction !== 'none' && sound },
  );
  return (
    <Pressable
      testID={testID}
      {...(holdAction !== 'none' && { onPressIn: hold.onPressIn, onPressOut: hold.onPressOut })}
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
