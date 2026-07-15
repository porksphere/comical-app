import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { BridgesIcon, CheckIcon, GripIcon, PlusIcon, TrashIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { ReorderableList } from '@/components/settings/reorderable-list';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { RowIcon } from '@/components/settings/row-icon';
import { SettingsRow } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton } from '@/components/top-bar';
import { Spacing } from '@/constants/theme';
import type { BridgeSummary } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyOrder, setBridgeOrder, useBridgeOrder } from '@/data/list-order';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

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
  const { open } = useOverlay();
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

  // The page's real row — full swipe-to-uninstall + tap. On native the reorder list wraps this
  // unchanged inside a drag item (swipe stays identical); on web it's the normal-mode row.
  const renderRow = (b: BridgeSummary) => {
    const status = bridgeStatus(b);
    const openBridge = () =>
      router.push({
        pathname: '/bridge-settings',
        params: { bridgeId: b.info.id, source: b.source, ...(b.availableVersion ? { availableVersion: b.availableVersion } : {}) },
      });
    const statusColor = status && (status.tone === 'warn' ? theme.badgeWarn : theme.badgeInfo);
    const icon = <RowIcon uri={b.info.iconUrl} fallback={(color, size) => <BridgesIcon color={color} size={size} />} />;
    // Only registry-installed bridges can be uninstalled — a server-built one has nothing to remove,
    // so it gets a plain non-swipeable row (same `source` gate bridge-settings.tsx uses).
    return b.source === 'registry' ? (
      <SwipeableSettingsRow
        key={b.info.id}
        label={b.info.name}
        description={status?.text}
        descriptionColor={statusColor}
        leading={icon}
        onPress={openBridge}
        actions={[{ label: 'Uninstall', icon: TrashIcon, destructive: true, onPress: () => open(() => <UninstallBridgeConfirm bridge={b} />) }]}
      />
    ) : (
      <SettingsRow key={b.info.id} label={b.info.name} description={status?.text} descriptionColor={statusColor} leading={icon} onPress={openBridge} />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Bridges"
        right={
          editing ? (
            <TopBarButton testID="bridges.done" icon={<CheckIcon color={theme.text} size={22} />} label="Done reordering" onPress={() => setEditing(false)} />
          ) : (
            <View style={styles.topActions}>
              {/* Reorder button only on web (native reorders in place — long-press a row). */}
              {IS_WEB && canReorder && (
                <TopBarButton testID="bridges.reorder" icon={<GripIcon color={theme.text} size={22} />} label="Reorder bridges" onPress={() => setEditing(true)} />
              )}
              {browseRegistry && (
                <TopBarButton testID="bridges.add" icon={<PlusIcon color={theme.text} size={22} />} label="Install a bridge" onPress={browseRegistry} />
              )}
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
          refresh={() => refetch()}
        />
      )}
    </ThemedView>
  );
}

function UninstallBridgeConfirm({ bridge }: { bridge: BridgeSummary }) {
  const ds = useDataSource();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { closeTop } = useOverlay();

  const uninstall = useMutation({
    mutationFn: () => ds.uninstallBridge(bridge.info.id),
    onSuccess: async () => {
      bumpDataEpoch();
      // Broad invalidate — Browse's bridge selector and Library/History/Activity's bridge map are
      // all react-query-backed and need to drop this bridge immediately, not just this list.
      // (Same reasoning as bridge-settings.tsx's own uninstall.)
      await queryClient.invalidateQueries();
      closeTop();
    },
  });
  const error = uninstall.isError ? friendlyError(uninstall.error, 'Failed to uninstall bridge') : null;

  return (
    <View style={styles.confirmBody}>
      <ThemedText type="subtitle">Uninstall {bridge.info.name}?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Its settings are removed, and series from it disappear from your library until you install it again.
      </ThemedText>
      {error && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      )}
      <View style={styles.confirmActions}>
        <Pressable testID="bridges.uninstall.cancel" onPress={closeTop} style={styles.confirmBtn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable testID="bridges.uninstall.confirm" onPress={() => uninstall.mutate()} disabled={uninstall.isPending} style={styles.confirmBtn}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {uninstall.isPending ? 'Uninstalling…' : 'Uninstall'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
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
  cta: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.three,
  },
  confirmBody: {
    gap: Spacing.three,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.five,
  },
  confirmBtn: {
    paddingVertical: Spacing.two,
  },
});
