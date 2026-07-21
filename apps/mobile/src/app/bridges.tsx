import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddFab } from '@/components/add-fab';
import { openConfirm } from '@/components/confirm-popup';
import { Holdable } from '@/components/context-menu';
import { ArrowUpIcon, BridgesIcon, CheckIcon, ClearIcon, GripIcon, TrashIcon } from '@/components/icons/ui-icons';
import { SelectLead, SelectLeadGap, SelectPillBar, SelectToggle, useSelectMode } from '@/components/multi-select/select-mode';
import { useMultiSelect } from '@/components/multi-select/use-multi-select';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { RowIcon } from '@/components/settings/row-icon';
import { SettingsRow } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import type { SwipeRowAction } from '@/components/settings/swipeable-row';
import { UpdateDot } from '@/components/tab-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { SettingsGutter, Spacing } from '@/constants/theme';
import type { BridgeSummary } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyOrder, setBridgeOrder, useBridgeOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';
import { hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

const IS_WEB = Platform.OS === 'web';

/** One-line status for a bridge row: discontinuation and available updates take precedence over the
 *  "needs setup" hint, so the user sees the most actionable state at a glance. `tone` picks the
 *  status color (amber for something needing attention, blue for an informational update) so the
 *  more urgent states are visually distinct instead of blending into the secondary-text color. */
function bridgeStatus(b: BridgeSummary): { text: string; tone: 'warn' | 'info' } | undefined {
  if (b.discontinued) return { text: 'No longer offered by its registry', tone: 'warn' };
  if (b.availableVersion) return { text: `Update available — v${b.availableVersion}`, tone: 'info' };
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

  // Web-only reorder mode (▲/▼). Native reorders in place via long-press drag — no mode.
  const [editing, setEditing] = useState(false);

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

  const canReorder = (visible?.length ?? 0) >= 2;

  // ── Multi-select mode (the shared select-mode chrome) — bulk-uninstall bridges ──
  // Only REGISTRY-INSTALLED bridges are selectable (a server-built one has nothing to uninstall,
  // same `source` gate as the row's swipe); server rows keep alignment via `SelectLeadGap`.
  const mode = useSelectMode();
  const selecting = mode.selecting;
  const allKeys = useMemo(
    () => (visible ?? []).filter((b) => b.source === 'registry').map((b) => b.info.id),
    [visible],
  );
  const ms = useMultiSelect(allKeys);
  const toggleSelecting = () => {
    if (selecting) ms.clear();
    mode.toggle();
  };
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

  const uninstallSelected = async () => {
    const ids = allKeys.filter((id) => ms.selected.has(id));
    for (const id of ids) await ds.uninstallBridge(id);
    bumpDataEpoch();
    // Broad invalidate — Browse's bridge selector and Library/History/Activity's bridge map are
    // all react-query-backed and need to drop these bridges immediately, not just this list.
    await queryClient.invalidateQueries();
    ms.clear();
    mode.exit();
    showToast(ids.length === 1 ? 'Bridge uninstalled' : `${ids.length} bridges uninstalled`);
  };
  const confirmUninstallSelected = () =>
    openConfirm({
      message: `${ms.count === 1 ? 'This bridge' : `These ${ms.count} bridges`} and their settings will be removed, and their series disappear from your library until installed again.`,
      confirmLabel: ms.count === 1 ? 'Uninstall Bridge' : `Uninstall ${ms.count} Bridges`,
      pendingLabel: 'Uninstalling…',
      errorFallback: 'Failed to uninstall bridges',
      onConfirm: uninstallSelected,
    });
  // The single-row (swipe action) confirm — same popup, with the bridge's name as the title since
  // the row is covered by the backdrop when this opens.
  const confirmUninstallOne = (b: BridgeSummary) =>
    openConfirm({
      title: `Uninstall ${b.info.name}?`,
      message: 'Its settings are removed, and series from it disappear from your library until you install it again.',
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

  // Update a single bridge in place (the row's swipe "Update" action), then broad-invalidate so its
  // "Update available" state, the count pills, and the Settings/tab pips all clear at once.
  const updateOne = async (b: BridgeSummary) => {
    try {
      await ds.updateBridge(b.info.id);
      bumpDataEpoch();
      await queryClient.invalidateQueries();
      showToast(`${b.info.name} updated`);
    } catch (e) {
      showToast(friendlyError(e, 'Failed to update bridge'));
    }
  };

  // The page's real row — full swipe-to-uninstall + tap. On native the reorder list wraps this
  // unchanged inside a drag item (swipe stays identical); on web it's the normal-mode row.
  const renderRow = (b: BridgeSummary) => {
    const status = bridgeStatus(b);
    const hasUpdate = !!b.availableVersion;
    const openBridge = () =>
      router.push({
        pathname: '/bridge-settings',
        params: { bridgeId: b.info.id, source: b.source, ...(b.availableVersion ? { availableVersion: b.availableVersion } : {}) },
      });
    const statusColor = status && (status.tone === 'warn' ? theme.badgeWarn : theme.badgeInfo);
    // The row's own accent dot — the per-bridge form of the counted pip on the Settings "Bridges"
    // icon, so a bridge that surfaced that pip is identifiable in the list itself.
    const icon = (
      <View>
        <RowIcon uri={b.info.iconUrl} fallback={(color, size) => <BridgesIcon color={color} size={size} />} />
        {hasUpdate && (
          <View style={styles.iconDot} pointerEvents="none">
            <UpdateDot />
          </View>
        )}
      </View>
    );
    // Only registry-installed bridges can be uninstalled — a server-built one has nothing to remove,
    // so it gets a plain non-swipeable row (same `source` gate bridge-settings.tsx uses), isn't
    // selectable, and goes inert while select mode is on.
    if (b.source !== 'registry') {
      return (
        <SettingsRow
          key={b.info.id}
          label={b.info.name}
          description={status?.text}
          descriptionColor={statusColor}
          leading={
            <>
              <SelectLeadGap progress={mode.progress} />
              {icon}
            </>
          }
          onPress={selecting ? undefined : openBridge}
        />
      );
    }
    const key = b.info.id;
    // "Update" (accent) sits left of the destructive "Uninstall" (edge slot) — a direct way to update
    // from the list instead of opening each bridge. Only shown when an update is actually available.
    const rowActions: SwipeRowAction[] = [
      ...(hasUpdate ? [{ key: 'update', label: 'Update', icon: ArrowUpIcon, onPress: () => void updateOne(b) }] : []),
      { key: 'uninstall', label: 'Uninstall', icon: TrashIcon, destructive: true, onPress: () => confirmUninstallOne(b) },
    ];
    return (
      // In select mode the row toggles (tap) / range-fills (hold, via the shared Holdable) instead
      // of opening bridge settings, and its swipe is parked. Same pattern as the Downloads screen.
      <Holdable
        key={key}
        enabled={selecting}
        onHold={() => {
          hapticSelection();
          ms.rangeFill(key);
        }}>
        {({ onLongPress }) => (
          <SwipeableSettingsRow
            label={b.info.name}
            description={status?.text}
            descriptionColor={statusColor}
            leading={
              <>
                <SelectLead progress={mode.progress} selected={ms.isSelected(key)} itemKey={key} edgeOffset={SettingsGutter} />
                {icon}
              </>
            }
            swipeEnabled={!selecting}
            onPress={selecting ? () => ms.toggle(key) : openBridge}
            onLongPress={selecting ? onLongPress : undefined}
            actions={rowActions}
          />
        )}
      </Holdable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title={selecting ? `${ms.count} selected` : 'Bridges'}
        right={
          editing ? (
            <TopBarButton testID="bridges.done" icon={<CheckIcon color={theme.text} size={22} />} label="Done reordering" onPress={() => setEditing(false)} />
          ) : selecting ? (
            <SelectToggle selecting onToggle={toggleSelecting} testID="bridges.select-toggle" />
          ) : (
            // The + install button now lives in the floating FAB below (hidden in select mode); the
            // top-right holds the select toggle where the + used to be.
            <View style={styles.topActions}>
              {/* Reorder button only on web (native reorders in place — long-press a row). */}
              {IS_WEB && canReorder && (
                <TopBarButton testID="bridges.reorder" icon={<GripIcon color={theme.text} size={22} />} label="Reorder bridges" onPress={() => setEditing(true)} />
              )}
              {allKeys.length > 0 && <SelectToggle selecting={false} onToggle={toggleSelecting} testID="bridges.select-toggle" />}
            </View>
          )
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
        // The live list IS the reorderable list: native = long-press drag in place, web = normal rows
        // (or ▲/▼ while `editing`). It owns its own scroll, so there's no pull-to-refresh wrapper here.
        <ReorderableList
          data={visible}
          keyOf={(b) => b.info.id}
          renderRow={renderRow}
          label={(b) => b.info.name}
          leading={(b) => <RowIcon uri={b.info.iconUrl} fallback={(color, size) => <BridgesIcon color={color} size={size} />} />}
          onReorder={onReorder}
          editing={editing}
          dragEnabled={!selecting}
          refresh={() => refetch()}
        />
      )}

      {/* The + install affordance: a floating FAB in normal mode, hidden while selecting/reordering. */}
      {browseRegistry && !selecting && !editing && (
        <AddFab
          onPress={browseRegistry}
          testID="bridges.add"
          label="Install a bridge"
          right={SettingsGutter}
          bottom={Math.max(insets.bottom, Spacing.three)}
        />
      )}

      {/* The floating select-mode chrome: staging "…" bottom-left, the Uninstall verb bottom-right. */}
      {selecting && (
        <SelectPillBar
          left={SettingsGutter}
          right={SettingsGutter}
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
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Hugs the top-right corner of the 28-wide RowIcon tile so the dot overlaps the artwork, mirroring
  // how the Settings category row places its update pip over the section glyph.
  iconDot: {
    position: 'absolute',
    top: -3,
    right: -3,
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
