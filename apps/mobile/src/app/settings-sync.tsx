/**
 * Both ends of sync on one screen, and only ever one of them per device: a phone keeps its own
 * library and syncs it WITH a computer; the desktop's library is its server's, so it is never the
 * one syncing — it is the hub. A browser is neither: it reads the server's library directly, and
 * that is already shared with everything else on the same server.
 */
import type { PairedDevice } from '@comical/sync';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { OverlayHeading, useOverlay } from '@/components/overlay/overlay';
import { QrCode } from '@/components/qr-code';
import { RemoteServerForm } from '@/components/settings/remote-server-form';
import { fields, type SettingsField, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import { useApiBase, useSyncPaired } from '@/data/api';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { connectServer } from '@/data/switch-server';
import { setSyncEnabled, syncLibraryNow, useSyncStatus, type SyncStatus } from '@/data/sync';
import { useHydrated } from '@/hooks/use-responsive';
import {
  closeSyncPairing,
  desktopShell,
  desktopSyncsDevices,
  openSyncPairing,
  refreshNetworkSyncAddress,
  unlinkSyncDevice,
  useNetworkSync,
  useNetworkSyncAddress,
  useSyncDevices,
  type PairingOffer,
} from '@/lib/desktop-shell';
import { defaultSyncDeviceName, useChosenSyncDeviceName } from '@/lib/device-name';
import { useRouter } from '@/lib/nav';
import { relTime } from '@/lib/rel-time';
import { testId } from '@/lib/test-id';

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function syncDescription(sync: SyncStatus): string {
  if (sync.running) return 'Syncing…';
  if (sync.lastError) return `Couldn't sync: ${sync.lastError}`;
  if (sync.repairedAt) return `Paired again ${timeOf(sync.repairedAt)} — the computer had been reset`;
  if (sync.lastSyncAt) return `Last synced ${timeOf(sync.lastSyncAt)}`;
  return 'Not synced yet';
}

export default function SyncSettingsScreen() {
  // Gated on hydration: the static web render has no shell, so the rows would otherwise appear
  // only after it and mismatch.
  const desktop = useHydrated() && !!desktopShell();
  return (
    <ThemedView style={styles.container}>
      <TopBar title="Sync" />
      {desktop ? <HubSync /> : <DeviceSync />}
    </ThemedView>
  );
}

/** A phone's side: its own library, kept in step with a hub. */
function DeviceSync() {
  const router = useRouter();
  const { openDialog } = useOverlay();
  const [onDevice] = useEmbeddedEnabled();
  const [apiBase] = useApiBase();
  const paired = useSyncPaired();
  const sync = useSyncStatus();
  const [chosenName, setChosenName] = useChosenSyncDeviceName();
  const { fromHub } = useDownloadPrefs();
  // Only an on-device library needs syncing — a remote server's library is already shared by every
  // client reading it, so a phone running bridges on a server has nothing to do here.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();
  const embeddedActive = onDevice && embeddedAvailable;

  const rows: SettingsField[] = !embeddedAvailable
    ? [
        {
          kind: 'value',
          testID: 'settings.sync.nothing',
          label: 'Sync library',
          description: 'Nothing to sync here: your library lives on the server this app reads from, which everything using it already shares.',
        },
      ]
    : !embeddedActive
      ? [
          {
            kind: 'link',
            testID: 'settings.sync.needs-on-device',
            label: 'Sync library',
            description: 'Turn on Run bridges on this device first — only a library kept on this device has anything to sync.',
            onPress: () => router.push('/settings-general'),
          },
        ]
      : fields(
          {
            kind: 'toggle',
            label: 'Sync library',
            description: sync.unlinked
              ? 'Your computer unlinked this device. Pair again to keep syncing.'
              : 'Keep your library in step with your computer.',
            value: sync.enabled,
            onChange: (v) => void setSyncEnabled(v),
          },
          sync.enabled && {
            kind: 'action',
            testID: 'settings.sync.sync-now',
            label: 'Sync now',
            description: syncDescription(sync),
            onPress: () => void syncLibraryNow(),
          },
          sync.enabled && {
            kind: 'link',
            testID: 'settings.sync.server',
            label: 'Sync server',
            description: apiBase,
            onPress: () =>
              openDialog(
                () => (
                  <RemoteServerForm
                    title="Sync server"
                    description="The computer this library syncs with. Scan the code on its Sync settings, or type the address shown beside it."
                    currentUrl={apiBase}
                    resetLabel={paired ? 'Unpair' : undefined}
                    onSave={connectServer}
                    // The scanner is a camera, so only where there is one.
                    onScan={Platform.OS === 'web' ? undefined : () => router.push('/scan-sync-server')}
                  />
                ),
                { accessibilityLabel: 'Sync server' },
              ),
          },
          sync.enabled && {
            kind: 'toggle',
            label: 'Read from your computer',
            description: 'When it can be reached, take the pages it has downloaded from it instead of the source.',
            value: fromHub,
            onChange: (v) => downloadPrefs$.fromHub.set(v),
          },
          sync.enabled && {
            kind: 'text',
            label: "This phone's name",
            description: 'How the computer lists it.',
            value: chosenName,
            placeholder: defaultSyncDeviceName(),
            onChange: setChosenName,
          },
        );
  const sections: SettingsFormSection[] = [{ fields: rows }];
  return <SettingsList sections={sections} />;
}

/** The desktop's side: a hub phones sync with. */
function HubSync() {
  const { openDialog } = useOverlay();
  const [networkSync, setNetworkSync] = useNetworkSync();
  const networkSyncAddress = useNetworkSyncAddress();
  const devices = useSyncDevices();
  const now = useMinuteTick();
  useEffect(refreshNetworkSyncAddress, []);

  const rows: SettingsField[] = !desktopSyncsDevices()
    ? [{ kind: 'value', label: 'Nothing to sync', description: "This build of the desktop app can't be a sync hub." }]
    : fields(
        {
          kind: 'toggle',
          label: 'Sync with your phone',
          description: 'Let phones on your network keep their library in step with this computer.',
          value: networkSync,
          onChange: setNetworkSync,
        },
        networkSync &&
          (networkSyncAddress
            ? {
                kind: 'link',
                testID: 'settings.sync.pair-phone',
                label: 'Pair a phone',
                description: 'Show a code for one phone to scan',
                onPress: () => openDialog(() => <PairPhoneSheet />, { accessibilityLabel: 'Pair a phone' }),
              }
            : { kind: 'value', testID: 'settings.sync.pair-phone', label: 'Pair a phone', description: 'Not connected to a network' }),
        networkSync &&
          devices.length === 0 && {
            kind: 'value',
            testID: 'settings.sync.no-devices',
            label: 'No phones yet',
            description: 'A phone appears here once it is paired.',
          },
        // Listed while sync is off too: a phone can be unlinked without opening the door to do it.
        // There is no "connected" to show — a sync is a request and a reply — so when it was last
        // here is the whole status. Its key is its own, so unlinking it cuts off that phone and no other.
        ...devices.map(
          (device): SettingsField => ({
            kind: 'action',
            testID: testId('settings.sync.device', device.id),
            label: device.name,
            description: device.lastSeenAt === null ? 'Paired, not synced yet' : `Synced ${relTime(device.lastSeenAt, now)}`,
            verb: 'Unlink',
            role: 'destructive',
            onPress: () => confirmUnlink(device),
          }),
        ),
      );
  const sections: SettingsFormSection[] = [{ fields: rows }];
  return <SettingsList sections={sections} />;
}

function confirmUnlink(device: PairedDevice) {
  openConfirm({
    title: `Unlink ${device.name}?`,
    message: 'It stops syncing with this computer until it is paired again. The library already on it stays there.',
    confirmLabel: 'Unlink',
    pendingLabel: 'Unlinking…',
    tone: 'danger',
    errorFallback: "Couldn't unlink",
    onConfirm: () => unlinkSyncDevice(device.id),
  });
}

/** Re-renders once a minute, so "Synced 3m ago" keeps pace without anything else changing. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The desktop's half of pairing: a code for ONE phone, as a QR for its scanner. The code works
 * once and only while this sheet shows it — a phone that pairs closes the sheet, and one left open
 * swaps in a fresh code as each runs out.
 */
function PairPhoneSheet() {
  const { closeTop } = useOverlay();
  const devices = useSyncDevices();
  const [known] = useState(() => new Set(devices.map((device) => device.id)));
  // `undefined` until the shell has answered; `null` when it has no code to give.
  const [offer, setOffer] = useState<PairingOffer | null | undefined>(undefined);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    void openSyncPairing().then((next) => {
      if (!live) return;
      setOffer(next);
      if (next) expiry = setTimeout(() => setRound((r) => r + 1), Math.max(0, next.expiresAt - Date.now()));
    });
    return () => {
      live = false;
      clearTimeout(expiry);
      closeSyncPairing();
    };
  }, [round]);

  const pairedName = devices.find((device) => !known.has(device.id))?.name;
  useEffect(() => {
    if (pairedName === undefined) return;
    showToast(`Paired with ${pairedName}`);
    closeTop();
  }, [pairedName, closeTop]);

  return (
    <View style={styles.sheet}>
      <OverlayHeading>Pair a phone</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        On the phone, open Settings → Sync, turn on Sync library, and scan this code from Sync server. It pairs one phone;
        show another for the next.
      </ThemedText>
      {offer ? (
        <View style={styles.qr}>
          <QrCode testID="settings.sync.pair-phone.qr" value={offer.address} size={200} />
        </View>
      ) : (
        offer === null && (
          <ThemedText type="small" themeColor="textSecondary">
            Not connected to a network.
          </ThemedText>
        )
      )}
      <ThemedText testID="settings.sync.pair-phone.address" type="small" themeColor="textSecondary" selectable>
        {offer?.address ?? ''}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sheet: {
    gap: Spacing.three,
  },
  qr: {
    alignItems: 'center',
  },
});
