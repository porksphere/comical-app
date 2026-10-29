import { useState } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { useOverlay } from '@/components/overlay/overlay';
import { DataLocationSheet } from '@/components/settings/data-location-sheet';
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
import { autoDownloadLibrary, describeBackfill, librarySize, setAutoNewChapters } from '@/data/downloads/auto';
import { kickDownloads } from '@/data/downloads/engine';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { isEmbeddedRuntimeAvailable, swapDataSourceMode, useEmbeddedEnabled } from '@/data/embedded';
import { errorToasts$, useErrorToasts } from '@/data/error-toasts';
import { queryClient } from '@/data/query-client';
import { requestOverlay$, useRequestOverlayEnabled } from '@/data/request-monitor';
import { useBrowseHoldAction, useBrowseHoldSound, type BrowseHoldAction } from '@/data/browse-hold-action';
import { useDataSource, useMockActive, useNsfwMode, type NsfwMode } from '@/data/source';
import { connectServer } from '@/data/switch-server';
import { setFeedTint, useFeedTint } from '@/hooks/use-feed-tint';
import { setLibraryMarker, useLibraryMarker } from '@/hooks/use-library-marker';
import { setKeepTabPanes, useKeepTabPanes } from '@/hooks/use-keep-tab-panes';
import { useHydrated } from '@/hooks/use-responsive';
import { useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { desktopDataDir, desktopShell, trayName, useOpenAtLogin, useRunInTray } from '@/lib/desktop-shell';
import { friendlyError } from '@/lib/friendly-error';
import { lightCards$, useLightCards } from '@/lib/perf-flags';
import { useSeriesPaneAvailable } from '@/lib/series-pane';

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
  { value: 'none', label: 'Nothing', description: 'The icon does nothing when held.' },
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
  const contentPadding = useSettingsScrollPadding(MaxContentWidth);
  const [nsfwMode, setNsfwMode] = useNsfwMode();
  const [holdAction, setHoldAction] = useBrowseHoldAction();
  const [holdSound, setHoldSound] = useBrowseHoldSound();
  const [themePref, setThemePref] = useThemePreference();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  const [apiBase] = useApiBase();
  const lightCards = useLightCards();
  const feedTint = useFeedTint();
  const libraryMarker = useLibraryMarker();
  const keepTabPanes = useKeepTabPanes();
  const panesAvailable = useSeriesPaneAvailable();
  const errorToasts = useErrorToasts();
  const requestOverlay = useRequestOverlayEnabled();
  const [runInTray, setRunInTray] = useRunInTray();
  const [openAtLogin, setOpenAtLogin] = useOpenAtLogin();
  // Gated on hydration: the static web render has no shell, so the row would otherwise appear only
  // after it and mismatch.
  const desktop = useHydrated() && !!desktopShell();
  const dataDir = desktop ? desktopDataDir() : undefined;
  const { wifiOnly, background, autoSeries, autoChapters, autoPages, autoNew } = useDownloadPrefs();
  const ds = useDataSource();
  const mock = useMockActive();
  const { openDialog } = useOverlay();
  // The on-device runtime is only offered where a native bridge engine exists (iOS/Android with the
  // native module built) — never on web, which always uses a remote server.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();
  // Whether the app is actually running embedded right now (not just the user's stored preference —
  // see getResolvedModeSync in embedded/preference.ts). The remote-server row is meaningless while
  // this is true, so it's hidden rather than just disabled.
  const embeddedActive = onDevice && embeddedAvailable;

  // The toggle only covers saves from here on, so turning it on asks about what's already saved.
  const toggleAutoSeries = (enabled: boolean) => {
    downloadPrefs$.autoSeries.set(enabled);
    if (!enabled || mock) return;
    void librarySize()
      .then((size) => {
        if (size.series === 0) return;
        openConfirm({
          title: 'Download your library too?',
          message: describeBackfill(size, 'already in your library'),
          confirmLabel: `Download ${size.series} series`,
          tone: 'primary',
          onConfirm: () => {
            void autoDownloadLibrary(ds, mock).then((n) =>
              showToast(n > 0 ? `Downloading ${n} series` : 'Nothing to download'),
            );
          },
        });
      })
      .catch(() => {});
  };

  const toggleOnDevice = (enabled: boolean) => {
    setOnDevice(enabled);
    swapDataSourceMode(enabled); // transport swap + the cache/downloads flushes (see apply-mode.ts)
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="General" />
      <ScrollView style={scrollbarInset(contentPadding.paddingTop)} contentContainerStyle={[styles.content, contentPadding]}>
        {/* Section titles name the GROUP, never a row in it: "APPEARANCE" over a row called
            Appearance said nothing the row didn't. */}
        <SettingsSection
          title="Display"
          footer="Lightweight cards drop cover animations for smoother scrolling. Tinted backgrounds colour the page behind each section on Browse. Mark saved series puts a bookmark on the cover of any series already in your library.">
          <SettingsSelectRow label="Appearance" value={themePref} options={THEME_OPTIONS} onChange={setThemePref} />
          <SettingsToggleRow label="Lightweight cards" value={lightCards} onChange={(v) => lightCards$.light.set(v)} />
          <SettingsToggleRow label="Tinted backgrounds" value={feedTint} onChange={setFeedTint} />
          <SettingsToggleRow label="Mark saved series" value={libraryMarker} onChange={setLibraryMarker} />
        </SettingsSection>
        {/* The hold row sits with NSFW because that is what it acts on, and its footer is the
            gesture's only documentation — nothing on Browse or Library says the icon is holdable. */}
        <SettingsSection
          title="Browsing"
          footer={`NSFW content decides whether NSFW-flagged bridges are visible. Holding the bridge icon at the top of Browse or Library runs the chosen action; Hold sound clicks along with its countdown.${
            Platform.OS === 'web'
              ? ' Keep pages open per tab leaves a series or search you opened beside the sidebar open on its tab — and on its bridge or collection — while you visit another.'
              : ''
          }`}>
          <SettingsSelectRow label="NSFW content" value={nsfwMode} options={NSFW_MODE_OPTIONS} onChange={setNsfwMode} />
          <SettingsSelectRow label="Hold bridge icon" value={holdAction} options={HOLD_ACTION_OPTIONS} onChange={setHoldAction} />
          <SettingsToggleRow label="Hold sound" value={holdSound} onChange={setHoldSound} disabled={holdAction === 'none'} />
          {/* Web only, like the panes themselves: a phone's series page covers the tab bar. Greyed
              out below the sidebar's width, where there are no panes to keep. */}
          {Platform.OS === 'web' && (
            <SettingsToggleRow
              label="Keep pages open per tab"
              value={keepTabPanes}
              onChange={setKeepTabPanes}
              disabled={!panesAvailable}
            />
          )}
        </SettingsSection>
        <SettingsSection
          title="Connection"
          footer={`${embeddedAvailable ? 'Running bridges on this device fetches and reads with no server. ' : ''}Request errors flash as a red toast with the error.`}>
          {embeddedAvailable && <SettingsToggleRow label="Run bridges on this device" value={onDevice} onChange={toggleOnDevice} />}
          {/* Which server runs the bridges. While they run on the device this is the sync hub
              instead, and lives on the Sync screen. */}
          {!embeddedActive && (
            <SettingsRow
              testID="settings.general.remote-server"
              label="Remote server"
              description={apiBase}
              onPress={() =>
                openDialog(
                  () => (
                    <RemoteServerForm
                      title="Remote server"
                      description="The Comical server this app talks to when not running bridges on this device."
                      currentUrl={apiBase}
                      onSave={connectServer}
                    />
                  ),
                  { accessibilityLabel: 'Remote server' },
                )
              }
            />
          )}
          <SettingsToggleRow label="Show request errors" value={errorToasts} onChange={(v) => errorToasts$.on.set(v)} />
          <SettingsToggleRow
            label="Show request activity"
            description="A small corner readout of requests in flight, how long each has waited, and recent timeouts or rate-limit holds."
            value={requestOverlay}
            onChange={(v) => requestOverlay$.on.set(v)}
          />
        </SettingsSection>
        {desktop && (
          <SettingsSection
            title="Desktop"
            footer={`Closing the window leaves Comical running in the ${trayName()}, so downloads carry on. ${
              !desktopShell()?.loginItems
                ? 'Open at login takes effect in an installed build.'
                : runInTray
                  ? `Open at login starts Comical in the ${trayName()} when you sign in.`
                  : 'Open at login starts Comical when you sign in.'
            }`}>
            <SettingsToggleRow label={`Keep running in the ${trayName()}`} value={runInTray} onChange={setRunInTray} />
            <SettingsToggleRow label="Open at login" value={openAtLogin} onChange={setOpenAtLogin} />
            {dataDir && (
              <SettingsRow
                testID="settings.general.data-location"
                label="Data location"
                description={dataDir.dir}
                onPress={() => openDialog(() => <DataLocationSheet current={dataDir} />, { accessibilityLabel: 'Data location' })}
              />
            )}
          </SettingsSection>
        )}
        {/* The download policies gate the DEVICE engine — meaningless when a remote server owns
            the downloads (it paces itself), so they only appear while running on-device. They used
            to live on the Downloads page but cluttered the queue. */}
        {embeddedActive && (
          <SettingsSection
            title="Downloads"
            footer="Held downloads wait for Wi-Fi. In the background they continue in the windows the system grants after you leave the app.">
            <SettingsToggleRow
              label="Download over Wi-Fi only"
              value={wifiOnly}
              onChange={(v) => {
                downloadPrefs$.wifiOnly.set(v);
                // Turning the gate off (or changing it) should resume held-back downloads right away.
                kickDownloads();
              }}
            />
            <SettingsToggleRow
              label="Download in background"
              value={background}
              onChange={(v) => {
                downloadPrefs$.background.set(v);
                applyBackgroundDownloads(v);
              }}
            />
          </SettingsSection>
        )}
        <SettingsSection
          title="Auto-download"
          footer="Saved series download every chapter of a series you add to your library; new chapters are downloaded as they're found. Saved chapters and pages download when you save one. Each bridge can opt out of any of these in its own settings.">
          <SettingsToggleRow label="Saved series" value={autoSeries} onChange={toggleAutoSeries} />
          <SettingsToggleRow label="New chapters" value={autoNew} onChange={setAutoNewChapters} />
          <SettingsToggleRow label="Saved chapters" value={autoChapters} onChange={(v) => downloadPrefs$.autoChapters.set(v)} />
          <SettingsToggleRow label="Saved pages" value={autoPages} onChange={(v) => downloadPrefs$.autoPages.set(v)} />
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
    <SettingsSection
      title="Library backup"
      footer="A backup is a file holding your collections, history and reading progress. Restoring adds back what the file holds and removes nothing.">
      <SettingsRow
        testID="settings.general.backup-export"
        label="Export library"
        {...(exporting ? { description: 'Exporting…' } : {})}
        onPress={() => void exportLibrary()}
      />
      <SettingsRow testID="settings.general.backup-restore" label="Restore from a backup" onPress={() => void restoreLibrary()} />
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
