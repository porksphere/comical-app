import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  BridgeMetaInfo,
  BridgePrefsToggles,
  ComicalHomeToggle,
  MaxContentRatingControl,
  TagExclusionsControl,
} from '@/components/settings/bridge-extras';
import { SettingFieldEditor } from '@/components/settings/setting-field';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { BridgeSettingsInfo, SettingDescriptor, SettingValue } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import {useLocalSearchParams, useRouter} from '@/lib/nav';

/** The PUT body for a settings save: every non-secret value (edited or existing, so the server gets a
 *  full set) plus only the secrets the user actually changed (an untouched secret is omitted, which
 *  the server's patch-by-key store reads as "keep the existing value"). */
function buildSettingsBody(
  settings: SettingDescriptor[],
  values: Record<string, SettingValue>,
  edits: Record<string, SettingValue>,
): Record<string, SettingValue> {
  const body: Record<string, SettingValue> = {};
  for (const d of settings) {
    const isSecret = d.type === 'string' && d.secret;
    if (isSecret) {
      if (d.key in edits) body[d.key] = edits[d.key];
      continue;
    }
    if (d.key in edits) body[d.key] = edits[d.key];
    else if (d.key in values) body[d.key] = values[d.key];
  }
  return body;
}

/** The login fields a favorites bridge still needs, named for the user, or null once any is set —
 *  the same "which secrets hold a value" rule the star button gates on (see favorites-status.ts). A
 *  required field is already announced by the banner above, so only the OPTIONAL-login case is
 *  spoken to here. */
function favoritesLoginPending(data: BridgeSettingsInfo): string | null {
  if (data.missingRequired.length > 0) return null;
  const secrets = data.settings.filter((d) => (d.type === 'string' && !!d.secret) || d.type === 'oauth-pin' || d.type === 'oauth-callback');
  if (secrets.length === 0 || secrets.some((d) => data.secretsSet.includes(d.key))) return null;
  return secrets.map((d) => d.label).join(' or ');
}

export default function BridgeSettingsScreen() {
  const { bridgeId, source, availableVersion } = useLocalSearchParams<{
    bridgeId?: string;
    source?: string;
    availableVersion?: string;
  }>();
  const ds = useDataSource();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.bridgeSettings(bridgeId ?? ''),
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

  // Auto-save on leave (no Save button): PUT any pending edits when the screen unmounts. A ref holds
  // the latest values so the once-only unmount cleanup reads what's current, not what was set at mount.
  const latest = useRef({ bridgeId, data, edits, ds, queryClient });
  useEffect(() => {
    latest.current = { bridgeId, data, edits, ds, queryClient };
  });
  useEffect(
    () => () => {
      const s = latest.current;
      if (!s.bridgeId || !s.data || Object.keys(s.edits).length === 0) return;
      const body = buildSettingsBody(s.data.settings, s.data.values, s.edits);
      void s.ds
        .putBridgeSettings(s.bridgeId, body)
        .then(() => s.queryClient.invalidateQueries({ queryKey: queryKeys.bridgeSettings(s.bridgeId!) }))
        .catch(() => {}); // best-effort; the screen is gone, and a bad value surfaces next time it's opened
    },
    [],
  );

  const uninstallMutation = useMutation({
    mutationFn: () => ds.uninstallBridge(bridgeId!),
    onSuccess: async () => {
      bumpDataEpoch();
      // Broad invalidate — the Settings bridge list, Browse bridge selector, and
      // Library/History/Activity's bridge map are all react-query-backed and need to drop this
      // bridge immediately, not just this screen's own queryKeys.bridgeSettings(bridgeId ?? '') query.
      await queryClient.invalidateQueries();
      router.back();
    },
  });
  const uninstalling = uninstallMutation.isPending;
  const uninstallError = uninstallMutation.isError
    ? (uninstallMutation.error as Error).message || 'Failed to uninstall bridge'
    : null;
  const uninstall = () => {
    if (bridgeId) uninstallMutation.mutate();
  };

  const updateMutation = useMutation({
    mutationFn: () => ds.updateBridge(bridgeId!),
    onSuccess: async () => {
      bumpDataEpoch();
      // Broad invalidate — same reasoning as uninstall() above.
      await queryClient.invalidateQueries();
    },
  });
  const updating = updateMutation.isPending;
  const updated = updateMutation.isSuccess;
  const updateError = updateMutation.isError ? (updateMutation.error as Error).message || 'Failed to update bridge' : null;
  const performUpdate = () => {
    if (bridgeId) updateMutation.mutate();
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title={data?.info.name ?? 'Bridge settings'} />
      <ScrollView
        contentContainerStyle={[styles.content, contentPadding]}>
        {isLoading ? (
          <ActivityIndicator />
        ) : error ? (
          <View style={styles.center}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {(error as Error).message || 'Failed to load bridge settings'}
            </ThemedText>
            <Pressable testID="settings.bridge.retry" onPress={() => refetch()}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {availableVersion && !updated && (
              <ThemedView type="backgroundElement" style={[styles.banner, styles.updateBanner, { borderColor: theme.hairline }]}>
                <ThemedText type="small" style={styles.updateBannerText}>
                  Update available — v{availableVersion}
                </ThemedText>
                <Pressable testID="settings.bridge.update" onPress={performUpdate} disabled={updating} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {updating ? 'Updating…' : 'Update'}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            )}
            {updateError && (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {updateError}
              </ThemedText>
            )}

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
              <SettingsSection title="Configuration">
                {data.settings.map((d) => (
                  <SettingFieldEditor
                    key={d.key}
                    descriptor={d}
                    value={d.key in edits ? edits[d.key] : data.values[d.key]}
                    onChange={(v) => setField(d.key, v)}
                  />
                ))}
              </SettingsSection>
            )}

            {/* Gated on the CAPABILITY alone, not on whether credentials are set: every favorites
                bridge declares its login as OPTIONAL settings, so a logged-out one still looks
                configured (see use-favorites-available.ts). The import screen's own error — the
                bridge's "favorites require a username + password" — is the better signal, and it
                names the fields sitting right above this row. */}
            {data.info.capabilities?.includes('favorites') && (
              <SettingsSection title="Favorites">
                {favoritesLoginPending(data) && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.favoritesNote}>
                    Favorites need an account — fill in {favoritesLoginPending(data)} above.
                  </ThemedText>
                )}
                <SettingsRow
                  testID="settings.bridge.import-favorites"
                  label="Import favorites into library"
                  description="Pick which of this account's favorites to add"
                  onPress={() =>
                    router.push({
                      pathname: '/favorites-import',
                      params: { bridgeId: bridgeId!, bridgeName: data.info.name },
                    })
                  }
                />
              </SettingsSection>
            )}

            {data.info.capabilities?.includes('exclude-tags') && (
              <TagExclusionsControl
                bridgeId={bridgeId!}
                initialTags={data.excludedTags}
                initialLabels={data.excludedTagLabels}
              />
            )}
            {data.info.capabilities?.includes('content-rating') && (
              <MaxContentRatingControl bridgeId={bridgeId!} initialRating={data.maxContentRating} />
            )}
            <BridgePrefsToggles bridgeId={bridgeId!} />
            <ComicalHomeToggle bridgeId={bridgeId!} />

            {source === 'registry' && (
              <>
                {uninstallError && (
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {uninstallError}
                  </ThemedText>
                )}
                <Pressable testID="settings.bridge.uninstall" onPress={uninstall} disabled={uninstalling} style={styles.uninstallRow}>
                  {uninstalling ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <ThemedText type="small" style={{ color: theme.danger }}>
                      Uninstall this bridge
                    </ThemedText>
                  )}
                </Pressable>
              </>
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
  favoritesNote: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
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
  banner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  updateBannerText: {
    flex: 1,
  },
  uninstallRow: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
