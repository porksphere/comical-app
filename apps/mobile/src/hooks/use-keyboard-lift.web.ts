import { useEffect } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/**
 * Web half of `use-keyboard-lift.ts` — same contract, browser mechanics.
 *
 * There is no keyboard inset to read on web, so this adapts the `visualViewport` resize signal
 * `search-field.tsx` already uses (there, to force a blur on keyboard-close) into a lift instead:
 * the shrunk viewport IS the keyboard. `scroll` is listened to as well because some mobile browsers
 * shift the viewport's `offsetTop` rather than resizing it.
 *
 * Unlike native this IS gated on `active`. A mobile browser's visual viewport also changes when the
 * URL bar collapses on scroll, which has nothing to do with a keyboard — subscribing only while the
 * field is genuinely open keeps that from jogging the control around. Reanimated's own
 * `useAnimatedKeyboard` is deliberately not used here: on web it is a no-op that logs a warning on
 * every mount.
 */
export function useKeyboardLift(active: boolean): SharedValue<number> {
  const lift = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const baseline = window.innerHeight;
    const onResize = () => {
      lift.set(withTiming(Math.max(0, baseline - vv.height - vv.offsetTop), { duration: 150 }));
    };
    onResize();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      lift.set(withTiming(0, { duration: 150 }));
    };
  }, [active, lift]);

  return lift;
}
