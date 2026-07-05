import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Light tick for discrete selections — picking an option, flipping a switch. */
export function hapticSelection() {
  if (Platform.OS === 'web') return;
  void Haptics.selectionAsync();
}

/** Light impact for a primary tap — opening a row, pressing back. */
export function hapticImpactLight() {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
