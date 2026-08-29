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
import { openBrowserAsync } from 'expo-web-browser';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { noteLines, type ReleaseNote } from '@/data/release-notes';
import { useAppUpdateCheck } from '@/data/use-app-update';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { APP_VERSION } from '@/lib/build-info';

function ReleaseNoteCard({ note }: { note: ReleaseNote }) {
  const theme = useTheme();
  const lines = noteLines(note.body);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedText type="smallBold">{note.version}</ThemedText>
        {note.date ? (
          <ThemedText type="small" themeColor="textSecondary">
            {note.date}
          </ThemedText>
        ) : null}
      </View>
      {lines.map((line, i) => (
        <View key={`${i}-${line}`} style={styles.line}>
          <ThemedText type="small" style={[styles.bullet, { color: theme.textSecondary }]}>
            •
          </ThemedText>
          <ThemedText type="small" style={styles.lineText}>
            {line}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

export default function WhatsNewScreen() {
  const update = useAppUpdateCheck();
  const contentPadding = useSettingsScrollPadding();
  const pending = update.pending ?? [];

  const handleUpdatePress = () => {
    if (update.downloadUrl) void openBrowserAsync(update.downloadUrl);
    // web-pages has no artifact to download — the "update" is whatever the server is already
    // serving, so the action is to reload onto it (mirrors the About row).
    else if (Platform.OS === 'web') window.location.reload();
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="What's new" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        {pending.length > 0 && (
          <SettingsSection title={pending.length > 1 ? 'Available now' : 'Available'}>
            {pending.map((note) => (
              <ReleaseNoteCard key={note.version} note={note} />
            ))}
            <SettingsRow
              testID="whatsNew.update"
              label={Platform.OS === 'web' ? 'Reload to update' : 'Download update'}
              onPress={handleUpdatePress}
            />
          </SettingsSection>
        )}

        {/* Untitled, and that's the point: you got here by tapping the version, so a heading
            restating "Installed" over its own notes is a label for something already named by the
            row that opened the screen. The pending block above keeps its heading because it names
            something you do NOT have. */}
        {update.running ? (
          <SettingsSection>
            <ReleaseNoteCard note={update.running} />
          </SettingsSection>
        ) : (
          <SettingsSection>
            <SettingsRow
              label={`Version ${APP_VERSION}`}
              // Three different reasons land here and none is an error worth a warning colour: a
              // build older than every version its channel still lists, a lane that publishes no
              // notes, or a check that hasn't come back yet.
              description={
                update.status === 'checking'
                  ? 'Checking…'
                  : update.status === 'unsupported'
                    ? 'This build has no update channel to read notes from.'
                    : "No release notes published for this build."
              }
            />
          </SettingsSection>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  // No horizontal padding: the section's content box is already at the screen gutter, and
  // `SettingsRow` nets to zero there (it escapes `SettingsGutter` then re-pads by it). Padding this
  // as well would indent the changelog text a gutter further in than every row it sits beside.
  card: { paddingVertical: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  line: { flexDirection: 'row', gap: Spacing.two },
  bullet: { lineHeight: 20 },
  lineText: { flex: 1, lineHeight: 20 },
});
