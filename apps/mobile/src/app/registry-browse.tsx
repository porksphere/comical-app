import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RetryBlock } from '@/components/retry-block';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { AvailableBridge, AvailableTracker } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';

export default function RegistryBrowseScreen() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  const ds = useDataSource();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const bridgesQuery = useQuery({
    queryKey: queryKeys.registryBridges(url ?? ''),
    queryFn: ({ signal }) => ds.browseRegistryBridges(url ?? '', signal),
    enabled: !!url,
  });
  const trackersQuery = useQuery({
    queryKey: queryKeys.registryTrackers(url ?? ''),
    queryFn: ({ signal }) => ds.browseRegistryTrackers(url ?? '', signal),
    enabled: !!url,
  });

  const invalidateBrowse = async () => {
    bumpDataEpoch();
    // Broad invalidate (not just this screen's own queries) — installing/updating a bridge or
    // tracker here also changes the Settings bridge list, the Browse bridge selector, and
    // Library/History/Activity's bridge map, all of which are react-query-backed too.
    await queryClient.invalidateQueries();
  };

  const loading = bridgesQuery.isLoading || trackersQuery.isLoading;
  const error = bridgesQuery.error || trackersQuery.error;

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Browse registry" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <ThemedText type="small" themeColor="textSecondary">
          {url}
        </ThemedText>

        {loading ? (
          <ActivityIndicator />
        ) : error ? (
          <RetryBlock
            message={(error as Error).message || 'Failed to browse registry'}
            onRetry={() => {
              bridgesQuery.refetch();
              trackersQuery.refetch();
            }}
          />
        ) : (
          <>
            <SettingsSection title="Bridges">
              {(bridgesQuery.data ?? []).length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No bridges in this registry.
                </ThemedText>
              ) : (
                bridgesQuery.data!.map((b) => (
                  <BridgeRow key={b.entry.id} bridge={b} url={url ?? ''} onDone={invalidateBrowse} />
                ))
              )}
            </SettingsSection>

            <SettingsSection title="Trackers">
              {(trackersQuery.data ?? []).length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No trackers in this registry.
                </ThemedText>
              ) : (
                trackersQuery.data!.map((t) => (
                  <TrackerRow key={t.entry.id} tracker={t} url={url ?? ''} onDone={invalidateBrowse} />
                ))
              )}
            </SettingsSection>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function BridgeRow({ bridge, url, onDone }: { bridge: AvailableBridge; url: string; onDone: () => Promise<void> }) {
  const ds = useDataSource();
  // `onDone` (a refetch) is folded into each mutationFn so `isPending` stays true through the
  // refresh, matching the old shared `busy`.
  const installMutation = useMutation({
    mutationFn: async () => {
      await ds.installRegistryBridge(url, bridge.entry.id);
      await onDone();
    },
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      await ds.updateBridge(bridge.entry.id);
      await onDone();
    },
  });
  const busy = installMutation.isPending || updateMutation.isPending;
  const error = installMutation.isError
    ? (installMutation.error as Error).message || 'Failed to install bridge'
    : updateMutation.isError
      ? (updateMutation.error as Error).message || 'Failed to update bridge'
      : null;
  const install = () => installMutation.mutate();
  const update = () => updateMutation.mutate();
  return (
    <View>
      <SettingsRow
        label={bridge.entry.name}
        description={bridge.entry.description ?? `v${bridge.entry.version}`}
        right={<InstallButton state={bridge} onInstall={install} onUpdate={update} busy={busy} />}
      />
      {error && (
        <ThemedText type="small" themeColor="danger" style={styles.rowError}>
          {error}
        </ThemedText>
      )}
    </View>
  );
}

function TrackerRow({ tracker, url, onDone }: { tracker: AvailableTracker; url: string; onDone: () => Promise<void> }) {
  const ds = useDataSource();
  const installMutation = useMutation({
    mutationFn: async () => {
      await ds.installRegistryTracker(url, tracker.entry.id);
      await onDone();
    },
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      await ds.updateTracker(tracker.entry.id);
      await onDone();
    },
  });
  const busy = installMutation.isPending || updateMutation.isPending;
  const error = installMutation.isError
    ? (installMutation.error as Error).message || 'Failed to install tracker'
    : updateMutation.isError
      ? (updateMutation.error as Error).message || 'Failed to update tracker'
      : null;
  const install = () => installMutation.mutate();
  const update = () => updateMutation.mutate();
  return (
    <View>
      <SettingsRow
        label={tracker.entry.name}
        description={tracker.entry.description ?? `v${tracker.entry.version}`}
        right={<InstallButton state={tracker} onInstall={install} onUpdate={update} busy={busy} />}
      />
      {error && (
        <ThemedText type="small" themeColor="danger" style={styles.rowError}>
          {error}
        </ThemedText>
      )}
    </View>
  );
}

function InstallButton({
  state,
  onInstall,
  onUpdate,
  busy,
}: {
  state: { installedVersion: string | null; updateAvailable: boolean };
  onInstall: () => void;
  onUpdate: () => void;
  busy: boolean;
}) {
  if (busy) return <ActivityIndicator size="small" />;
  if (state.installedVersion && state.updateAvailable) {
    return (
      <Pressable onPress={onUpdate} hitSlop={8}>
        <View style={styles.actionBtn}>
          <ThemedText type="smallBold">Update</ThemedText>
        </View>
      </Pressable>
    );
  }
  if (state.installedVersion) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Installed
      </ThemedText>
    );
  }
  return (
    <Pressable onPress={onInstall} hitSlop={8}>
      <View style={styles.actionBtn}>
        <ThemedText type="smallBold">Install</ThemedText>
      </View>
    </Pressable>
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
  actionBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  rowError: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
