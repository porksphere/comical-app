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

/** Medium impact for a hold paying off — a long-press opening a context menu (matches the series
 *  card menu's open thump, so every hold in the app answers with the same weight). */
export function hapticImpactMedium() {
  if (Platform.OS === 'web') return webVibrate(12);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** Heavy impact — the top of a ramp (e.g. the last beat of a hold-to-arm countdown). */
export function hapticImpactHeavy() {
  if (Platform.OS === 'web') return webVibrate(20);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

/** Success notification — a state actually changed (e.g. a hold-to-arm gesture committing). */
export function hapticNotifySuccess() {
  if (Platform.OS === 'web') return webVibrate(30);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
