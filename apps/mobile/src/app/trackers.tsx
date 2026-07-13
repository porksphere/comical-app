import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { CheckIcon, GripIcon, PlusIcon } from '@/components/icons/ui-icons';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { SettingsRow } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import type { TrackerSummary } from '@/data/api';
import { applyOrder, setTrackerOrder, useTrackerOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

const IS_WEB = Platform.OS === 'web';

/**
 * Unlike Bridges, these rows are NOT swipe-to-delete: `TrackerSummary` carries no `source` field
 * (see data/api.ts), so there's no way to tell a registry-installed tracker — which
 * `ds.uninstallTracker` could remove — from one built into the server, which it can't. Offering a
 * Delete that fails on half the list is worse than not offering it; trackers stay installed via
 * their registry until the summary grows a `source`.
 */
export default function TrackersScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const browseRegistry = useBrowseRegistry();
  // Web-only reorder mode (▲/▼). Native reorders in place via long-press drag.
  const [editing, setEditing] = useState(false);

  // `data === undefined` = still loading; `null` = this server has no tracker support (an expected
  // state, not an error).
  const { data: trackers, isError, error, refetch } = useQuery({
    queryKey: queryKeys.trackers(),
    queryFn: ({ signal }) => ds.getTrackers(signal),
  });

  // Apply the saved order. Trackers have no NSFW filter, so the whole list reorders directly.
  const order = useTrackerOrder();
  const ordered = Array.isArray(trackers) ? applyOrder(trackers, order, (t) => t.info.id) : trackers;
  const canReorder = Array.isArray(ordered) && ordered.length >= 2;

  const renderRow = (t: TrackerSummary) => (
    <SettingsRow
      key={t.info.id}
      label={t.info.name}
      description={t.configured ? undefined : 'Needs setup'}
      descriptionColor={t.configured ? undefined : theme.badgeWarn}
      onPress={() => router.push({ pathname: '/tracker-settings', params: { trackerId: t.info.id } })}
    />
  );

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Trackers"
        right={
          trackers !== null &&
          (editing ? (
            <TopBarButton icon={<CheckIcon color={theme.text} size={22} />} label="Done reordering" onPress={() => setEditing(false)} />
          ) : (
            <View style={styles.topActions}>
              {/* Reorder button only on web (native reorders in place — long-press a row). */}
              {IS_WEB && canReorder && (
                <TopBarButton icon={<GripIcon color={theme.text} size={22} />} label="Reorder trackers" onPress={() => setEditing(true)} />
              )}
              {browseRegistry && (
                <TopBarButton icon={<PlusIcon color={theme.text} size={22} />} label="Install a tracker" onPress={browseRegistry} />
              )}
            </View>
          ))
        }
      />
      {isError ? (
        <View style={[styles.stateHost, contentPadding]}>
          <RetryBlock message={friendlyError(error, 'Failed to load trackers. Try again.')} onRetry={() => refetch()} />
        </View>
      ) : ordered === undefined ? (
        <View style={[styles.stateHost, contentPadding]}>
          <ActivityIndicator />
        </View>
      ) : ordered === null ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            Trackers are not available on this server.
          </ThemedText>
        </View>
      ) : ordered.length === 0 ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No trackers installed. Trackers sync your reading progress to an external service — install one from a
            registry to get started.
          </ThemedText>
        </View>
      ) : (
        <ReorderableList
          data={ordered}
          keyOf={(t) => t.info.id}
          renderRow={renderRow}
          label={(t) => t.info.name}
          onReorder={(keys) => setTrackerOrder(keys)}
          editing={editing}
          refresh={() => refetch()}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stateHost: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.five,
  },
  emptyText: {
    textAlign: 'center',
  },
});
