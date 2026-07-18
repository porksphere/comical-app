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

/** Soft impact — the faintest single beat, for the bottom of a ramp. */
export function hapticImpactSoft() {
  if (Platform.OS === 'web') return webVibrate(4);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
}

/** Light impact for a primary tap — opening a row, pressing back, crossing the pull-to-refresh
 *  threshold. */
export function hapticImpactLight() {
  if (Platform.OS === 'web') return webVibrate(8);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Medium impact for a hold paying off — a long-press opening a context menu (matches the series
 *  card menu's open thump, so every hold in the app answers with the same weight). */
export function hapticImpactMedium() {
  if (Platform.OS === 'web') return webVibrate(12);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** Heavy impact — the ONE strong beat a ramp lands on (a hold-to-arm gesture committing). A single
 *  clean thump: deliberately an impact, not `notificationAsync(Success)`, whose multi-pulse pattern
 *  read as a weird double-buzz at the top of the ramp. */
export function hapticImpactHeavy() {
  if (Platform.OS === 'web') return webVibrate(20);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}
