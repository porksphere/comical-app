import { useAnimatedKeyboard, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How far a bottom-anchored control must rise to clear the on-screen keyboard, as a shared value
 * (see `use-keyboard-lift.web.ts` for the browser half — web has no native keyboard inset and reads
 * `visualViewport` instead, which is also why `active` exists at all; native ignores it).
 *
 * NATIVE: `useAnimatedKeyboard` reads the real IME inset — WindowInsetsAnimation on Android, the
 * keyboard notifications on iOS — on the UI thread, already interpolated, so the caller tracks the
 * keyboard frame-for-frame with no synthetic easing to guess at.
 *
 * This replaced a hand-rolled `Keyboard.addListener` version (keyboardWillShow on iOS,
 * keyboardDidShow on Android), which is dead on Android under edge-to-edge — the default from Expo
 * SDK 54. RN derives those events from the window's visible display frame, but an edge-to-edge
 * window does NOT resize when the IME opens, so no height is ever reported and the control simply
 * stayed put under the keyboard. Reanimated auto-detects edge-to-edge and passes the translucency
 * flags for us, so there is nothing to configure here.
 *
 * `insets.bottom` comes off the top because callers are positioned relative to the safe area
 * already (the pill sits at `bottom: insets.bottom + …`), so that much of the lift is spent.
 */
export function useKeyboardLift(_active: boolean): SharedValue<number> {
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  return useDerivedValue(() => Math.max(0, keyboard.height.value - insets.bottom));
}
