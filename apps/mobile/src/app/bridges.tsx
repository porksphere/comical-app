import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { ArrowUpIcon, BridgesIcon, CheckIcon, ClearIcon, RefreshIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SelectPillBar, useSelectMode, useSelectToggle } from '@/components/multi-select/select-mode';
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
import type { BridgeSummary } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyOrder, setBridgeOrder, useBridgeOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import { usePackageUpdate, useUpdatingIds } from '@/data/use-package-update';
import { useBridgeUpdateMap, useRecheckRegistryUpdates } from '@/data/use-settings-badge';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { UNINSTALL_ONE_MESSAGE } from '@/lib/bridge-uninstall';
import { friendlyError, UserFacingError } from '@/lib/friendly-error';
import { useRouter } from '@/lib/nav';
import { testId } from '@/lib/test-id';

const IS_WEB = Platform.OS === 'web';

/** One-line status for a bridge row: discontinuation and available updates take precedence over the
 *  "needs setup" hint, so the user sees the most actionable state at a glance. `tone` picks the
 *  status color (amber for something needing attention, blue for an informational update) so the
 *  more urgent states are visually distinct instead of blending into the secondary-text color. */
function bridgeStatus(
  b: BridgeSummary,
  availableVersion: string | undefined,
  updating: boolean,
): { text: string; tone: 'warn' | 'info' } | undefined {
  if (updating) return { text: availableVersion ? `Updating to v${availableVersion}…` : 'Updating…', tone: 'info' };
  if (b.discontinued) return { text: 'No longer offered by its registry', tone: 'warn' };
  if (availableVersion) return { text: `Update available — v${availableVersion}`, tone: 'info' };
  if (!b.configured) return { text: 'Needs setup', tone: 'warn' };
  return undefined;
}

export default function BridgesScreen() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const hideNsfw = useHideNsfw();
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const browseRegistry = useBrowseRegistry();
  // Live registry update check (id → newer version) — the authoritative signal for a row's update
  // dot / swipe-Update, so a pending update shows even when the summary's `availableVersion`
  // annotation hasn't been persisted back yet (see useBridgeUpdateMap). Served from the pip's cache.
  const updateMap = useBridgeUpdateMap();

  const { data: bridges, isError, error, refetch } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });

  // Apply the saved order, then hide NSFW. `ordered` (all bridges, sorted) backs the reorder merge.
  const order = useBridgeOrder();
  const ordered = bridges ? applyOrder(bridges, order, (b) => b.info.id) : bridges;
  const visible = ordered && hideNsfw ? ordered.filter((b) => !b.info.nsfw) : ordered;

  // The reorder UI shows only visible bridges; keep any hidden (NSFW-filtered) ones after them in the
  // saved order rather than dropping them, so hiding NSFW then reordering doesn't lose their places.
  const onReorder = (keys: string[]) => {
    const shown = new Set(keys);
    const rest = (ordered ?? []).map((b) => b.info.id).filter((id) => !shown.has(id));
    setBridgeOrder([...keys, ...rest]);
  };

  const { checking, recheck } = useRecheckRegistryUpdates();
  const checkForUpdates = async () => {
    if (checking) return;
    const [updates] = await Promise.all([recheck(), refetch()]);
    // Counted against the rows on screen: an update to a bridge Hide NSFW has hidden isn't one the
    // list can show.
    const shown = new Set((visible ?? []).map((b) => b.info.id));
    const n = updates.bridges.filter((u) => shown.has(u.id)).length;
    showToast(n === 0 ? 'No bridge updates' : n === 1 ? '1 bridge update available' : `${n} bridge updates available`);
  };

  // ── Multi-select mode (the shared select-mode chrome) — bulk-uninstall bridges ──
  // Only REGISTRY-INSTALLED bridges are selectable (a server-built one has nothing to uninstall,
  // same `source` gate as the row's swipe); server rows keep their column.
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(
    () => (visible ?? []).filter((b) => b.source === 'registry').map((b) => b.info.id),
    [visible],
  );
  const selectable = useMemo(() => new Set(allKeys), [allKeys]);
  const ms = useMultiSelect(allKeys);
  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };
  const selectToggle = useSelectToggle(selecting, toggleSelecting, 'bridges.select-toggle');
  const allSelected = allKeys.length > 0 && ms.count === allKeys.length;
  const stagingRows = [
    {
      label: allSelected ? 'Deselect all' : 'Select all',
      Icon: allSelected ? ClearIcon : CheckIcon,
      loading: false,
      disabled: allKeys.length === 0,
      onPress: allSelected ? ms.clear : ms.selectAll,
      testID: testId('bridges.menu', 'all'),
    },
  ];

  // Retry re-runs the same `onConfirm`, so `pending` lives in its closure and shrinks as bridges go:
  // a retry only redoes the ones that failed. Uninstall is idempotent on every host, so one already
  // gone counts as done.
  const confirmUninstallSelected = () => {
    const names = new Map((visible ?? []).map((b) => [b.info.id, b.info.name]));
    let pending = allKeys.filter((id) => ms.selected.has(id));
    const total = pending.length;
    openConfirm({
      message: `${total === 1 ? 'This bridge' : `These ${total} bridges`} will be uninstalled. Their series stay in your library, greyed out, with your reading progress. Their settings are kept in case you reinstall.`,
      confirmLabel: total === 1 ? 'Uninstall Bridge' : `Uninstall ${total} Bridges`,
      pendingLabel: 'Uninstalling…',
      errorFallback: 'Failed to uninstall bridges',
      onConfirm: async () => {
        const failed: string[] = [];
        try {
          for (const id of pending) {
            try {
              await ds.uninstallBridge(id);
            } catch {
              failed.push(id);
            }
          }
        } finally {
          pending = failed;
          ms.selectOnly(failed);
          bumpDataEpoch();
          // Broad invalidate — Browse's bridge selector and Library/History/Activity's bridge map
          // are all react-query-backed and need to drop these bridges immediately, not just this list.
          await queryClient.invalidateQueries();
        }
        if (failed.length > 0) {
          throw new UserFacingError(`Couldn't uninstall ${failed.map((id) => names.get(id) ?? id).join(', ')}`);
        }
        mode.exit();
        showToast(total === 1 ? 'Bridge uninstalled' : `${total} bridges uninstalled`);
      },
    });
  };
  // The single-row (swipe action) confirm — same popup, with the bridge's name as the title since
  // the row is covered by the backdrop when this opens.
  const confirmUninstallOne = (b: BridgeSummary) =>
    openConfirm({
      title: `Uninstall ${b.info.name}?`,
      message: UNINSTALL_ONE_MESSAGE,
      confirmLabel: 'Uninstall Bridge',
      pendingLabel: 'Uninstalling…',
      errorFallback: 'Failed to uninstall bridge',
      onConfirm: async () => {
        await ds.uninstallBridge(b.info.id);
        bumpDataEpoch();
        // Broad invalidate, same reasoning as the bulk uninstall above.
        await queryClient.invalidateQueries();
      },
    });

  const update = usePackageUpdate('bridge');
  const updatingIds = useUpdatingIds('bridge');
  const updateOne = async (b: BridgeSummary) => {
    try {
      await update.mutateAsync(b.info.id);
      showToast(`${b.info.name} updated`);
    } catch (e) {
      showToast(friendlyError(e, 'Failed to update bridge'));
    }
  };

  const row = (b: BridgeSummary): SettingsField => {
    // The live check wins over the summary's cached annotation, so a freshly-published update shows
    // its dot/swipe without waiting for the annotation to be re-persisted; fall back to the annotation
    // when the check hasn't resolved (or is offline) so a known update still surfaces.
    const availableVersion = updateMap.get(b.info.id) ?? b.availableVersion;
    const updating = updatingIds.has(b.info.id);
    const status = bridgeStatus(b, availableVersion, updating);
    const hasUpdate = !!availableVersion && !updating;
    return {
      kind: 'link',
      key: b.info.id,
      testID: testId('bridges.row', b.info.id),
      label: b.info.name,
      description: status?.text,
      tone: status?.tone,
      icon: { symbol: 'puzzlepiece', glyph: (color, size) => <BridgesIcon color={color} size={size} />, uri: b.info.iconUrl },
      // The row's own accent dot — the per-bridge form of the counted pip on the Settings "Bridges"
      // icon, so a bridge that surfaced that pip is identifiable in the list itself.
      marked: hasUpdate,
      busy: updating,
      onPress: () => router.push({ pathname: '/bridge-settings', params: { bridgeId: b.info.id, source: b.source } }),
      // Only registry-installed bridges can be uninstalled — a server-built one has nothing to remove
      // (same `source` gate bridge-settings.tsx uses). "Update" sits left of the destructive
      // "Uninstall" (edge slot), only when an update is actually available.
      actions:
        b.source === 'registry'
          ? [
              ...(hasUpdate ? [{ key: 'update', label: 'Update', symbol: 'arrow.up' as const, glyph: ArrowUpIcon, onPress: () => void updateOne(b) }] : []),
              { key: 'uninstall', label: 'Uninstall', symbol: 'trash' as const, glyph: TrashIcon, destructive: true, onPress: () => confirmUninstallOne(b) },
            ]
          : undefined,
    };
  };
  const sections: SettingsFormSection[] = [
    {
      fields: (visible ?? []).map(row),
      onReorder,
      selection: { selecting, progress: mode.progress, selected: ms.selected, selectable, toggle: ms.toggle, rangeFill: ms.rangeFill },
    },
  ];

  const checkUpdates: TopBarAction = {
    label: 'Check for bridge updates',
    testID: 'bridges.check-updates',
    onPress: () => void checkForUpdates(),
    icon: checking ? <ActivityIndicator size="small" /> : <RefreshIcon color={theme.text} size={20} />,
    native: null,
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={selecting ? `${ms.count} selected` : 'Bridges'}
        actions={
          selecting
            ? [selectToggle]
            : [
                // Web has no pull-to-refresh on this list, so the check gets a button there.
                ...(IS_WEB && (visible?.length ?? 0) > 0 ? [checkUpdates] : []),
                // The + install button lives in the floating FAB below (hidden in select mode).
                ...(allKeys.length > 0 ? [selectToggle] : []),
              ]
        }
      />
      {isError ? (
        <View style={[styles.stateHost, contentPadding]}>
          <RetryBlock message={friendlyError(error, 'Failed to load bridges. Try again.')} onRetry={() => refetch()} />
        </View>
      ) : !visible ? (
        <View style={[styles.stateHost, contentPadding]}>
          <ActivityIndicator />
        </View>
      ) : visible.length === 0 ? (
        <View style={[styles.stateHost, styles.empty, contentPadding]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            {bridges!.length === 0
              ? 'No bridges installed. Bridges are the sources Comical reads from — install one from a registry to get started.'
              : 'No bridges to show — NSFW-flagged bridges are hidden.'}
          </ThemedText>
          {bridges!.length === 0 && (
            <Pressable testID="bridges.browse-registries" onPress={() => router.push('/registries')}>
              <ThemedView style={[styles.cta, { backgroundColor: theme.accent }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                  Browse registries
                </ThemedText>
              </ThemedView>
            </Pressable>
          )}
        </View>
      ) : (
        // The live list is the draggable list; a pull runs the update check.
        <SettingsList sections={sections} refresh={checkForUpdates} />
      )}

      {/* The + install affordance: a floating FAB in normal mode, hidden while selecting. */}
      {browseRegistry && !selecting && (
        <AddFab
          onPress={browseRegistry}
          testID="bridges.add"
          label="Install a bridge"
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
        />
      )}

      {/* The floating select-mode chrome: staging "…" bottom-left, the Uninstall verb bottom-right. */}
      {selecting && (
        <SelectPillBar
          left={contentPadding.paddingLeft}
          right={contentPadding.paddingRight}
          bottom={Math.max(insets.bottom, Spacing.three)}
          options={stagingRows}
          optionsTestID="bridges.select-options"
          verbs={
            ms.count > 0
              ? [
                  {
                    key: 'uninstall',
                    label: `Uninstall ${ms.count} bridges`,
                    Icon: TrashIcon,
                    color: theme.danger,
                    onPress: confirmUninstallSelected,
                    testID: 'bridges.uninstall-selected',
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
  cta: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.three,
  },
});
