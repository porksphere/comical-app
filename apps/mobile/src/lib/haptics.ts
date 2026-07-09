import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Best-effort haptic on web: the Vibration API is supported on Android Chrome and silently ignored
 *  on iOS Safari + desktop — so this is a bonus buzz where available, never something to rely on. */
function webVibrate(ms: number) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
}

/** Light tick for discrete selections — picking an option, flipping a switch. */
export function hapticSelection() {
  if (Platform.OS === 'web') return webVibrate(5);
  void Haptics.selectionAsync();
}

/** Light impact for a primary tap — opening a row, pressing back, crossing the pull-to-refresh
 *  threshold. */
export function hapticImpactLight() {
  if (Platform.OS === 'web') return webVibrate(8);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
