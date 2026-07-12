import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingFieldEditor } from '@/components/settings/setting-field';
import { SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { SettingValue } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

export default function TrackerSettingsScreen() {
  const { trackerId } = useLocalSearchParams<{ trackerId?: string }>();
  const ds = useDataSource();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const queryClient = useQueryClient();

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.trackerSettings(trackerId ?? ''),
    queryFn: ({ signal }) => ds.getTrackerSettings(trackerId ?? '', signal),
    enabled: !!trackerId,
  });

  // Same edits-diff pattern as bridge-settings.tsx — see the comment there.
  const [edits, setEdits] = useState<Record<string, SettingValue>>({});
  const setField = (key: string, value: SettingValue) => setEdits((prev) => ({ ...prev, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, SettingValue>) => ds.putTrackerSettings(trackerId!, body),
    onSuccess: async () => {
      setEdits({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.trackerSettings(trackerId ?? '') });
    },
  });
  const saving = saveMutation.isPending;
  const saved = saveMutation.isSuccess;
  const saveError = saveMutation.isError ? (saveMutation.error as Error).message || 'Failed to save settings' : null;

  const save = () => {
    if (!trackerId || !data) return;
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
    saveMutation.mutate(body);
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={data?.info.name ?? 'Tracker settings'} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // The TopBar is an absolute overlay, so the content pads past it (and scrolls under its frost).
          { paddingTop: topBarInset + BarContentGap, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
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
              <SettingsSection title="Configuration">
                {data.settings.map((d) => (
                  <SettingFieldEditor
                    key={d.key}
                    descriptor={d}
                    value={d.key in edits ? edits[d.key] : data.values[d.key]}
                    secretSet={data.secretsSet.includes(d.key)}
                    onChange={(v) => setField(d.key, v)}
                  />
                ))}

                {saveError && (
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {saveError}
                  </ThemedText>
                )}
                {saved && !saveError && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Saved.
                  </ThemedText>
                )}
                <Pressable onPress={save} disabled={saving}>
                  <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, saving && styles.saveBtnDisabled]}>
                    <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                      {saving ? 'Saving…' : 'Save'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </SettingsSection>
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
