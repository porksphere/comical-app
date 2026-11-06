import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddFab } from '@/components/add-fab';

import { openConfirm } from '@/components/confirm-popup';
import { ArrowUpIcon, RefreshIcon, TrackersIcon, TrashIcon } from '@/components/icons/ui-icons';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { type SettingsField, type SettingsFormSection } from '@/components/settings/settings-form';
import { SettingsList } from '@/components/settings/settings-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar, type TopBarAction } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import type { TrackerSummary } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyOrder, setTrackerOrder, useTrackerOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { usePackageUpdate, useUpdatingIds } from '@/data/use-package-update';
import { useRecheckRegistryUpdates, useTrackerUpdateMap } from '@/data/use-settings-badge';
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
  const insets = useSafeAreaInsets();
  const browseRegistry = useBrowseRegistry();
  const queryClient = useQueryClient();
  // Live registry update check (id → newer version) — the authoritative signal for a row's update
  // dot / swipe-Update, so a pending update shows even before the summary annotation catches up.
  const updateMap = useTrackerUpdateMap();

  // `data === undefined` = still loading; `null` = this server has no tracker support (an expected
  // state, not an error).
  const { data: trackers, isError, error, refetch } = useQuery({
    queryKey: queryKeys.trackers(),
    queryFn: ({ signal }) => ds.getTrackers(signal),
  });

  // Apply the saved order. Trackers have no NSFW filter, so the whole list reorders directly.
  const order = useTrackerOrder();
  const ordered = Array.isArray(trackers) ? applyOrder(trackers, order, (t) => t.info.id) : trackers;

  const { checking, recheck } = useRecheckRegistryUpdates();
  const checkForUpdates = async () => {
    if (checking) return;
    const [updates] = await Promise.all([recheck(), refetch()]);
    const n = updates.trackers.length;
    showToast(n === 0 ? 'No tracker updates' : n === 1 ? '1 tracker update available' : `${n} tracker updates available`);
  };

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

  const update = usePackageUpdate('tracker');
  const updatingIds = useUpdatingIds('tracker');
  const updateOne = async (t: TrackerSummary) => {
    try {
      await update.mutateAsync(t.info.id);
      showToast(`${t.info.name} updated`);
    } catch (e) {
      showToast(friendlyError(e, 'Failed to update tracker'));
    }
  };

  const row = (t: TrackerSummary): SettingsField => {
    const availableVersion = updateMap.get(t.info.id);
    const updating = updatingIds.has(t.info.id);
    const hasUpdate = !!availableVersion && !updating;
    const status = updating
      ? { text: availableVersion ? `Updating to v${availableVersion}…` : 'Updating…', tone: 'info' as const }
      : hasUpdate
        ? { text: `Update available — v${availableVersion}`, tone: 'info' as const }
        : t.configured
          ? undefined
          : { text: 'Needs setup', tone: 'warn' as const };
    return {
      kind: 'link',
      key: t.info.id,
      testID: testId('trackers.row', t.info.id),
      label: t.info.name,
      description: status?.text,
      tone: status?.tone,
      icon: { symbol: 'arrow.clockwise', glyph: (color, size) => <TrackersIcon color={color} size={size} />, uri: t.info.iconUrl },
      marked: hasUpdate,
      busy: updating,
      onPress: () => router.push({ pathname: '/tracker-settings', params: { trackerId: t.info.id } }),
      // A server-built (local) tracker can't be uninstalled — a plain row. "Update" sits left of
      // the destructive "Uninstall" (edge slot), only when one's available.
      actions:
        t.source === 'registry'
          ? [
              ...(hasUpdate ? [{ key: 'update', label: 'Update', symbol: 'arrow.up' as const, glyph: ArrowUpIcon, onPress: () => void updateOne(t) }] : []),
              { key: 'uninstall', label: 'Uninstall', symbol: 'trash' as const, glyph: TrashIcon, destructive: true, onPress: () => confirmUninstallOne(t) },
            ]
          : undefined,
    };
  };
  const sections: SettingsFormSection[] = [{ fields: Array.isArray(ordered) ? ordered.map(row) : [], onReorder: (keys) => setTrackerOrder(keys) }];

  const checkUpdates: TopBarAction = {
    label: 'Check for tracker updates',
    testID: 'trackers.check-updates',
    onPress: () => void checkForUpdates(),
    icon: checking ? <ActivityIndicator size="small" /> : <RefreshIcon color={theme.text} size={20} />,
    native: null,
  };
  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Trackers"
        actions={
          trackers === null
            ? undefined
            : [
                // Web has no pull-to-refresh on this list, so the check gets a button there. The
                // + install button is the add button below, as on Bridges.
                ...(IS_WEB && Array.isArray(ordered) && ordered.length > 0 ? [checkUpdates] : []),
              ]
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
        // The live list is the draggable list; a pull runs the update check.
        <SettingsList sections={sections} refresh={checkForUpdates} />
      )}

      {/* The + install affordance, where every other list keeps its add button. */}
      {browseRegistry && trackers !== null && (
        <AddFab
          onPress={browseRegistry}
          testID="trackers.install"
          label="Install a tracker"
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
