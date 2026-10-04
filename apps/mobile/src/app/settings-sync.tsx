/**
 * Both ends of sync on one screen, and only ever one of them per device: a phone keeps its own
 * library and syncs it WITH a computer; the desktop's library is its server's, so it is never the
 * one syncing — it is the hub. A browser is neither: it reads the server's library directly, and
 * that is already shared with everything else on the same server.
 */
import type { PairedDevice } from '@comical/sync';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { OverlayHeading, useOverlay } from '@/components/overlay/overlay';
import { QrCode } from '@/components/qr-code';
import { RemoteServerForm } from '@/components/settings/remote-server-form';
import { SettingsTextRow, SettingsToggleRow } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useApiBase, useSyncPaired } from '@/data/api';
import { isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { connectServer } from '@/data/switch-server';
import { setSyncEnabled, syncLibraryNow, useSyncStatus, type SyncStatus } from '@/data/sync';
import { useHydrated } from '@/hooks/use-responsive';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
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
import { scrollbarInset } from '@/lib/scrollbar-inset';
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
  const paired = useSyncPaired();
  const sync = useSyncStatus();
  const [chosenName, setChosenName] = useChosenSyncDeviceName();
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
        description={
          sync.unlinked
            ? 'Your computer unlinked this device. Pair again to keep syncing.'
            : 'Keep your library in step with your computer.'
        }
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
                resetLabel={paired ? 'Unpair' : undefined}
                onSave={connectServer}
                // The scanner is a camera, so only where there is one.
                onScan={Platform.OS === 'web' ? undefined : () => router.push('/scan-sync-server')}
              />
            ))
          }
        />
      )}
      {sync.enabled && (
        <SettingsTextRow
          label="This phone's name"
          description="How the computer lists it."
          value={chosenName}
          placeholder={defaultSyncDeviceName()}
          onChange={setChosenName}
          autoCorrect={false}
        />
      )}
    </>
  );
}

/** The desktop's side: a hub phones sync with. */
function HubRows() {
  const { openDialog } = useOverlay();
  const [networkSync, setNetworkSync] = useNetworkSync();
  const networkSyncAddress = useNetworkSyncAddress();
  const devices = useSyncDevices();
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
          testID="settings.sync.pair-phone"
          label="Pair a phone"
          description={networkSyncAddress ? 'Show a code for one phone to scan' : 'Not connected to a network'}
          onPress={networkSyncAddress ? () => openDialog(() => <PairPhoneSheet />, { accessibilityLabel: 'Pair a phone' }) : undefined}
        />
      )}
      {networkSync && devices.length === 0 && (
        <SettingsRow testID="settings.sync.no-devices" label="No phones yet" description="A phone appears here once it is paired." />
      )}
      {/* Listed while sync is off too: a phone can be unlinked without opening the door to do it. */}
      {devices.map((device) => (
        <DeviceRow key={device.id} device={device} />
      ))}
    </>
  );
}

/**
 * One phone paired with this computer. There is no "connected" to show — a sync is a request and a
 * reply — so when it was last here is the whole status. Its key is its own, so unlinking it cuts
 * off that phone and no other.
 */
function DeviceRow({ device }: { device: PairedDevice }) {
  const theme = useTheme();
  const now = useMinuteTick();
  return (
    <SettingsRow
      testID={testId('settings.sync.device', device.id)}
      label={device.name}
      description={device.lastSeenAt === null ? 'Paired, not synced yet' : `Synced ${relTime(device.lastSeenAt, now)}`}
      right={
        <ThemedText type="smallBold" style={{ color: theme.danger }}>
          Unlink
        </ThemedText>
      }
      onPress={() =>
        openConfirm({
          title: `Unlink ${device.name}?`,
          message: 'It stops syncing with this computer until it is paired again. The library already on it stays there.',
          confirmLabel: 'Unlink',
          pendingLabel: 'Unlinking…',
          tone: 'danger',
          errorFallback: "Couldn't unlink",
          onConfirm: () => unlinkSyncDevice(device.id),
        })
      }
    />
  );
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
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  sheet: {
    gap: Spacing.three,
  },
  qr: {
    alignItems: 'center',
  },
});
