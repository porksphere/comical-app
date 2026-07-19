/**
 * The app-icon badge (iOS/Android home screen), mirrored from the same unread feed count as the
 * Activity tab pip. Fire-and-forget: badge writes are cosmetic and must never fail a caller.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getNotifyPrefsSync } from './prefs';

/** Set the app icon badge to `count` (0 clears it). No-op on web or when the pref is off. */
export function syncAppBadge(count: number): void {
  if (Platform.OS === 'web') return;
  if (count > 0 && !getNotifyPrefsSync().appBadge) return; // clearing (0) is always allowed
  void Notifications.setBadgeCountAsync(count).catch(() => {});
}
