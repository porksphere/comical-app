import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useLocalSearchParams } from '@/lib/nav';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SettingFieldEditor, isAutoPersistedField } from '@/components/settings/setting-field';
import { SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { SettingValue } from '@/data/api';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';

export default function TrackerSettingsScreen() {
  const { trackerId } = useLocalSearchParams<{ trackerId?: string }>();
  const ds = useDataSource();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
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

  // PUT is a full replace, so a save must carry every field's current value, not just the changed
  // one: staged edits (plus any one-shot `extra`) win, else the last-loaded value — but secrets and
  // oauth tokens are never echoed back by the server, so they're only sent when actually (re)entered.
  const buildBody = (extra: Record<string, SettingValue> = {}): Record<string, SettingValue> => {
    const body: Record<string, SettingValue> = {};
    if (!data) return body;
    const source = { ...edits, ...extra };
    for (const d of data.settings) {
      const isSecret = (d.type === 'string' && d.secret) || d.type === 'oauth-pin' || d.type === 'oauth-callback';
      if (d.key in source) body[d.key] = source[d.key];
      else if (!isSecret && d.key in data.values) body[d.key] = data.values[d.key];
    }
    return body;
  };

  const save = () => {
    if (!trackerId || !data) return;
    saveMutation.mutate(buildBody());
  };

  // Persist a single field the instant it's captured — used by OAuth fields so signing in commits
  // straight away (no Save button). Drops the field from staged edits and refreshes both the
  // settings (secretsSet → "Connected") and the trackers list (`configured` → linkable in series).
  const commitField = async (key: string, value: SettingValue) => {
    if (!trackerId || !data) return;
    await ds.putTrackerSettings(trackerId, buildBody({ [key]: value }));
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.trackerSettings(trackerId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trackers() }),
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={data?.info.name ?? 'Tracker settings'} />
      <ScrollView
        contentContainerStyle={[styles.content, contentPadding]}>
        {isLoading ? (
          <ActivityIndicator />
        ) : error ? (
          <View style={styles.center}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {(error as Error).message || 'Failed to load tracker settings'}
            </ThemedText>
            <Pressable testID="settings.tracker.retry" onPress={() => refetch()}>
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
              // Untitled: the TopBar already names the tracker, and unlike a bridge (whose fields sit
              // below its metadata and update banner) these fields ARE the whole screen — so the
              // heading labelled nothing it wasn't already next to.
              <SettingsSection>
                {data.settings.map((d) => (
                  <SettingFieldEditor
                    key={d.key}
                    descriptor={d}
                    value={d.key in edits ? edits[d.key] : data.values[d.key]}
                    secretSet={data.secretsSet.includes(d.key)}
                    trackerId={trackerId}
                    onChange={(v) => setField(d.key, v)}
                    onCommit={(v) => commitField(d.key, v)}
                  />
                ))}

                {/* The Save button only exists for fields that stage their value (typed strings,
                    numbers, toggles, paste-style OAuth). When every field auto-persists on interaction
                    (e.g. a lone "Connect" OAuth row like AniList), signing in is the save — no button. */}
                {data.settings.some((d) => !isAutoPersistedField(d)) && (
                  <>
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
                    <Pressable testID="settings.tracker.save" onPress={save} disabled={saving}>
                      <ThemedView style={[styles.saveBtn, { backgroundColor: theme.accent }, saving && styles.saveBtnDisabled]}>
                        <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                          {saving ? 'Saving…' : 'Save'}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </>
                )}
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
    // Spacing BETWEEN sections (SettingsSection no longer carries a top margin — see settings-row).
    gap: Spacing.five,
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
