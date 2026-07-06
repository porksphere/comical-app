import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clearDiagnostics, getDiagnostics, subscribeDiagnostics, type DiagnosticEntry } from '@/lib/diagnostics';

function formatEntry(e: DiagnosticEntry): string {
  const time = new Date(e.time).toLocaleTimeString();
  const lines = [`[${time}] ${e.category}: ${e.message}`];
  if (e.context) lines.push(`  ${e.context}`);
  if (e.url) lines.push(`  ${e.url}`);
  return lines.join('\n');
}

// TEMPORARY, for the tabBarMinimizeBehavior investigation: reads the diagnostic log the patched
// react-native-screens (patches/react-native-screens+4.25.2.patch) writes on-device, with no
// debugger attached. `readTabBarDebugLog`/`clearTabBarDebugLog` only exist on the iOS native
// module — undefined (not a crash) anywhere else, which `TabBarDebugSection` checks for before
// rendering. Safe to delete this, `TabBarDebugSection`, and the native patch's logging once the
// investigation is done.
const comicalRuntimeDebug = requireOptionalNativeModule<{
  readTabBarDebugLog?: () => string[];
  clearTabBarDebugLog?: () => void;
}>('ComicalRuntime');

function TabBarDebugSection({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const [lines, setLines] = useState<string[]>([]);

  if (Platform.OS !== 'ios' || typeof comicalRuntimeDebug?.readTabBarDebugLog !== 'function') {
    return null;
  }

  const refresh = () => setLines(comicalRuntimeDebug.readTabBarDebugLog!());
  const clear = () => {
    comicalRuntimeDebug.clearTabBarDebugLog?.();
    setLines([]);
  };
  const share = () => {
    if (lines.length === 0) return;
    Share.share({ message: lines.join('\n') });
  };

  return (
    <View style={styles.debugSection}>
      <ThemedText type="smallBold">Tab bar debug log (temporary)</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Reproduce the scroll-collapse/expand issue, then Refresh and Share this.
      </ThemedText>
      <View style={styles.actions}>
        <Pressable onPress={refresh} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
          <ThemedText type="smallBold">Refresh</ThemedText>
        </Pressable>
        <Pressable onPress={share} disabled={lines.length === 0} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
          <ThemedText type="smallBold" style={lines.length === 0 && { color: theme.textSecondary }}>
            Share
          </ThemedText>
        </Pressable>
        <Pressable onPress={clear} disabled={lines.length === 0} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
          <ThemedText type="smallBold" style={lines.length === 0 ? { color: theme.textSecondary } : { color: theme.danger }}>
            Clear
          </ThemedText>
        </Pressable>
      </View>
      {lines.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No entries yet — tap Refresh after reproducing the issue.
        </ThemedText>
      ) : (
        <ThemedView type="backgroundElement" style={[styles.entry, { borderColor: theme.hairline }]}>
          {lines.map((line, i) => (
            <ThemedText key={i} type="small" selectable>
              {line}
            </ThemedText>
          ))}
        </ThemedView>
      )}
    </View>
  );
}

export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
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
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <TabBarDebugSection theme={theme} />

        <ThemedText type="small" themeColor="textSecondary">
          Asset load failures (page images, thumbnails) that would otherwise fail silently — newest
          first. Nothing here is sent anywhere automatically; use Share to send it yourself.
        </ThemedText>

        <View style={styles.actions}>
          <Pressable onPress={shareLog} disabled={entries.length === 0} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
            <ThemedText type="smallBold" style={entries.length === 0 && { color: theme.textSecondary }}>
              Share
            </ThemedText>
          </Pressable>
          <Pressable onPress={clearDiagnostics} disabled={entries.length === 0} style={[styles.actionBtn, { borderColor: theme.hairline }]}>
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
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  debugSection: {
    gap: Spacing.two,
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
