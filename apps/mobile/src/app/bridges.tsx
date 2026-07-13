import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BridgesIcon, PlusIcon } from '@/components/icons/ui-icons';
import { useOverlay } from '@/components/overlay/overlay';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { RowIcon } from '@/components/settings/row-icon';
import { SettingsRow, SettingsSection, SettingsTopGap } from '@/components/settings/settings-row';
import { SwipeableSettingsRow } from '@/components/settings/swipeable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton, useTopBarInset } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { BridgeSummary } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { queryKeys } from '@/data/queries';
import { useDataSource, useHideNsfw } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

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
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const hideNsfw = useHideNsfw();
  const { open } = useOverlay();
  const browseRegistry = useBrowseRegistry();

  const { data: bridges, isError, error, refetch } = useQuery({
    queryKey: queryKeys.bridgeSummaries(),
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });

  const visible = bridges && hideNsfw ? bridges.filter((b) => !b.info.nsfw) : bridges;

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Bridges"
        right={
          browseRegistry && (
            <TopBarButton icon={<PlusIcon color={theme.text} size={22} />} label="Install a bridge" onPress={browseRegistry} />
          )
        }
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // The TopBar is an absolute overlay, so the content pads past it (and scrolls under its frost).
          { paddingTop: topBarInset + SettingsTopGap, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        {isError ? (
          <RetryBlock message={friendlyError(error, 'Failed to load bridges. Try again.')} onRetry={() => refetch()} />
        ) : !visible ? (
          <ActivityIndicator />
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              {bridges!.length === 0
                ? 'No bridges installed. Bridges are the sources Comical reads from — install one from a registry to get started.'
                : 'No bridges to show — NSFW-flagged bridges are hidden.'}
            </ThemedText>
            {bridges!.length === 0 && (
              <Pressable onPress={() => router.push('/registries')}>
                <ThemedView style={[styles.cta, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentOn }}>
                    Browse registries
                  </ThemedText>
                </ThemedView>
              </Pressable>
            )}
          </View>
        ) : (
          <SettingsSection>
            {visible.map((b) => {
              const status = bridgeStatus(b);
              const openBridge = () =>
                router.push({
                  pathname: '/bridge-settings',
                  params: {
                    bridgeId: b.info.id,
                    source: b.source,
                    ...(b.availableVersion ? { availableVersion: b.availableVersion } : {}),
                  },
                });
              const statusColor = status && (status.tone === 'warn' ? theme.badgeWarn : theme.badgeInfo);
              const icon = <RowIcon uri={b.info.iconUrl} fallback={(color, size) => <BridgesIcon color={color} size={size} />} />;
              // Only registry-installed bridges can be uninstalled — one that's built into the
              // server has nothing to remove (this is the same `source` gate bridge-settings.tsx
              // puts on its own uninstall row), so it gets a plain non-swipeable row.
              return b.source === 'registry' ? (
                <SwipeableSettingsRow
                  key={b.info.id}
                  label={b.info.name}
                  description={status?.text}
                  descriptionColor={statusColor}
                  leading={icon}
                  onPress={openBridge}
                  actionLabel="Uninstall"
                  onAction={() => open(() => <UninstallBridgeConfirm bridge={b} />)}
                />
              ) : (
                <SettingsRow
                  key={b.info.id}
                  label={b.info.name}
                  description={status?.text}
                  descriptionColor={statusColor}
                  leading={icon}
                  onPress={openBridge}
                />
              );
            })}
          </SettingsSection>
        )}
      </ScrollView>
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
        <Pressable onPress={closeTop} style={styles.confirmBtn}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={() => uninstall.mutate()} disabled={uninstall.isPending} style={styles.confirmBtn}>
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
  content: {
    // Spacing BETWEEN sections (SettingsSection no longer carries a top margin — see settings-row).
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
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
