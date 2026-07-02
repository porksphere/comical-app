import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingFieldEditor } from '@/components/settings/setting-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { SettingValue } from '@/data/api';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

export default function TrackerSettingsScreen() {
  const { trackerId } = useLocalSearchParams<{ trackerId?: string }>();
  const ds = useDataSource();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['trackerSettings', trackerId],
    queryFn: ({ signal }) => ds.getTrackerSettings(trackerId ?? '', signal),
    enabled: !!trackerId,
  });

  // Same edits-diff pattern as bridge-settings.tsx — see the comment there.
  const [edits, setEdits] = useState<Record<string, SettingValue>>({});
  const setField = (key: string, value: SettingValue) => setEdits((prev) => ({ ...prev, [key]: value }));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!trackerId || !data) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const body: Record<string, SettingValue> = {};
    for (const d of data.settings) {
      const isSecret = d.type === 'string' && d.secret;
      if (isSecret) {
        if (d.key in edits) body[d.key] = edits[d.key];
        continue;
      }
      if (d.key in edits) body[d.key] = edits[d.key];
      else if (d.key in data.values) body[d.key] = data.values[d.key];
    }
    try {
      await ds.putTrackerSettings(trackerId, body);
      setEdits({});
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['trackerSettings', trackerId] });
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={data?.info.name ?? 'Tracker settings'} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        {isLoading ? (
          <ActivityIndicator />
        ) : error ? (
          <View style={styles.center}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {(error as Error).message || 'Failed to load tracker settings'}
            </ThemedText>
            <Pressable onPress={() => refetch()}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {data.settings.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                This tracker has no configurable settings.
              </ThemedText>
            ) : (
              data.settings.map((d) => (
                <SettingFieldEditor
                  key={d.key}
                  descriptor={d}
                  value={d.key in edits ? edits[d.key] : data.values[d.key]}
                  secretSet={data.secretsSet.includes(d.key)}
                  onChange={(v) => setField(d.key, v)}
                />
              ))
            )}

            {saveError && (
              <ThemedText type="small" style={{ color: '#E5484D' }}>
                {saveError}
              </ThemedText>
            )}
            {saved && !saveError && (
              <ThemedText type="small" themeColor="textSecondary">
                Saved.
              </ThemedText>
            )}
            {data.settings.length > 0 && (
              <Pressable onPress={save} disabled={saving}>
                <ThemedView type="backgroundSelected" style={[styles.saveBtn, saving && styles.saveBtnDisabled]}>
                  <ThemedText type="smallBold">{saving ? 'Saving…' : 'Save'}</ThemedText>
                </ThemedView>
              </Pressable>
            )}
          </>
        ) : null}
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
  center: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  centerText: {
    textAlign: 'center',
  },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
});
