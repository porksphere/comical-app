import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BridgeMetaInfo, BridgePrefsToggles, GenreExclusionsControl, TagExclusionsControl } from '@/components/settings/bridge-extras';
import { SettingFieldEditor } from '@/components/settings/setting-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { SettingValue } from '@/data/api';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

export default function BridgeSettingsScreen() {
  const { bridgeId, source } = useLocalSearchParams<{ bridgeId?: string; source?: string }>();
  const ds = useDataSource();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['bridgeSettings', bridgeId],
    queryFn: ({ signal }) => ds.getBridgeSettings(bridgeId ?? '', signal),
    enabled: !!bridgeId,
  });

  // Only the keys the user has actually changed this session — a diff on top of
  // `data.values`, not a full copy of it. This is what makes "leave a secret
  // field blank" naturally mean "keep the existing value": an untouched secret
  // field never enters `edits`, so it's simply omitted from the PUT body below
  // (the server's settings store patches by key, so an omitted key is a no-op).
  const [edits, setEdits] = useState<Record<string, SettingValue>>({});
  const setField = (key: string, value: SettingValue) => setEdits((prev) => ({ ...prev, [key]: value }));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!bridgeId || !data) return;
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
      await ds.putBridgeSettings(bridgeId, body);
      setEdits({});
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['bridgeSettings', bridgeId] });
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const uninstall = async () => {
    if (!bridgeId) return;
    await ds.uninstallBridge(bridgeId);
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={data?.info.name ?? 'Bridge settings'} />
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
              {(error as Error).message || 'Failed to load bridge settings'}
            </ThemedText>
            <Pressable onPress={() => refetch()}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {!data.configured && (
              <ThemedView type="backgroundElement" style={[styles.banner, { borderColor: theme.hairline }]}>
                <ThemedText type="small">
                  This bridge still needs {data.missingRequired.length === 1 ? 'a required setting' : 'required settings'}{' '}
                  before it can serve content.
                </ThemedText>
              </ThemedView>
            )}

            <BridgeMetaInfo info={data.info} />

            {data.settings.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                This bridge has no configurable settings.
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

            {data.info.capabilities.includes('exclude-tags') && (
              <TagExclusionsControl
                bridgeId={bridgeId!}
                initialTags={data.excludedTags}
                initialLabels={data.excludedTagLabels}
              />
            )}
            {data.info.capabilities.includes('exclude-genres') && <GenreExclusionsControl bridgeId={bridgeId!} />}
            <BridgePrefsToggles bridgeId={bridgeId!} />

            {source === 'registry' && (
              <Pressable onPress={uninstall} style={styles.uninstallRow}>
                <ThemedText type="small" style={{ color: '#E5484D' }}>
                  Uninstall this bridge
                </ThemedText>
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
  banner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  uninstallRow: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
