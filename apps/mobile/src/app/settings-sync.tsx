import { ScrollView, StyleSheet } from 'react-native';

import { useOverlay } from '@/components/overlay/overlay';
import { ServerLoginForm } from '@/components/settings/server-login-form';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { isEmbeddedRuntimeAvailable } from '@/data/embedded';
import { syncController, useSyncStatus } from '@/data/sync/controller';
import { isSyncActive, setSyncConfig, useSyncConfig } from '@/data/sync/sync-config';
import { isSignedIn, logoutFromServer, useServerSession } from '@/data/server-session';
import { useTheme } from '@/hooks/use-theme';

/**
 * Cross-device sync settings. Sync runs in on-device (embedded) mode, where the app owns the library
 * store — the controls are hidden on web/remote.
 *
 * Setup is a username/password sign-in to your server (create the account on the server with
 * `comical accounts add`, or its `/admin` page). That mints this device's own revocable session token.
 * v1 targets a trusted self-hosted hub on your own network (records travel in the clear so the server
 * can merge them); the encrypted untrusted-relay path (Tier 2) is future work.
 */
export default function SyncSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const theme = useTheme();
  const { open } = useOverlay();
  const [cfg] = useSyncConfig();
  const status = useSyncStatus();
  const session = useServerSession();
  const available = isEmbeddedRuntimeAvailable();
  const signedIn = isSignedIn(session);

  const statusLine =
    status.state === 'syncing'
      ? 'Syncing…'
      : status.state === 'error'
        ? status.error ?? 'Sync failed'
        : status.lastSyncAt
          ? `Last synced ${new Date(status.lastSyncAt).toLocaleTimeString()}`
          : isSyncActive(cfg)
            ? 'Waiting to sync…'
            : 'Off';

  const signIn = () =>
    open(() => (
      <ServerLoginForm
        onSignedIn={() => {
          setSyncConfig({ enabled: true }); // signing in from the sync screen means "start syncing"
          void syncController.refresh();
        }}
      />
    ));

  const signOut = () => {
    setSyncConfig({ enabled: false });
    void logoutFromServer(); // best-effort server-side revoke, then forget locally
    void syncController.refresh();
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Sync" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        {!available ? (
          <SettingsSection>
            <SettingsRow
              label="Sync isn’t available here"
              description="Cross-device sync runs in on-device mode. Turn on “Run bridges on this device” in General."
            />
          </SettingsSection>
        ) : !signedIn ? (
          <SettingsSection title="Connect this device">
            <SettingsRow
              label="Sign in to your server"
              description="Use an account created on the server (`comical accounts add`, or its /admin page)."
              onPress={signIn}
            />
          </SettingsSection>
        ) : (
          <SettingsSection>
            <SettingsToggleRow
              label="Sync this device"
              description={`Signed in as ${session.username} · ${session.url}`}
              value={cfg.enabled}
              onChange={(enabled) => {
                setSyncConfig({ enabled });
                void syncController.refresh(); // start/stop the loop to match the toggle
              }}
            />
            <SettingsRow
              label="Sync now"
              description={statusLine}
              descriptionColor={status.state === 'error' ? theme.accent : undefined}
              onPress={() => void syncController.syncNow()}
            />
            <SettingsRow
              label="Sign out"
              description="Stops syncing and forgets the server. Your library stays on this device."
              onPress={signOut}
            />
          </SettingsSection>
        )}
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
