import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { ArrowUpIcon, CheckIcon, GripIcon, PlusIcon, TrashIcon } from '@/components/icons/ui-icons';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { SettingsRow } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import type { SwipeRowAction } from '@/components/settings/swipeable-row';
import { UpdateDot } from '@/components/tab-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import type { TrackerSummary } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyOrder, setTrackerOrder, useTrackerOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTrackerUpdateMap } from '@/data/use-settings-badge';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

const IS_WEB = Platform.OS === 'web';

/**
 * Mirrors the Bridges screen: a registry-installed tracker (`source === 'registry'`) is a
 * swipe-to-uninstall row (plus a swipe-Update when a newer version is available), while a
 * server-built (`local`) tracker — which can't be removed — stays a plain row. The `source` field
 * on `TrackerSummary` is what lets us tell them apart; before it existed, every tracker rendered as
 * a plain, non-removable row.
 */
export default function TrackersScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const contentPadding = useSettingsScrollPadding();
  const browseRegistry = useBrowseRegistry();
  const queryClient = useQueryClient();
  // Live registry update check (id → newer version) — the authoritative signal for a row's update
  // dot / swipe-Update, so a pending update shows even before the summary annotation catches up.
  const updateMap = useTrackerUpdateMap();
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

  // Uninstall a single registry tracker (the row's swipe action). Broad-invalidate afterwards so the
  // Trackers list, the Settings/tab pips, and any per-series tracker link UI all drop it at once.
  const confirmUninstallOne = (t: TrackerSummary) =>
    openConfirm({
      title: `Uninstall ${t.info.name}?`,
      message: 'Its settings are removed and it stops syncing your reading progress until you install it again.',
      confirmLabel: 'Uninstall Tracker',
      pendingLabel: 'Uninstalling…',
      errorFallback: 'Failed to uninstall tracker',
      onConfirm: async () => {
        await ds.uninstallTracker(t.info.id);
        bumpDataEpoch();
        await queryClient.invalidateQueries();
      },
    });

  // Update a single tracker in place (the row's swipe "Update" action), then broad-invalidate so its
  // "Update available" state and the Settings/tab pips clear at once.
  const updateOne = async (t: TrackerSummary) => {
    try {
      await ds.updateTracker(t.info.id);
      bumpDataEpoch();
      await queryClient.invalidateQueries();
      showToast(`${t.info.name} updated`);
    } catch (e) {
      showToast(friendlyError(e, 'Failed to update tracker'));
    }
  };

  const renderRow = (t: TrackerSummary) => {
    const availableVersion = updateMap.get(t.info.id);
    const hasUpdate = !!availableVersion;
    const status = hasUpdate
      ? { text: `Update available — v${availableVersion}`, color: theme.badgeInfo }
      : t.configured
        ? undefined
        : { text: 'Needs setup', color: theme.badgeWarn };
    const openTracker = () => router.push({ pathname: '/tracker-settings', params: { trackerId: t.info.id } });

    // A server-built (local) tracker can't be uninstalled — plain, non-swipeable row.
    if (t.source !== 'registry') {
      return (
        <SettingsRow
          key={t.info.id}
          label={t.info.name}
          description={status?.text}
          descriptionColor={status?.color}
          onPress={openTracker}
          testID={testId('trackers.row', t.info.id)}
        />
      );
    }
    // "Update" (accent) sits left of the destructive "Uninstall" (edge slot). Update only when one's
    // available — the direct way to pull a new tracker version from the list.
    const rowActions: SwipeRowAction[] = [
      ...(hasUpdate ? [{ key: 'update', label: 'Update', icon: ArrowUpIcon, onPress: () => void updateOne(t) }] : []),
      { key: 'uninstall', label: 'Uninstall', icon: TrashIcon, destructive: true, onPress: () => confirmUninstallOne(t) },
    ];
    return (
      <SwipeableSettingsRow
        key={t.info.id}
        label={t.info.name}
        description={status?.text}
        descriptionColor={status?.color}
        right={hasUpdate ? <UpdateDot /> : undefined}
        onPress={openTracker}
        actions={rowActions}
        testID={testId('trackers.row', t.info.id)}
      />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Trackers"
        right={
          trackers !== null &&
          (editing ? (
            <TopBarButton testID="trackers.done" icon={<CheckIcon color={theme.text} size={22} />} label="Done reordering" onPress={() => setEditing(false)} />
          ) : (
            <View style={styles.topActions}>
              {/* Reorder button only on web (native reorders in place — long-press a row). */}
              {IS_WEB && canReorder && (
                <TopBarButton testID="trackers.reorder" icon={<GripIcon color={theme.text} size={22} />} label="Reorder trackers" onPress={() => setEditing(true)} />
              )}
              {browseRegistry && (
                <TopBarButton testID="trackers.install" icon={<PlusIcon color={theme.text} size={22} />} label="Install a tracker" onPress={browseRegistry} />
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
