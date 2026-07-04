import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BridgesIcon,
  DeveloperIcon,
  GeneralSettingsIcon,
  RegistriesIcon,
  TrackersIcon,
} from '@/components/icons/ui-icons';
import { RetryBlock } from '@/components/retry-block';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { API_BASE, isAbort, type BridgeSummary, type SavedRegistry, type TrackerSummary } from '@/data/api';
import { applyEmbeddedMode, isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { bumpDataEpoch } from '@/data/data-epoch';
import { queryClient } from '@/data/query-client';
import { useDataSource, useHideNsfw, useMockDataToggle } from '@/data/source';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <ThemedText type="title">Settings</ThemedText>
        <GeneralSection />
        <BridgesSection />
        <TrackersSection />
        <RegistriesSection />
        {__DEV__ && <DeveloperSection />}
      </ScrollView>
    </ThemedView>
  );
}

function GeneralSection() {
  const theme = useTheme();
  const [hideNsfw, setHideNsfw] = useHideNsfw();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  // The on-device runtime is only offered where a native bridge engine exists (iOS/Android with the
  // native module built) — never on web, which always uses a remote server.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();

  const toggleOnDevice = (enabled: boolean) => {
    setOnDevice(enabled);
    applyEmbeddedMode(enabled); // swap api.ts's transport (embedded ⇄ remote)
    queryClient.clear(); // embedded and remote caches must not mix (mirrors PERSIST_BUSTER)
    bumpDataEpoch(); // refetch useDataSource-backed screens against the swapped transport
  };

  return (
    <SettingsSection title="General" icon={<GeneralSettingsIcon color={theme.textSecondary} size={14} />}>
      <SettingsRow
        label="Hide NSFW content"
        description="Hides NSFW-flagged bridges from the Browse tab."
        right={<ThemedSwitch value={hideNsfw} onValueChange={setHideNsfw} />}
      />
      {embeddedAvailable && (
        <SettingsRow
          label="Run bridges on this device"
          description="Fetch and read entirely on-device, with no external server. Turn off to use a remote Comical server."
          right={<ThemedSwitch value={onDevice} onValueChange={toggleOnDevice} />}
        />
      )}
    </SettingsSection>
  );
}

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

function BridgesSection() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const [bridges, setBridges] = useState<BridgeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    ds.getBridgeSummaries(ctrl.signal)
      .then(setBridges)
      .catch((e) => {
        if (!isAbort(e)) setError(e.message || 'Failed to load bridges');
      });
    return () => ctrl.abort();
  }, [ds, reload]);

  return (
    <SettingsSection title="Bridges" icon={<BridgesIcon color={theme.textSecondary} size={14} />}>
      {error ? (
        <RetryBlock message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : !bridges ? (
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      ) : bridges.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No bridges installed.
        </ThemedText>
      ) : (
        bridges.map((b) => {
          const status = bridgeStatus(b);
          return (
            <SettingsRow
              key={b.info.id}
              label={b.info.name}
              description={status?.text}
              descriptionColor={status && (status.tone === 'warn' ? theme.badgeWarn : theme.badgeInfo)}
              onPress={() =>
                router.push({ pathname: '/bridge-settings', params: { bridgeId: b.info.id, source: b.source } })
              }
            />
          );
        })
      )}
    </SettingsSection>
  );
}

function TrackersSection() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const [trackers, setTrackers] = useState<TrackerSummary[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    ds.getTrackers(ctrl.signal)
      .then(setTrackers)
      .catch((e) => {
        if (!isAbort(e)) setError(e.message || 'Failed to load trackers');
      });
    return () => ctrl.abort();
  }, [ds, reload]);

  return (
    <SettingsSection title="Trackers" icon={<TrackersIcon color={theme.textSecondary} size={14} />}>
      {error ? (
        <RetryBlock message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : trackers === undefined ? (
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      ) : trackers === null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Trackers are not available on this server.
        </ThemedText>
      ) : trackers.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No trackers installed.
        </ThemedText>
      ) : (
        trackers.map((t) => (
          <SettingsRow
            key={t.info.id}
            label={t.info.name}
            description={t.configured ? undefined : 'Needs setup'}
            descriptionColor={t.configured ? undefined : theme.badgeWarn}
            onPress={() => router.push({ pathname: '/tracker-settings', params: { trackerId: t.info.id } })}
          />
        ))
      )}
    </SettingsSection>
  );
}

function RegistriesSection() {
  const ds = useDataSource();
  const router = useRouter();
  const theme = useTheme();
  const [registries, setRegistries] = useState<SavedRegistry[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    ds.getRegistries(ctrl.signal)
      .then(setRegistries)
      .catch((e) => {
        if (!isAbort(e)) setError(e.message || 'Failed to load registries');
      });
    return () => ctrl.abort();
  }, [ds, reload]);

  return (
    <SettingsSection title="Registries" icon={<RegistriesIcon color={theme.textSecondary} size={14} />}>
      {error ? (
        <RetryBlock message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : registries === undefined ? (
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      ) : registries === null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Registries are not available on this server.
        </ThemedText>
      ) : (
        <>
          {registries.map((r) => (
            <SettingsRow
              key={r.url}
              label={r.name}
              description={r.url}
              onPress={() => router.push({ pathname: '/registry-browse', params: { url: r.url } })}
            />
          ))}
          <SettingsRow label="Manage registries" onPress={() => router.push('/registries')} />
        </>
      )}
    </SettingsSection>
  );
}

/** Dev-build-only: lets local development iterate against mock data without a
 *  running backend, and shows which server real requests target. Stripped from
 *  real production builds by the `__DEV__` check above. */
function DeveloperSection() {
  const theme = useTheme();
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  return (
    <SettingsSection title="Developer" icon={<DeveloperIcon color={theme.textSecondary} size={14} />}>
      <SettingsRow
        label="Use mock data"
        description="Browse/Series/Reader render generated sample content instead of calling the API."
        right={<ThemedSwitch value={mockEnabled} onValueChange={setMockEnabled} />}
      />
      <SettingsRow label="Server" description={API_BASE} descriptionSelectable />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
