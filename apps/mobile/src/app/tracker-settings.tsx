import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { RetryBlock } from '@/components/retry-block';
import { isAutoPersistedField, useDescriptorFields } from '@/components/settings/setting-field';
import { fields, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import type { SettingValue, TrackerSettingsInfo } from '@/data/api';
import { isSecretSetting } from '@comical/contract';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { usePackageUpdate, useUpdatingIds } from '@/data/use-package-update';
import { useRecheckRegistryUpdates, useTrackerUpdateMap } from '@/data/use-settings-badge';
import { useLocalSearchParams, useRouter } from '@/lib/nav';

/** The sign-in field(s) still empty, by label — the import needs an account before it can list anything. */
function signInPending(data: TrackerSettingsInfo): string | null {
  const secrets = data.settings.filter(isSecretSetting);
  if (secrets.length === 0 || secrets.some((d) => data.secretsSet.includes(d.key))) return null;
  return secrets.map((d) => d.label).join(' or ');
}

export default function TrackerSettingsScreen() {
  const { trackerId } = useLocalSearchParams<{ trackerId?: string }>();
  const router = useRouter();
  const ds = useDataSource();
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
      if (d.key in source) body[d.key] = source[d.key];
      else if (!isSecretSetting(d) && d.key in data.values) body[d.key] = data.values[d.key];
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

  const { fieldsFor, extras } = useDescriptorFields({
    valueOf: (key) => (key in edits ? edits[key] : data?.values[key]),
    secretSet: (key) => !!data?.secretsSet.includes(key),
    trackerId,
    onChange: setField,
    onCommit: commitField,
  });

  const updateMap = useTrackerUpdateMap();
  const availableVersion = trackerId ? updateMap.get(trackerId) : undefined;
  const updateMutation = usePackageUpdate('tracker');
  const updatingIds = useUpdatingIds('tracker');
  const updating = !!trackerId && updatingIds.has(trackerId);
  const updateError = updateMutation.isError ? (updateMutation.error as Error).message || 'Failed to update tracker' : null;
  const performUpdate = () => {
    if (trackerId) updateMutation.mutate(trackerId);
  };

  const { recheck } = useRecheckRegistryUpdates();
  const refresh = async () => {
    const [updates] = await Promise.all([recheck(), refetch()]);
    if (trackerId && !updates.trackers.some((u) => u.id === trackerId)) showToast(`${data?.info.name ?? 'Tracker'} is up to date`);
  };

  const sections: SettingsFormSection[] = isLoading
    ? [{ fields: [{ kind: 'custom', testID: 'settings.tracker.loading', render: () => <ActivityIndicator /> }] }]
    : error
      ? [
          {
            fields: [
              {
                kind: 'custom',
                testID: 'settings.tracker.retry',
                render: () => <RetryBlock message={(error as Error).message || 'Failed to load tracker settings'} onRetry={() => refetch()} />,
              },
            ],
          },
        ]
      : data
        ? [
            {
              fields: fields(
                (!!availableVersion || updating) && {
                  kind: 'action',
                  testID: 'settings.tracker.update',
                  label: updating ? (availableVersion ? `Updating to v${availableVersion}…` : 'Updating…') : `Update to v${availableVersion}`,
                  description: updateError ?? undefined,
                  tone: updateError ? 'danger' : undefined,
                  busy: updating,
                  disabled: updating,
                  onPress: performUpdate,
                },
              ),
            },
            // Untitled: the bar already names the tracker, and these fields ARE the whole screen.
            {
              fields:
                data.settings.length === 0
                  ? [{ kind: 'note', testID: 'settings.tracker.no-settings', title: 'This tracker has no configurable settings.' }]
                  : fields(
                      ...data.settings.flatMap(fieldsFor),
                      // The Save button only exists for fields that stage their value (typed strings,
                      // numbers, toggles, paste-style OAuth). When every field auto-persists on
                      // interaction (a lone "Connect" OAuth row like AniList), signing in is the save.
                      data.settings.some((d) => !isAutoPersistedField(d)) && {
                        kind: 'action',
                        testID: 'settings.tracker.save',
                        label: 'Save',
                        description: saveError ?? (saved ? 'Saved.' : undefined),
                        tone: saveError ? 'danger' : undefined,
                        detail: saving ? 'Saving…' : undefined,
                        busy: saving,
                        disabled: saving,
                        onPress: save,
                      },
                    ),
            },
            {
              title: 'Library',
              footer: signInPending(data) ? `Importing needs an account — ${signInPending(data)} above.` : undefined,
              fields: fields(
                data.info.capabilities.includes('library-sync') && {
                  kind: 'link',
                  testID: 'settings.tracker.import',
                  label: 'Import list into library',
                  description: "Link what's already here, add the rest",
                  onPress: () =>
                    router.push({
                      pathname: '/tracker-import',
                      params: { trackerId: trackerId!, trackerName: data.info.name },
                    }),
                },
              ),
            },
          ]
        : [];

  return (
    <ThemedView style={styles.container}>
      <TopBar title={data?.info.name ?? 'Tracker settings'} />
      <SettingsList sections={sections} refresh={refresh} />
      {extras}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
