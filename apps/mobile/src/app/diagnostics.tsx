import { useEffect, useState } from 'react';
import { Share, StyleSheet } from 'react-native';

import { type SettingsField, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { clearDiagnostics, getDiagnostics, subscribeDiagnostics, type DiagnosticEntry } from '@/lib/diagnostics';
import { useRouter } from '@/lib/nav';

function formatEntry(e: DiagnosticEntry): string {
  const time = new Date(e.time).toLocaleTimeString();
  const lines = [`[${time}] ${e.category}: ${e.message}`];
  if (e.context) lines.push(`  ${e.context}`);
  if (e.url) lines.push(`  ${e.url}`);
  return lines.join('\n');
}

/** A logged failure as a block in the card: its category and time over the message and where. */
function entryNote(e: DiagnosticEntry): SettingsField {
  return {
    kind: 'note',
    testID: `diagnostics.entry.${e.id}`,
    title: e.category,
    caption: new Date(e.time).toLocaleTimeString(),
    text: [e.message, e.context, e.url].filter(Boolean).join('\n'),
    selectable: true,
  };
}

export default function DiagnosticsScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<DiagnosticEntry[]>(getDiagnostics());

  useEffect(() => subscribeDiagnostics(() => setEntries(getDiagnostics())), []);

  const shareLog = () => {
    if (entries.length === 0) return;
    Share.share({ message: entries.map(formatEntry).join('\n\n') });
  };

  const sections: SettingsFormSection[] = [
    {
      footer:
        'Records what the swipe recognizers actually did — whether they saw the touches, began, activated, and what state they saw — and, on the same timeline, what the reader asked for each page and whether an answer came back. Off unless you turn it on.',
      fields: [{ kind: 'link', testID: 'diagnostics.gesture-trace', label: 'Gesture trace', onPress: () => router.push('/gesture-trace') }],
    },
    {
      title: 'Failures',
      footer:
        'Failures that would otherwise be invisible — bridge scrapes, writes (favorites, settings), and asset loads (page images, thumbnails) — newest first. Nothing here is sent anywhere automatically; use Share to send it yourself.',
      fields: [
        { kind: 'action', testID: 'diagnostics.share', label: 'Share', disabled: entries.length === 0, onPress: shareLog },
        { kind: 'action', testID: 'diagnostics.clear', label: 'Clear', role: 'destructive', disabled: entries.length === 0, onPress: clearDiagnostics },
      ],
    },
    {
      fields: entries.length === 0 ? [{ kind: 'note', testID: 'diagnostics.empty', title: 'No failures logged yet.' }] : entries.map(entryNote),
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Diagnostics" />
      <SettingsList sections={sections} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
