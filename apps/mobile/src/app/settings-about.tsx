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
import * as Device from 'expo-device';
import { useEffect, useState } from 'react';
import { Platform, Share, StyleSheet } from 'react-native';

import { fields, type SettingsField, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { useApiBase } from '@/data/api';
import { getResolvedModeSync } from '@/data/embedded/preference';
import { IS_DEMO_MODE, useMockActive } from '@/data/source';
import { useAppUpdateAction, useAppUpdateCheck, useAppUpdateRecheck } from '@/data/use-app-update';
import { deviceLabel } from '@/lib/device-name';
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

export default function AboutScreen() {
  // Confirmation for the clipboard path, which is otherwise completely silent — no share sheet
  // appears, so without this the row looks broken. Clears itself, so it can't sit there claiming a
  // copy from several minutes ago.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const [apiBase] = useApiBase();
  const mockActive = useMockActive();
  const appUpdate = useAppUpdateCheck();
  const updateAction = useAppUpdateAction();
  const { checking, recheck } = useAppUpdateRecheck();
  const updateVersion = updateAction?.version ?? 'newer build';
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

  const info: [title: string, rows: InfoRow[]][] = [
    ['Build', build],
    ['Runtime', runtime],
    ['Data source', data],
  ];

  // Every visible row, in the order they're rendered, as one pasteable block.
  const report = info
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

  // Version is the only fact that leads anywhere: the notes belong to a version, so the version is
  // what you tap to read them. Every other row is a fact, selectable so a commit SHA or server URL
  // can be picked out by hand where Share isn't available (desktop web).
  const infoField = ([label, value]: InfoRow): SettingsField =>
    label === 'Version'
      ? { kind: 'link', testID: 'about.version', label, value, onPress: () => router.push('/settings-whats-new') }
      : { kind: 'value', label, value, selectable: true };

  const sections: SettingsFormSection[] = [
    // No blurb above the list: the section headings and row labels already say what every value
    // is, and a paragraph explaining a table of facts only pushed the facts down the screen.
    ...info.map(
      ([title, rows]): SettingsFormSection => ({
        title,
        fields: fields(
          ...rows.filter(([, value]) => value).map(infoField),
          title === 'Build' &&
            appUpdate.status !== 'unsupported' && {
              kind: 'action',
              testID: 'about.checkForUpdates',
              label: updateAction?.run ? (updateAction.step === 'restart' ? 'Restart to update' : 'Update') : 'Check for updates',
              description:
                updateAction?.step === 'restart'
                  ? `Version ${updateVersion} is ready — restart to install`
                  : updateAction?.step === 'downloading'
                    ? `Downloading version ${updateVersion}…`
                    : updateAction
                      ? `Version ${updateVersion} available`
                      : checking || appUpdate.status === 'checking'
                        ? 'Checking…'
                        : appUpdate.status === 'error'
                          ? "Couldn't check"
                          : 'Up to date',
              marked: !!updateAction,
              disabled: !!updateAction && !updateAction.run,
              onPress: updateAction ? updateAction.run ?? (() => {}) : recheck,
            },
        ),
      }),
    ),
    {
      fields: [
        {
          kind: 'action',
          testID: 'about.share',
          // Named for what actually happens on this platform — see `exportReport`.
          label: Platform.OS === 'web' ? 'Copy build info' : 'Share build info',
          detail: copied ? 'Copied' : undefined,
          onPress: () => void exportReport(),
        },
      ],
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <TopBar title="About" />
      <SettingsList sections={sections} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
