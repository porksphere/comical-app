import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlusIcon } from '@/components/icons/ui-icons';
import { RetryBlock } from '@/components/retry-block';
import { useBrowseRegistry } from '@/components/settings/browse-registry';
import { SettingsRow, SettingsSection, SettingsTopGap } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, TopBarButton, useTopBarInset } from '@/components/top-bar';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { queryKeys } from '@/data/queries';
import { useDataSource } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/friendly-error';

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
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const browseRegistry = useBrowseRegistry();

  // `data === undefined` = still loading; `null` = this server has no tracker support (an expected
  // state, not an error).
  const { data: trackers, isError, error, refetch } = useQuery({
    queryKey: queryKeys.trackers(),
    queryFn: ({ signal }) => ds.getTrackers(signal),
  });

  return (
    <ThemedView style={styles.container}>
      <TopBar
        title="Trackers"
        right={
          browseRegistry &&
          trackers !== null && (
            <TopBarButton icon={<PlusIcon color={theme.text} size={22} />} label="Install a tracker" onPress={browseRegistry} />
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
          <RetryBlock message={friendlyError(error, 'Failed to load trackers. Try again.')} onRetry={() => refetch()} />
        ) : trackers === undefined ? (
          <ActivityIndicator />
        ) : trackers === null ? (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              Trackers are not available on this server.
            </ThemedText>
          </View>
        ) : trackers.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No trackers installed. Trackers sync your reading progress to an external service — install one from a
              registry to get started.
            </ThemedText>
          </View>
        ) : (
          <SettingsSection title="Installed">
            {trackers.map((t) => (
              <SettingsRow
                key={t.info.id}
                label={t.info.name}
                description={t.configured ? undefined : 'Needs setup'}
                descriptionColor={t.configured ? undefined : theme.badgeWarn}
                onPress={() => router.push({ pathname: '/tracker-settings', params: { trackerId: t.info.id } })}
              />
            ))}
          </SettingsSection>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
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
});
