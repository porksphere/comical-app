import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { OverlayHeading, useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { QrCode } from '@/components/qr-code';
import { SettingsSelectRow, SettingsToggleRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { scrollbarInset } from '@/lib/scrollbar-inset';
import { exportLibraryBackup, getBridges, getTrackers, restoreLibraryBackup, useApiBase } from '@/data/api';
import { pickBackupFile, saveBackupFile } from '@/data/backup-file';
import {
  backupFileName,
  describeBackup,
  describeMissing,
  describeRestore,
  missingFromBackup,
  parseBackupFile,
} from '@/data/backup-summary';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyBackgroundDownloads } from '@/data/downloads/background';
import { kickDownloads } from '@/data/downloads/engine';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { isEmbeddedRuntimeAvailable, swapDataSourceMode, useEmbeddedEnabled } from '@/data/embedded';
import { queryClient } from '@/data/query-client';
import { useBrowseHoldAction, type BrowseHoldAction } from '@/data/browse-hold-action';
import { useNsfwMode, type NsfwMode } from '@/data/source';
import { switchServer } from '@/data/switch-server';
import { displaySyncAddress } from '@/data/sync-address';
import { setSyncEnabled, syncLibraryNow, useSyncStatus, type SyncStatus } from '@/data/sync';
import { useHydrated } from '@/hooks/use-responsive';
import { useTheme, useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import {
  desktopRekeysSync,
  desktopShell,
  desktopSyncsDevices,
  newNetworkSyncKey,
  refreshNetworkSyncAddress,
  trayName,
  useNetworkSync,
  useNetworkSyncAddress,
  useOpenAtLogin,
  useRunInTray,
} from '@/lib/desktop-shell';
import { friendlyError } from '@/lib/friendly-error';
import { useRouter } from '@/lib/nav';
import { lightCards$, useLightCards } from '@/lib/perf-flags';

const NSFW_MODE_OPTIONS: SettingsOption<NsfwMode>[] = [
  { value: 'off', label: 'Off', description: 'NSFW-flagged bridges stay hidden everywhere in the app.' },
  { value: 'on', label: 'On', description: 'NSFW-flagged bridges stay visible until you turn this off again.' },
  {
    value: 'until-background',
    label: 'On until app is closed',
    description: 'NSFW-flagged bridges are visible now, but hidden again as soon as you leave or minimize the app.',
  },
  {
    value: 'until-restart',
    label: 'On until app restarts',
    description: 'NSFW-flagged bridges are visible now, and stay that way while switching apps — hidden again the next time Comical is relaunched.',
  },
];

/** The hold gesture has no label and no visual affordance, so these descriptions are the only
 *  place it is ever explained — write them as the feature's documentation, not as option blurbs. */
const HOLD_ACTION_OPTIONS: SettingsOption<BrowseHoldAction>[] = [
  { value: 'none', label: 'Nothing', description: 'The bridge icon does nothing when held.' },
  {
    value: 'nsfw-until-closed',
    label: 'Show NSFW until app is closed',
    description: 'Hold to reveal NSFW-flagged bridges until you leave or minimize the app. Hold again to hide them.',
  },
  {
    value: 'nsfw-until-restart',
    label: 'Show NSFW until app restarts',
    description: 'Hold to reveal NSFW-flagged bridges until Comical is next relaunched — they survive switching apps. Hold again to hide them.',
  },
];

const THEME_OPTIONS: SettingsOption<ThemePreference>[] = [
  { value: 'system', label: 'System', description: 'Follow the device’s light or dark setting.' },
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
];

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function syncDescription(sync: SyncStatus): string {
  if (sync.running) return 'Syncing…';
  if (sync.lastError) return `Couldn't sync: ${sync.lastError}`;
  if (sync.repairedAt) return `Paired again ${timeOf(sync.repairedAt)} — the computer had been reset`;
  if (sync.lastSyncAt) return `Last synced ${timeOf(sync.lastSyncAt)}`;
  return 'Not synced yet';
}

export default function GeneralSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const [nsfwMode, setNsfwMode] = useNsfwMode();
  const [holdAction, setHoldAction] = useBrowseHoldAction();
  const [themePref, setThemePref] = useThemePreference();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  const [apiBase] = useApiBase();
  const router = useRouter();
  const lightCards = useLightCards();
  const [runInTray, setRunInTray] = useRunInTray();
  const [openAtLogin, setOpenAtLogin] = useOpenAtLogin();
  const [networkSync, setNetworkSync] = useNetworkSync();
  const networkSyncAddress = useNetworkSyncAddress();
  useEffect(refreshNetworkSyncAddress, []);
  // Gated on hydration: the static web render has no shell, so the row would otherwise appear only
  // after it and mismatch.
  const desktop = useHydrated() && !!desktopShell();
  const { wifiOnly, background } = useDownloadPrefs();
  const { open } = useOverlay();
  // The on-device runtime is only offered where a native bridge engine exists (iOS/Android with the
  // native module built) — never on web, which always uses a remote server.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();
  // Whether the app is actually running embedded right now (not just the user's stored preference —
  // see getResolvedModeSync in embedded/preference.ts). The remote-server row is meaningless while
  // this is true, so it's hidden rather than just disabled.
  const embeddedActive = onDevice && embeddedAvailable;
  const sync = useSyncStatus();

  const toggleOnDevice = (enabled: boolean) => {
    setOnDevice(enabled);
    swapDataSourceMode(enabled); // transport swap + the cache/downloads flushes (see apply-mode.ts)
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="General" />
      <ScrollView style={scrollbarInset(contentPadding.paddingTop)} contentContainerStyle={[styles.content, contentPadding]}>
        {/* One unheadered list. "APPEARANCE" over a row already called Appearance, and "CONTENT"
            over one called NSFW content, said nothing the row didn't — every row here carries its
            own title and a line explaining it. */}
        <SettingsSection>
          <SettingsSelectRow
            label="Appearance"
            description="Light or dark theme."
            value={themePref}
            options={THEME_OPTIONS}
            onChange={setThemePref}
          />
          <SettingsToggleRow
            label="Lightweight cards"
            description="Drop cover animations for smoother scrolling."
            value={lightCards}
            onChange={(v) => lightCards$.light.set(v)}
          />
          <SettingsSelectRow
            label="NSFW content"
            description="Whether NSFW-flagged bridges are visible."
            value={nsfwMode}
            options={NSFW_MODE_OPTIONS}
            onChange={setNsfwMode}
          />
          {/* Directly under the NSFW row because that is what it acts on, and because this row is
              the gesture's only documentation — nothing on Browse says the icon is holdable. */}
          <SettingsSelectRow
            label="Hold bridge icon"
            description="What holding the Browse tab's bridge icon does."
            value={holdAction}
            options={HOLD_ACTION_OPTIONS}
            onChange={setHoldAction}
          />
          {embeddedAvailable && (
            <SettingsToggleRow
              label="Run bridges on this device"
              description="Fetch and read on-device, with no server."
              value={onDevice}
              onChange={toggleOnDevice}
            />
          )}
          {/* Only an on-device library needs syncing — a remote server's library is already shared by
              every client reading it. The hub is the same server the remote mode would use. */}
          {embeddedActive && (
            <SettingsToggleRow
              label="Sync library"
              description="Keep your library in step with your server."
              value={sync.enabled}
              onChange={(v) => void setSyncEnabled(v)}
            />
          )}
          {embeddedActive && sync.enabled && (
            <SettingsRow
              testID="settings.general.sync-now"
              label="Sync now"
              description={syncDescription(sync)}
              onPress={() => void syncLibraryNow()}
            />
          )}
          {(!embeddedActive || sync.enabled) && (
            <SettingsRow
              testID="settings.general.remote-server"
              label={embeddedActive ? 'Sync server' : 'Remote server'}
              description={displaySyncAddress(apiBase)}
              onPress={() =>
                open(() => (
                  <RemoteServerForm
                    currentUrl={apiBase}
                    onSave={switchServer}
                    // The scanner is a camera, so only where there is one. A desktop never pairs
                    // this way round — it is the end that shows the code.
                    onScan={Platform.OS === 'web' ? undefined : () => router.push('/scan-sync-server')}
                  />
                ))
              }
            />
          )}
          {desktop && (
            <SettingsToggleRow
              label={`Keep running in the ${trayName()}`}
              description="Closing the window leaves Comical running, so downloads carry on."
              value={runInTray}
              onChange={setRunInTray}
            />
          )}
          {desktop && (
            <SettingsToggleRow
              label="Open at login"
              description={
                !desktopShell()?.loginItems
                  ? 'Takes effect in an installed build.'
                  : runInTray
                    ? `Start Comical in the ${trayName()} when you sign in.`
                    : 'Start Comical when you sign in.'
              }
              value={openAtLogin}
              onChange={setOpenAtLogin}
            />
          )}
          {/* The other end of "Sync library" above: the desktop's library is its own server's, so it
              is never the one syncing — it is what a phone syncs WITH. */}
          {desktop && desktopSyncsDevices() && (
            <SettingsToggleRow
              label="Sync with your phone"
              description="Let phones on your network keep their library in step with this computer."
              value={networkSync}
              onChange={setNetworkSync}
            />
          )}
          {desktop && networkSync && (
            <SettingsRow
              testID="settings.general.sync-address"
              label="Sync server for your phone"
              description={networkSyncAddress ? displaySyncAddress(networkSyncAddress) : 'Not connected to a network'}
              onPress={networkSyncAddress ? () => open(() => <PairPhoneSheet />) : undefined}
            />
          )}
          {/* The download policies gate the DEVICE engine — meaningless when a remote server owns
              the downloads (it paces itself), so they only appear while running on-device. They used
              to live on the Downloads page but cluttered the queue. */}
          {embeddedActive && (
            <SettingsToggleRow
              label="Download over Wi-Fi only"
              description="Hold downloads until you're on Wi-Fi."
              value={wifiOnly}
              onChange={(v) => {
                downloadPrefs$.wifiOnly.set(v);
                // Turning the gate off (or changing it) should resume held-back downloads right away.
                kickDownloads();
              }}
            />
          )}
          {embeddedActive && (
            <SettingsToggleRow
              label="Download in background"
              description="Continue in OS-granted windows after leaving the app."
              value={background}
              onChange={(v) => {
                downloadPrefs$.background.set(v);
                applyBackgroundDownloads(v);
              }}
            />
          )}
        </SettingsSection>
        <LibraryBackupSection />
      </ScrollView>
    </ThemedView>
  );
}

/** Headered, unlike the list above: these two are things to do, not settings to leave on. */
function LibraryBackupSection() {
  const [exporting, setExporting] = useState(false);

  const exportLibrary = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const backup = await exportLibraryBackup();
      const outcome = await saveBackupFile(backupFileName(backup.exportedAt), JSON.stringify(backup));
      if (outcome === 'saved') showToast('Library exported');
    } catch (err) {
      showToast(friendlyError(err, "Couldn't export your library."));
    } finally {
      setExporting(false);
    }
  };

  const restoreLibrary = async () => {
    let picked: ReturnType<typeof parseBackupFile>;
    try {
      const text = await pickBackupFile();
      if (text === null) return;
      picked = parseBackupFile(text);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't read that file.");
      return;
    }
    // A restore installs nothing, so what the restored library will lack is said here, while
    // backing out to install it first is still on offer.
    let missing: string | null;
    try {
      const [bridges, trackers] = await Promise.all([getBridges(), getTrackers()]);
      missing = describeMissing(
        picked.backup,
        missingFromBackup(picked.backup, {
          bridges: bridges.map((b) => b.id),
          trackers: trackers && trackers.map((t) => t.info.id),
        }),
      );
    } catch (err) {
      showToast(friendlyError(err, "Couldn't check which bridges are installed."));
      return;
    }
    const message =
      'Everything in it is added to your library, and anything that differs goes back to how the backup has it. Nothing is removed.';
    openConfirm({
      title: 'Restore this backup?',
      message: missing ? `${message}\n\n${missing}` : message,
      detail: describeBackup(picked.backup),
      confirmLabel: missing ? 'Restore anyway' : 'Restore',
      pendingLabel: 'Restoring…',
      tone: 'primary',
      errorFallback: "Couldn't restore this backup.",
      onConfirm: async () => {
        const result = await restoreLibraryBackup(picked.raw);
        bumpDataEpoch();
        void queryClient.invalidateQueries();
        showToast(describeRestore(result), { durationMs: 6000 });
      },
    });
  };

  return (
    <SettingsSection title="Library backup">
      <SettingsRow
        testID="settings.general.backup-export"
        label="Export library"
        description={exporting ? 'Exporting…' : 'Save your collections, history and reading progress to a file.'}
        onPress={() => void exportLibrary()}
      />
      <SettingsRow
        testID="settings.general.backup-restore"
        label="Restore from a backup"
        description="Add back what a backup file holds. Nothing is removed."
        onPress={() => void restoreLibrary()}
      />
    </SettingsSection>
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
    <View style={styles.confirmBody}>
      <OverlayHeading>Pair your phone</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        On the phone, turn on Sync library, open Sync server and scan this code.
      </ThemedText>
      {address ? (
        <View style={styles.qr}>
          <QrCode testID="settings.general.pair-phone.qr" value={address} size={200} />
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
        <View style={styles.confirmActions}>
          <Pressable testID="settings.general.pair-phone.new-key" onPress={rekey} style={styles.confirmBtn}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              New key
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Sheet/popover form for editing the remote-server override (see its trigger row above) — mirrors
 *  `AddRegistryForm`'s text-input-plus-save shape in `registries.tsx`. */
function RemoteServerForm({
  currentUrl,
  onSave,
  onScan,
}: {
  currentUrl: string;
  onSave: (url: string | null) => void;
  /** Open the pairing-code scanner; absent where there is no camera. */
  onScan?: () => void;
}) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [url, setUrl] = useState(currentUrl);

  return (
    <View style={styles.confirmBody}>
      <OverlayHeading>Remote server</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        The Comical server this app talks to when not running bridges on this device.
      </ThemedText>
      <TextInput
        ref={inputRef}
        testID="settings.general.remote-server.input"
        value={url}
        onChangeText={setUrl}
        onFocus={() => keyboardAvoiding.onFocus(inputRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        placeholder="http://localhost:3100"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <View style={styles.confirmActions}>
        {onScan && (
          <Pressable
            testID="settings.general.remote-server.scan"
            onPress={() => {
              closeTop();
              onScan();
            }}
            style={[styles.confirmBtn, styles.confirmLead]}>
            <ThemedText type="smallBold">Scan a code</ThemedText>
          </Pressable>
        )}
        <Pressable
          testID="settings.general.remote-server.reset"
          onPress={() => {
            onSave(null);
            closeTop();
          }}
          style={styles.confirmBtn}>
          <ThemedText type="smallBold">Reset to default</ThemedText>
        </Pressable>
        <Pressable
          testID="settings.general.remote-server.save"
          onPress={() => {
            onSave(url);
            closeTop();
          }}
          disabled={!url.trim()}
          style={styles.confirmBtn}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Save
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    // Spacing BETWEEN sections (SettingsSection no longer carries a top margin — see settings-row).
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  confirmBody: {
    gap: Spacing.three,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  confirmBtn: {
    paddingVertical: Spacing.two,
  },
  confirmLead: {
    marginRight: 'auto',
  },
  qr: {
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
