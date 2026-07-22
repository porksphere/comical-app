import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsSection } from '@/components/settings/settings-row';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { showToast } from '@/components/toast';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { syncAppBadge } from '@/data/activity/app-badge';
import { applyChapterCheck } from '@/data/activity/background';
import { notifyPrefs$, useNotifyPrefs } from '@/data/activity/prefs';
import { queryKeys } from '@/data/queries';
import { useMockActive } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';

const isNative = Platform.OS !== 'web';

export default function NotificationsSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const queryClient = useQueryClient();
  const mock = useMockActive();
  const { autoCheck, backgroundCheck, wifiOnly, notifications, appBadge } = useNotifyPrefs();

  /** Enabling alerts needs the OS permission first; a denial reverts the toggle with a pointer. */
  const toggleNotifications = async (v: boolean) => {
    if (!v) {
      notifyPrefs$.notifications.set(false);
      return;
    }
    try {
      let perm = await Notifications.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: false },
        });
      }
      if (!perm.granted) {
        showToast('Enable notifications for Comical in system settings');
        return;
      }
      notifyPrefs$.notifications.set(true);
    } catch {
      // Native module absent (a dev client built before expo-notifications shipped).
      showToast('Notifications need an updated app build');
    }
  };

  /**
   * The icon badge needs its own permission grant: iOS silently discards `setBadgeCountAsync`
   * unless the app holds badge authorization, and that's independent of the alerts toggle — so
   * enabling this must request it, not assume "Notify about new chapters" already did.
   */
  const toggleAppBadge = async (v: boolean) => {
    if (!v) {
      notifyPrefs$.appBadge.set(false);
      syncAppBadge(0); // clear immediately; re-enabling refreshes from the live count
      return;
    }
    try {
      let perm = await Notifications.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await Notifications.requestPermissionsAsync({ ios: { allowBadge: true } });
      }
      if (!perm.granted) {
        showToast('Allow badges for Comical in system settings');
        return;
      }
      notifyPrefs$.appBadge.set(true);
      // Paint the icon now rather than waiting for the count to next change. The always-mounted
      // tab badge keeps this query fresh, so the cache is the current whole-feed unread count.
      const count = queryClient.getQueryData<number>(queryKeys.activityCount(mock)) ?? 0;
      syncAppBadge(count);
    } catch {
      // Native module absent (a dev client built before expo-notifications shipped).
      showToast('App icon badge needs an updated app build');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Notifications" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection>
          <SettingsToggleRow
            label="Check for new chapters"
            description="Scan your library when you open the app."
            value={autoCheck}
            onChange={(v) => notifyPrefs$.autoCheck.set(v)}
          />
          {isNative && (
            <SettingsToggleRow
              label="Check in background"
              description="Periodically, when the system allows."
              value={backgroundCheck}
              onChange={(v) => {
                notifyPrefs$.backgroundCheck.set(v);
                applyChapterCheck(v);
              }}
            />
          )}
          {isNative && backgroundCheck && (
            <SettingsToggleRow
              label="Wi-Fi only"
              description="Hold background checks until you're on Wi-Fi."
              value={wifiOnly}
              onChange={(v) => notifyPrefs$.wifiOnly.set(v)}
            />
          )}
          {isNative && (
            <SettingsToggleRow
              label="Notify about new chapters"
              description="A notification when a background check finds releases."
              value={notifications}
              onChange={(v) => void toggleNotifications(v)}
            />
          )}
          {isNative && (
            <SettingsToggleRow
              label="App icon badge"
              description="Show the unread count on the app icon."
              value={appBadge}
              onChange={(v) => void toggleAppBadge(v)}
            />
          )}
        </SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
