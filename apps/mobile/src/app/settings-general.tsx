import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { useOverlay } from '@/components/overlay/overlay';
import { RemoteServerForm } from '@/components/settings/remote-server-form';
import { SettingsSelectRow, SettingsToggleRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
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
import { useHydrated } from '@/hooks/use-responsive';
import { useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { desktopShell, trayName, useOpenAtLogin, useRunInTray } from '@/lib/desktop-shell';
import { friendlyError } from '@/lib/friendly-error';
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

export default function GeneralSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const [nsfwMode, setNsfwMode] = useNsfwMode();
  const [holdAction, setHoldAction] = useBrowseHoldAction();
  const [themePref, setThemePref] = useThemePreference();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  const [apiBase] = useApiBase();
  const lightCards = useLightCards();
  const [runInTray, setRunInTray] = useRunInTray();
  const [openAtLogin, setOpenAtLogin] = useOpenAtLogin();
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
          {/* Which server runs the bridges. While they run on the device this is the sync hub
              instead, and lives on the Sync screen. */}
          {!embeddedActive && (
            <SettingsRow
              testID="settings.general.remote-server"
              label="Remote server"
              description={apiBase}
              onPress={() =>
                open(() => (
                  <RemoteServerForm
                    title="Remote server"
                    description="The Comical server this app talks to when not running bridges on this device."
                    currentUrl={apiBase}
                    onSave={switchServer}
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
});
