import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { ArrowUpIcon, CheckIcon, ClearIcon, RefreshIcon, TrackersIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useSelectMode, useSelectToggle } from '@/components/multi-select/select-mode';
import { SelectPillBar } from '@/components/multi-select/select-pill-bar';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
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
import { PackageUpdateError, usePackageUpdate, useUpdatingIds } from '@/data/use-package-update';
import { useRecheckRegistryUpdates, useTrackerUpdateMap } from '@/data/use-settings-badge';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError, UserFacingError } from '@/lib/friendly-error';
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

  // ── Multi-select mode (the shared select-mode chrome), as on Bridges — bulk-update and
  // bulk-uninstall. Only registry-installed trackers are selectable, the row's swipe's gate.
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(() => (Array.isArray(ordered) ? ordered : []).filter((t) => t.source === 'registry').map((t) => t.info.id), [ordered]);
  const selectable = useMemo(() => new Set(allKeys), [allKeys]);
  const ms = useMultiSelect(allKeys);
  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };
  const selectToggle = useSelectToggle(selecting, toggleSelecting, 'trackers.select-toggle');
  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      symbol: allSelected ? ('xmark.circle' as const) : ('checkmark.circle' as const),
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('trackers.menu', 'all'),
    },
  ];
  const names = new Map((Array.isArray(ordered) ? ordered : []).map((t) => [t.info.id, t.info.name]));

  const toUpdate = (Array.isArray(ordered) ? ordered : []).filter((t) => ms.selected.has(t.info.id) && updateMap.has(t.info.id) && !updatingIds.has(t.info.id));
  const updateSelected = async () => {
    const ids = toUpdate.map((t) => t.info.id);
    try {
      await update.mutateAsync(ids);
      showToast(ids.length === 1 ? `${names.get(ids[0]!)} updated` : `${ids.length} trackers updated`);
    } catch (e) {
      if (!(e instanceof PackageUpdateError)) return showToast(friendlyError(e, 'Failed to update trackers'));
      ms.selectOnly(e.failed);
      showToast(`Couldn't update ${e.failed.map((id) => names.get(id) ?? id).join(', ')}`);
    }
  };

  // Retry re-runs the same `onConfirm`, so `pending` shrinks as trackers go: a retry only redoes the
  // ones that failed.
  const confirmUninstallSelected = () => {
    let pending = allKeys.filter((id) => ms.selected.has(id));
    const total = pending.length;
    openConfirm({
      message: `${total === 1 ? 'This tracker' : `These ${total} trackers`} will be uninstalled. Their settings are removed and they stop syncing your reading progress until you install them again.`,
      confirmLabel: total === 1 ? 'Uninstall Tracker' : `Uninstall ${total} Trackers`,
      pendingLabel: 'Uninstalling…',
      errorFallback: 'Failed to uninstall trackers',
      onConfirm: async () => {
        const failed: string[] = [];
        try {
          for (const id of pending) {
            try {
              await ds.uninstallTracker(id);
            } catch {
              failed.push(id);
            }
          }
        } finally {
          pending = failed;
          ms.selectOnly(failed);
          bumpDataEpoch();
          await queryClient.invalidateQueries();
        }
        if (failed.length > 0) {
          throw new UserFacingError(`Couldn't uninstall ${failed.map((id) => names.get(id) ?? id).join(', ')}`);
        }
        mode.exit();
        showToast(total === 1 ? 'Tracker uninstalled' : `${total} trackers uninstalled`);
      },
    });
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
  const sections: SettingsFormSection[] = [
    {
      fields: Array.isArray(ordered) ? ordered.map(row) : [],
      onReorder: (keys) => setTrackerOrder(keys),
      selection: { selecting, progress: mode.progress, selected: ms.selected, selectable, toggle: ms.toggle, rangeFill: ms.rangeFill },
    },
  ];

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
        title={selecting ? `${ms.count} selected` : 'Trackers'}
        actions={
          trackers === null
            ? undefined
            : selecting
              ? [selectToggle]
              : [
                  // Web has no pull-to-refresh on this list, so the check gets a button there. The
                  // + install button is the add button below, as on Bridges.
                  ...(IS_WEB && Array.isArray(ordered) && ordered.length > 0 ? [checkUpdates] : []),
                  ...(allKeys.length > 0 ? [selectToggle] : []),
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
      {browseRegistry && trackers !== null && !selecting && (
        <AddFab
          onPress={browseRegistry}
          testID="trackers.install"
          label="Install a tracker"
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
        />
      )}

      {selecting && (
        <SelectPillBar
          left={contentPadding.paddingLeft}
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="trackers.select-options"
          verbs={
            ms.count > 0
              ? [
                  ...(toUpdate.length > 0
                    ? [
                        {
                          key: 'update',
                          label: `Update ${toUpdate.length === 1 ? '1 tracker' : `${toUpdate.length} trackers`}`,
                          symbol: 'arrow.up' as const,
                          Icon: ArrowUpIcon,
                          onPress: () => void updateSelected(),
                          testID: 'trackers.update-selected',
                        },
                      ]
                    : []),
                  {
                    key: 'uninstall',
                    label: `Uninstall ${ms.count === 1 ? '1 tracker' : `${ms.count} trackers`}`,
                    symbol: 'trash' as const,
                    Icon: TrashIcon,
                    color: theme.danger,
                    onPress: confirmUninstallSelected,
                    testID: 'trackers.uninstall-selected',
                  },
                ]
              : []
          }
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
