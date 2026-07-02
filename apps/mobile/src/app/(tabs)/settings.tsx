import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RetryBlock } from '@/components/retry-block';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxTopLevelWidth, Spacing } from '@/constants/theme';
import { API_BASE, isAbort, type BridgeSummary, type SavedRegistry, type TrackerSummary } from '@/data/api';
import { applyEmbeddedMode, isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { queryClient } from '@/data/query-client';
import { useDataSource, useHideNsfw, useMockDataToggle } from '@/data/source';

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
  const [hideNsfw, setHideNsfw] = useHideNsfw();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  // The on-device runtime is only offered where a native bridge engine exists (iOS/Android with the
  // native module built) — never on web, which always uses a remote server.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();

  const toggleOnDevice = (enabled: boolean) => {
    setOnDevice(enabled);
    applyEmbeddedMode(enabled); // swap api.ts's transport (embedded ⇄ remote)
    queryClient.clear(); // embedded and remote caches must not mix (mirrors PERSIST_BUSTER)
  };

  return (
    <SettingsSection title="General">
      <SettingsRow
        label="Hide NSFW content"
        description="Hides NSFW-flagged bridges from the Browse tab."
        right={<Switch value={hideNsfw} onValueChange={setHideNsfw} />}
      />
      {embeddedAvailable && (
        <SettingsRow
          label="Run bridges on this device"
          description="Fetch and read entirely on-device, with no external server. Turn off to use a remote Comical server."
          right={<Switch value={onDevice} onValueChange={toggleOnDevice} />}
        />
      )}
    </SettingsSection>
  );
}

function BridgesSection() {
  const ds = useDataSource();
  const router = useRouter();
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
    <SettingsSection title="Bridges">
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
        bridges.map((b) => (
          <SettingsRow
            key={b.info.id}
            label={b.info.name}
            description={b.configured ? undefined : 'Needs setup'}
            onPress={() =>
              router.push({ pathname: '/bridge-settings', params: { bridgeId: b.info.id, source: b.source } })
            }
          />
        ))
      )}
    </SettingsSection>
  );
}

function TrackersSection() {
  const ds = useDataSource();
  const router = useRouter();
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
    <SettingsSection title="Trackers">
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
    <SettingsSection title="Registries">
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
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  return (
    <SettingsSection title="Developer">
      <SettingsRow
        label="Use mock data"
        description="Browse/Series/Reader render generated sample content instead of calling the API."
        right={<Switch value={mockEnabled} onValueChange={setMockEnabled} />}
      />
      <View>
        <ThemedText type="small">Server</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" selectable>
          {API_BASE}
        </ThemedText>
      </View>
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
    maxWidth: MaxTopLevelWidth,
    alignSelf: 'center',
  },
});
