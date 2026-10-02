/**
 * Both ends of sync on one screen, and only ever one of them per device: a phone keeps its own
 * library and syncs it WITH a computer; the desktop's library is its server's, so it is never the
 * one syncing — it is the hub. A browser is neither: it reads the server's library directly, and
 * that is already shared with everything else on the same server.
 */
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { OverlayHeading, useOverlay } from '@/components/overlay/overlay';
import { QrCode } from '@/components/qr-code';
import { RemoteServerForm } from '@/components/settings/remote-server-form';
import { SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useApiBase } from '@/data/api';
import { isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { switchServer } from '@/data/switch-server';
import { displaySyncAddress } from '@/data/sync-address';
import { setSyncEnabled, syncLibraryNow, useSyncStatus, type SyncStatus } from '@/data/sync';
import { useHydrated } from '@/hooks/use-responsive';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import {
  desktopRekeysSync,
  desktopShell,
  desktopSyncsDevices,
  newNetworkSyncKey,
  refreshNetworkSyncAddress,
  useNetworkSync,
  useNetworkSyncAddress,
} from '@/lib/desktop-shell';
import { useRouter } from '@/lib/nav';
import { scrollbarInset } from '@/lib/scrollbar-inset';

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function syncDescription(sync: SyncStatus): string {
  if (sync.running) return 'Syncing…';
  if (sync.lastError) return `Couldn't sync: ${sync.lastError}`;
  if (sync.repairedAt) return `Paired again ${timeOf(sync.repairedAt)} — the computer had been reset`;
  if (sync.lastSyncAt) return `Last synced ${timeOf(sync.lastSyncAt)}`;
  return 'Not synced yet';
}

export default function SyncSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  // Gated on hydration: the static web render has no shell, so the rows would otherwise appear
  // only after it and mismatch.
  const desktop = useHydrated() && !!desktopShell();

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Sync" />
      <ScrollView style={scrollbarInset(contentPadding.paddingTop)} contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection>{desktop ? <HubRows /> : <DeviceRows />}</SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

/** A phone's side: its own library, kept in step with a hub. */
function DeviceRows() {
  const router = useRouter();
  const { open } = useOverlay();
  const [onDevice] = useEmbeddedEnabled();
  const [apiBase] = useApiBase();
  const sync = useSyncStatus();
  // Only an on-device library needs syncing — a remote server's library is already shared by every
  // client reading it, so a phone running bridges on a server has nothing to do here.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();
  const embeddedActive = onDevice && embeddedAvailable;

  if (!embeddedAvailable) {
    return (
      <SettingsRow
        testID="settings.sync.nothing"
        label="Sync library"
        description="Nothing to sync here: your library lives on the server this app reads from, which everything using it already shares."
      />
    );
  }
  if (!embeddedActive) {
    return (
      <SettingsRow
        testID="settings.sync.needs-on-device"
        label="Sync library"
        description="Turn on Run bridges on this device first — only a library kept on this device has anything to sync."
        onPress={() => router.push('/settings-general')}
      />
    );
  }
  return (
    <>
      <SettingsToggleRow
        label="Sync library"
        description="Keep your library in step with your computer."
        value={sync.enabled}
        onChange={(v) => void setSyncEnabled(v)}
      />
      {sync.enabled && (
        <SettingsRow
          testID="settings.sync.sync-now"
          label="Sync now"
          description={syncDescription(sync)}
          onPress={() => void syncLibraryNow()}
        />
      )}
      {sync.enabled && (
        <SettingsRow
          testID="settings.sync.server"
          label="Sync server"
          description={apiBase}
          onPress={() =>
            open(() => (
              <RemoteServerForm
                title="Sync server"
                description="The computer this library syncs with. Scan the code on its Sync settings, or type the address shown beside it."
                currentUrl={apiBase}
                onSave={switchServer}
                // The scanner is a camera, so only where there is one.
                onScan={Platform.OS === 'web' ? undefined : () => router.push('/scan-sync-server')}
              />
            ))
          }
        />
      )}
    </>
  );
}

/** The desktop's side: a hub phones sync with. */
function HubRows() {
  const { open } = useOverlay();
  const [networkSync, setNetworkSync] = useNetworkSync();
  const networkSyncAddress = useNetworkSyncAddress();
  useEffect(refreshNetworkSyncAddress, []);

  if (!desktopSyncsDevices()) {
    return <SettingsRow label="Nothing to sync" description="This build of the desktop app can't be a sync hub." />;
  }
  return (
    <>
      <SettingsToggleRow
        label="Sync with your phone"
        description="Let phones on your network keep their library in step with this computer."
        value={networkSync}
        onChange={setNetworkSync}
      />
      {networkSync && (
        <SettingsRow
          testID="settings.sync.address"
          label="Sync server for your phone"
          description={networkSyncAddress ? displaySyncAddress(networkSyncAddress) : 'Not connected to a network'}
          onPress={networkSyncAddress ? () => open(() => <PairPhoneSheet />) : undefined}
        />
      )}
    </>
  );
}

/**
 * The desktop's half of pairing: its address as a QR code for the phone's scanner, and the one
 * place the key in it can be replaced. The address is read live, so a changed network shows here
 * without reopening.
 */
function PairPhoneSheet() {
  const theme = useTheme();
  const address = useNetworkSyncAddress();
  const { open, closeTop } = useOverlay();

  // The confirm popup draws beneath the overlay stack, so the sheet gives way to it and comes back
  // once the new code exists — the same hand-off AddRegistryForm makes before offering adoption.
  const rekey = () => {
    closeTop();
    openConfirm({
      title: 'Use a new key?',
      message: 'Every phone paired with this computer stops syncing until it scans the new code.',
      confirmLabel: 'New key',
      pendingLabel: 'Making a new key…',
      tone: 'danger',
      errorFallback: "Couldn't make a new key",
      onConfirm: async () => {
        if (!(await newNetworkSyncKey())) throw new Error("Couldn't make a new key");
        open(() => <PairPhoneSheet />);
      },
    });
  };

  return (
    <View style={styles.sheet}>
      <OverlayHeading>Pair your phone</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        On the phone, open Settings → Sync, turn on Sync library, and scan this code from Sync server.
      </ThemedText>
      {address ? (
        <View style={styles.qr}>
          <QrCode testID="settings.sync.pair-phone.qr" value={address} size={200} />
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Not connected to a network.
        </ThemedText>
      )}
      <ThemedText type="small" themeColor="textSecondary" selectable>
        {address ?? ''}
      </ThemedText>
      {desktopRekeysSync() && (
        <View style={styles.sheetActions}>
          <Pressable testID="settings.sync.pair-phone.new-key" onPress={rekey} style={styles.sheetBtn}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              New key
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
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
  sheet: {
    gap: Spacing.three,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  sheetBtn: {
    paddingVertical: Spacing.two,
  },
  qr: {
    alignItems: 'center',
  },
});
