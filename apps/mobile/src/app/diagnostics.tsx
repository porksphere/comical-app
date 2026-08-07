import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { clearDiagnostics, getDiagnostics, subscribeDiagnostics, type DiagnosticEntry } from '@/lib/diagnostics';
import { useRouter } from '@/lib/nav';

function formatEntry(e: DiagnosticEntry): string {
  const time = new Date(e.time).toLocaleTimeString();
  const lines = [`[${time}] ${e.category}: ${e.message}`];
  if (e.context) lines.push(`  ${e.context}`);
  if (e.url) lines.push(`  ${e.url}`);
  return lines.join('\n');
}

export default function DiagnosticsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const theme = useTheme();
  const router = useRouter();
  const [entries, setEntries] = useState<DiagnosticEntry[]>(getDiagnostics());

  useEffect(() => subscribeDiagnostics(() => setEntries(getDiagnostics())), []);

  const shareLog = () => {
    if (entries.length === 0) return;
    Share.share({ message: entries.map(formatEntry).join('\n\n') });
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Diagnostics" />
      <ScrollView
        contentContainerStyle={[styles.content, contentPadding]}>
        <ThemedText type="small" themeColor="textSecondary">
          Failures that would otherwise be invisible — bridge scrapes, writes (favorites, settings),
          and asset loads (page images, thumbnails) — newest first. Nothing here is sent anywhere
          automatically; use Share to send it yourself.
        </ThemedText>

        <Pressable
          testID="diagnostics.gesture-trace"
          onPress={() => router.push('/gesture-trace')}
          style={[styles.entry, { borderColor: theme.hairline }]}>
          <ThemedText type="smallBold">Gesture trace</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Records what the swipe recognizers actually did — whether they saw the touches, began,
            activated, and what state they saw. Off unless you turn it on.
          </ThemedText>
        </Pressable>

        <View style={styles.actions}>
          <Pressable testID="diagnostics.share" onPress={shareLog} disabled={entries.length === 0} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
            <ThemedText type="smallBold" style={entries.length === 0 && { color: theme.textSecondary }}>
              Share
            </ThemedText>
          </Pressable>
          <Pressable testID="diagnostics.clear" onPress={clearDiagnostics} disabled={entries.length === 0} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
            <ThemedText type="smallBold" style={entries.length === 0 ? { color: theme.textSecondary } : { color: theme.danger }}>
              Clear
            </ThemedText>
          </Pressable>
        </View>

        {entries.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No failures logged yet.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {entries.map((e) => (
              <ThemedView key={e.id} type="backgroundElement" style={[styles.entry, { borderColor: theme.hairline }]}>
                <View style={styles.entryHead}>
                  <ThemedText type="smallBold">{e.category}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(e.time).toLocaleTimeString()}
                  </ThemedText>
                </View>
                <ThemedText type="small" selectable>
                  {e.message}
                </ThemedText>
                {e.context && (
                  <ThemedText type="small" themeColor="textSecondary" selectable>
                    {e.context}
                  </ThemedText>
                )}
                {e.url && (
                  <ThemedText type="small" themeColor="textSecondary" selectable>
                    {e.url}
                  </ThemedText>
                )}
              </ThemedView>
            ))}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  actionBtn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  entry: {
    gap: Spacing.half,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  entryHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
