/**
 * What's new — the changes in the update on offer, and in the build already installed.
 *
 * Both halves come from the SAME fetch the update check already makes (`useAppUpdateCheck`), which
 * is the point: every publishing lane now writes its notes into the artifact the checker reads —
 * `versions[].localizedDescription` in the iOS SideStore sources, `notes` in the Android/web
 * `version.json` — so there is nothing to fetch here and nothing that can disagree with the row on
 * About. See `.github/scripts/changelog-section.sh` (tagged lanes) and `rolling-changelog.sh`
 * (rolling ones) for where the text is minted.
 *
 * Only ios-release can list more than one pending version: its source carries every tag, so an
 * install that skipped three releases sees all three. The rolling channels keep one build, so their
 * "pending" is a single entry and their "installed" is present exactly when there's no update.
 *
 * The toast deliberately doesn't carry any of this — it says an update exists and points here. A
 * changelog is something you read when you choose to, not something to put over the screen.
 */
import { StyleSheet } from 'react-native';

import { fields, type SettingsField, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { noteLines, type ReleaseNote } from '@/data/release-notes';
import { type AppUpdateAction, useAppUpdateAction, useAppUpdateCheck } from '@/data/use-app-update';
import { APP_VERSION } from '@/lib/build-info';

/** A release's notes as a block in the card: its version and date over its points. */
function releaseNote(note: ReleaseNote): SettingsField {
  return { kind: 'note', testID: `whatsNew.note.${note.version}`, title: note.version, caption: note.date ?? undefined, lines: noteLines(note.body) };
}

const UPDATE_LABEL: Record<AppUpdateAction['step'], string> = {
  restart: 'Restart to update',
  downloading: 'Downloading update…',
  fetch: 'Download update',
  open: 'Download update',
  // web-pages has no artifact to download — the "update" is whatever the server is already serving.
  reload: 'Reload to update',
};

export default function WhatsNewScreen() {
  const update = useAppUpdateCheck();
  const pending = update.pending ?? [];
  const updateAction = useAppUpdateAction();
  const run = updateAction?.run;

  const sections: SettingsFormSection[] = [
    {
      title: pending.length > 1 ? 'Available now' : 'Available',
      fields: fields(
        ...pending.map(releaseNote),
        !!updateAction && !!run && { kind: 'action', testID: 'whatsNew.update', label: UPDATE_LABEL[updateAction.step], onPress: run },
      ),
    },
    // Untitled, and that's the point: you got here by tapping the version, so a heading restating
    // "Installed" over its own notes is a label for something already named by the row that
    // opened the screen. The pending block above keeps its heading because it names something you
    // do NOT have.
    {
      fields: [
        update.running
          ? releaseNote(update.running)
          : {
              kind: 'value',
              label: `Version ${APP_VERSION}`,
              // Three different reasons land here and none is an error worth a warning colour: a
              // build older than every version its channel still lists, a lane that publishes no
              // notes, or a check that hasn't come back yet.
              description:
                update.status === 'checking'
                  ? 'Checking…'
                  : update.status === 'unsupported'
                    ? 'This build has no update channel to read notes from.'
                    : 'No release notes published for this build.',
            },
      ],
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <TopBar title="What's new" />
      <SettingsList sections={sections} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
