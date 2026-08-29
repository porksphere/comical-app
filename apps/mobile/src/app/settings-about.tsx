/**
 * About — which build of Comical this is, and what it's running on.
 *
 * Exists for one job: making a bug report answerable. "It broke on my phone" is unactionable
 * without the version, the CI lane that produced the binary, and whether bridges were running
 * on-device or against a server — none of which were visible anywhere in the app before this
 * screen. Every row is read-only; the Share action serialises the same rows, in the same order, so
 * what gets pasted into an issue can't drift from what the screen shows.
 *
 * The build-time half (version, channel, commit) lives in `lib/build-info.ts`; the device/OS half is
 * probed here so `expo-device` stays off the app's startup path (see that module's header).
 */
import { CONTRACT_VERSION } from '@comical/contract';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { openBrowserAsync } from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet } from 'react-native';

import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { UpdateDot } from '@/components/tab-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useApiBase } from '@/data/api';
import { getResolvedModeSync } from '@/data/embedded/preference';
import { IS_DEMO_MODE, useMockActive } from '@/data/source';
import { useAppUpdateCheck } from '@/data/use-app-update';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { router } from '@/lib/nav';
import {
  APP_VERSION,
  BUILD_COMMIT,
  BUNDLE_HOST,
  EXPO_SDK_VERSION,
  JS_ENGINE,
  buildSummary,
  buildTimeLabel,
} from '@/lib/build-info';

/** A label/value pair. An empty value means "not knowable in this build" — those rows are dropped
 *  rather than rendered as a blank or a lying "unknown" (no commit outside CI, no device name on
 *  web). */
type InfoRow = [label: string, value: string];

/** Where the running JS came from. Empty on web — "served by the web server you're looking at" is
 *  not news, and the row would just repeat what Platform and JS engine already say. */
const BUNDLE_HOST_LABEL: Record<typeof BUNDLE_HOST, string> = {
  metro: 'Metro dev server',
  embedded: 'Embedded in app',
  web: '',
};

/** OS name + version, e.g. "iOS 26.1", "Android 16", "Windows 10" (expo-device parses the UA on
 *  web). Falls back to react-native's `Platform` when the device probe comes back empty. */
function osLabel(): string {
  const name = Device.osName || (Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web');
  const version = Device.osVersion || String(Platform.Version ?? '');
  return version ? `${name} ${version}` : name;
}

/** The device this is running on — its user-assigned name where the OS exposes one, else the model.
 *  Empty on web, where neither is available (`Device.deviceName` is hard-null there). */
function deviceLabel(): string {
  return Constants.deviceName || Device.modelName || '';
}

export default function AboutScreen() {
  const contentPadding = useSettingsScrollPadding();
  // Confirmation for the clipboard path, which is otherwise completely silent — no share sheet
  // appears, so without this the row looks broken. Clears itself, so it can't sit there claiming a
  // copy from several minutes ago.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const theme = useTheme();
  const [apiBase] = useApiBase();
  const mockActive = useMockActive();
  const appUpdate = useAppUpdateCheck();
  const handleUpdatePress = () => {
    if (Platform.OS === 'web') {
      window.location.reload();
      return;
    }
    if (appUpdate.downloadUrl) void openBrowserAsync(appUpdate.downloadUrl);
  };
  // The mode actually in force right now, not the stored preference — the toggle only takes effect
  // where the native runtime exists (see embedded/preference.ts).
  const embedded = getResolvedModeSync() === 'embedded';

  const build: InfoRow[] = [
    ['Version', APP_VERSION],
    ['Build', buildSummary()],
    ['Commit', BUILD_COMMIT],
    ['Built', buildTimeLabel()],
    ['JS bundle', BUNDLE_HOST_LABEL[BUNDLE_HOST]],
  ];

  const runtime: InfoRow[] = [
    ['Platform', osLabel()],
    ['Device', deviceLabel()],
    ['JS engine', JS_ENGINE],
    ['Expo SDK', EXPO_SDK_VERSION],
  ];

  const data: InfoRow[] = [
    // Where bridges actually run. On-device names the engine the native module evaluates bundles in
    // (see modules/comical-runtime) — the one detail that explains an engine-specific bridge bug.
    ['Bridges', embedded ? `On this device (${Platform.OS === 'ios' ? 'JavaScriptCore' : 'QuickJS'})` : 'Remote server'],
    // Only meaningful in remote mode; embedded resolves every request in-process.
    ['Server', embedded ? '' : apiBase],
    ['Bridge contract', CONTRACT_VERSION],
    // A demo/preview bundle serves mock data with no backend at all; the __DEV__ toggle does the
    // same on demand. Either one makes every other data row a fiction, so say so.
    ['Data', mockActive ? (IS_DEMO_MODE ? 'Mock (demo build)' : 'Mock (dev toggle)') : ''],
  ];

  const sections: [title: string, rows: InfoRow[]][] = [
    ['Build', build],
    ['Runtime', runtime],
    ['Data source', data],
  ];

  // Every visible row, in the order they're rendered, as one pasteable block.
  const report = sections
    .flatMap(([, rows]) => rows)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');

  const exportReport = async () => {
    // Web goes to the clipboard first: `Share` there is react-native-web's wrapper around
    // `navigator.share`, which desktop browsers mostly don't implement — it rejects, and the row
    // would silently do nothing. Native has a real share sheet, so it uses that and needs no
    // fallback (Clipboard would be another native dep).
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(report);
        setCopied(true);
        return;
      } catch {
        // Clipboard blocked (an insecure origin, or permission denied) — try the share sheet a
        // mobile browser may still have.
      }
    }
    await Share.share({ message: report }).catch(() => {});
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="About" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        {/* No blurb above the list: the section headings and row labels already say what every value
            is, and a paragraph explaining a table of facts only pushed the facts down the screen. */}
        {sections.map(([title, rows]) => (
          <SettingsSection key={title} title={title}>
            {rows
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <SettingsRow key={label} label={label} right={<InfoValue value={value} />} />
              ))}
            {title === 'Build' && appUpdate.status !== 'unsupported' && (
              <SettingsRow
                key="check-for-updates"
                testID="about.checkForUpdates"
                label="Check for updates"
                description={
                  appUpdate.status === 'update-available'
                    ? `Version ${appUpdate.latestVersionLabel ?? 'newer build'} available`
                    : appUpdate.status === 'checking'
                      ? 'Checking…'
                      : appUpdate.status === 'error'
                        ? "Couldn't check"
                        : 'Up to date'
                }
                leading={appUpdate.status === 'update-available' ? <UpdateDot /> : undefined}
                right={
                  appUpdate.status === 'update-available' ? (
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      Update
                    </ThemedText>
                  ) : undefined
                }
                onPress={appUpdate.status === 'update-available' ? handleUpdatePress : undefined}
              />
            )}
            {/* Alongside the row above, not folded into it: that one ACTS (it hands you the
                download), this one READS. Shown when up to date too — "what did the version I'm on
                bring" is the half of this that has no other home.

                Unlike "Check for updates" it is NOT gated on a supported channel. There is nothing
                to check on a dev build, but there is something to say, and the screen says it; the
                alternative is a feature that no e2e run and no developer ever sees. */}
            {title === 'Build' && (
              <SettingsRow
                key="whats-new"
                testID="about.whatsNew"
                label="What's new"
                description={
                  appUpdate.status === 'update-available'
                    ? 'Changes in the update, and in this build'
                    : 'Changes in this build'
                }
                onPress={() => router.push('/settings-whats-new')}
              />
            )}
          </SettingsSection>
        ))}

        <SettingsSection>
          <SettingsRow
            testID="about.share"
            // Named for what actually happens on this platform — see `exportReport`.
            label={Platform.OS === 'web' ? 'Copy build info' : 'Share build info'}
            // Always occupied, even when empty: `right` is what suppresses `SettingsRow`'s trailing
            // chevron, which would promise a screen this row doesn't push.
            right={
              <ThemedText type="small" themeColor="textSecondary">
                {copied ? 'Copied' : ''}
              </ThemedText>
            }
            onPress={exportReport}
          />
        </SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

/** A row's value. Selectable so a commit SHA or server URL can be picked out by hand where Share
 *  isn't available (desktop web), and clamped to one line so no row outgrows `SettingsRowHeight` —
 *  it shrinks against the label rather than pushing it off. */
function InfoValue({ value }: { value: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} selectable style={styles.value}>
      {value}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.five,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
