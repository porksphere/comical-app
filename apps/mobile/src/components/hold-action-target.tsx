import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { BridgeThumbRadius } from '@/components/selector';
import { showToast } from '@/components/toast';
import { runBrowseHoldAction, useBrowseHoldAction, useBrowseHoldSound } from '@/data/browse-hold-action';
import { useRampedHold } from '@/hooks/use-ramped-hold';

/**
 * A top-bar identity tile — Browse's bridge icon, Library's collection icon — that runs whatever
 * Settings has the hold gesture bound to: three haptic beats ramp up while holding, then it commits
 * (see useRampedHold) and a toast says what happened. A plain tap does nothing.
 *
 * Bound to 'none' the gesture is GONE, not merely inert: the handlers come off entirely, so a long
 * press never even starts the haptic ramp. Arming it and dropping the result would still buzz three
 * times at someone who turned it off.
 */
export function HoldActionTarget({ size, testID, children }: { size: number; testID?: string; children: ReactNode }) {
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
      accessibilityLabel="Hold to show NSFW content until the app is closed"
      style={[styles.target, { width: size, height: size }]}>
      {/* The ramp's beats swell the tile in step with the haptics. */}
      <Animated.View style={[styles.pulse, hold.pulseStyle]}>{children}</Animated.View>
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
});
