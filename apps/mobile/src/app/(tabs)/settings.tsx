import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BridgesIcon,
  ChevronRightIcon,
  DeveloperIcon,
  DiagnosticsIcon,
  GeneralSettingsIcon,
  RegistriesIcon,
  TrackersIcon,
} from '@/components/icons/ui-icons';
import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useListMaxHeight,
  useOverlay,
} from '@/components/overlay/overlay';
import { RetryBlock } from '@/components/retry-block';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { isAbort, useApiBase, type BridgeSummary, type SavedRegistry, type TrackerSummary } from '@/data/api';
import { applyEmbeddedMode, isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { bumpDataEpoch } from '@/data/data-epoch';
import { queryClient } from '@/data/query-client';
import { useDataSource, useHideNsfw, useMockDataToggle, useNsfwMode, type NsfwMode } from '@/data/source';
import { useHideTabBarOnScroll } from '@/hooks/use-hide-tab-bar-on-scroll';
import { useHovered } from '@/hooks/use-hovered';
import { useScrollToTopOnReselect } from '@/hooks/use-scroll-to-top-on-reselect';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';

const NSFW_MODE_OPTIONS: { value: NsfwMode; label: string; description: string }[] = [
  { value: 'off', label: 'Off', description: 'NSFW-flagged bridges stay hidden everywhere in the app.' },
  { value: 'on', label: 'On', description: 'NSFW-flagged bridges stay visible until you turn this off again.' },
  {
    value: 'until-background',
    label: 'On until app is closed',
    description: 'NSFW-flagged bridges are visible now, but hidden again as soon as you leave or minimize the app.',
  },
  {
    value: 'until-restart',
    label: 'On until app restarts',
    description: 'NSFW-flagged bridges are visible now, and stay that way while switching apps — hidden again the next time Comical is relaunched.',
  },
];

function nsfwModeSummary(mode: NsfwMode): string {
  return NSFW_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? 'Off';
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnReselect('settings', scrollRef);
  const { onScroll } = useHideTabBarOnScroll();
  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <ThemedText type="title">Settings</ThemedText>
        <GeneralSection />
        <BridgesSection />
        <TrackersSection />
        <RegistriesSection />
        <DiagnosticsSection />
        {__DEV__ && <DeveloperSection />}
      </ScrollView>
    </ThemedView>
  );
}

function GeneralSection() {
  const theme = useTheme();
  const [nsfwMode, setNsfwMode] = useNsfwMode();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  const [apiBase, setApiBaseOverride] = useApiBase();
  const { open } = useOverlay();
  // The on-device runtime is only offered where a native bridge engine exists (iOS/Android with the
  // native module built) — never on web, which always uses a remote server.
  const embeddedAvailable = isEmbeddedRuntimeAvailable();
  // Whether the app is actually running embedded right now (not just the user's stored preference —
  // see getResolvedModeSync in embedded/preference.ts). The remote-server row is meaningless while
  // this is true, so it's hidden rather than just disabled.
  const embeddedActive = onDevice && embeddedAvailable;

  const toggleOnDevice = (enabled: boolean) => {
    setOnDevice(enabled);
    applyEmbeddedMode(enabled); // swap api.ts's transport (embedded ⇄ remote)
    queryClient.clear(); // embedded and remote caches must not mix (mirrors PERSIST_BUSTER)
    bumpDataEpoch(); // refetch useDataSource-backed screens against the swapped transport
  };

  const saveApiBase = (url: string | null) => {
    setApiBaseOverride(url);
    queryClient.clear(); // a different server's cached data can't be trusted (mirrors PERSIST_BUSTER)
    bumpDataEpoch(); // refetch useDataSource-backed screens against the new server
  };

  return (
    <SettingsSection title="General" icon={<GeneralSettingsIcon color={theme.textSecondary} size={14} />}>
      <NsfwModeRow mode={nsfwMode} onChange={setNsfwMode} />
      {embeddedAvailable && (
        <SettingsRow
          label="Run bridges on this device"
          description="Fetch and read entirely on-device, with no external server. Turn off to use a remote Comical server."
          right={<ThemedSwitch value={onDevice} onValueChange={toggleOnDevice} />}
        />
      )}
      {!embeddedActive && (
        <SettingsRow
          label="Remote server"
          description={apiBase}
          descriptionSelectable
          onPress={() => open(() => <RemoteServerForm currentUrl={apiBase} onSave={saveApiBase} />)}
        />
      )}
    </SettingsSection>
  );
}

/** Sheet/popover form for editing the remote-server override (see `RemoteServerForm`'s trigger row
 *  in `GeneralSection`) — mirrors `AddRegistryForm`'s text-input-plus-save shape in `registries.tsx`. */
function RemoteServerForm({ currentUrl, onSave }: { currentUrl: string; onSave: (url: string | null) => void }) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  const [url, setUrl] = useState(currentUrl);

  return (
    <View style={styles.confirmBody}>
      <OverlayHeading>Remote server</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        The Comical server this app talks to when not running bridges on this device.
      </ThemedText>
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="http://localhost:3100"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <View style={styles.confirmActions}>
        <Pressable
          onPress={() => {
            onSave(null);
            closeTop();
          }}
          style={styles.confirmBtn}>
          <ThemedText type="smallBold">Reset to default</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => {
            onSave(url);
            closeTop();
          }}
          disabled={!url.trim()}
          style={styles.confirmBtn}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Save
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** Row + anchored picker for the 4-way NSFW mode (mirrors `EnumField`'s pattern in
 *  `setting-field.tsx`), rather than a plain switch — "on" isn't a single durable
 *  state here, it can also be a temporary override that expires on backgrounding
 *  or on the next app restart (see `useNsfwMode` in `data/source.ts`). */
function NsfwModeRow({ mode, onChange }: { mode: NsfwMode; onChange: (mode: NsfwMode) => void }) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <NsfwModePicker mode={mode} onChange={onChange} />);
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <View style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <View style={styles.rowText}>
          <ThemedText type="small">NSFW content</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {NSFW_MODE_OPTIONS.find((o) => o.value === mode)?.description}
          </ThemedText>
        </View>
        <View style={styles.rowValue}>
          <ThemedText type="small" themeColor="textSecondary">
            {nsfwModeSummary(mode)}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      </View>
    </Pressable>
  );
}

function NsfwModePicker({ mode, onChange }: { mode: NsfwMode; onChange: (mode: NsfwMode) => void }) {
  const { closeTop } = useOverlay();
  const [headerHeight, setHeaderHeight] = useState(0);
  const maxHeight = useListMaxHeight(headerHeight);
  const theme = useTheme();
  return (
    <View style={styles.pickerBody}>
      <MeasuredHeader onHeight={setHeaderHeight}>
        <OverlayHeading>NSFW content</OverlayHeading>
      </MeasuredHeader>
      <OptionList maxHeight={maxHeight}>
        {NSFW_MODE_OPTIONS.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => {
              hapticSelection();
              onChange(opt.value);
              closeTop();
            }}
            android_ripple={{ color: theme.backgroundSelected }}
            style={styles.pressableCursor}>
            <ThemedView type="backgroundElement" style={styles.pickerRow}>
              <View style={styles.rowText}>
                <ThemedText type="smallBold">{opt.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {opt.description}
                </ThemedText>
              </View>
              <View style={[styles.check, opt.value === mode && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
            </ThemedView>
          </Pressable>
        ))}
      </OptionList>
    </View>
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
  const hideNsfw = useHideNsfw();

  // react-query, explicitly invalidated by install/update/uninstall (registry-browse.tsx,
  // bridge-settings.tsx) — not a plain effect keyed on `ds`, since this section is very often
  // mounted-but-unfocused in the background while the user installs/uninstalls elsewhere.
  const bridgesQuery = useQuery({
    queryKey: ['bridgeSummaries'],
    queryFn: ({ signal }) => ds.getBridgeSummaries(signal),
  });
  const bridges = bridgesQuery.data ?? null;
  const error = bridgesQuery.isError ? (bridgesQuery.error as Error).message || 'Failed to load bridges' : null;

  const visible = bridges && hideNsfw ? bridges.filter((b) => !b.info.nsfw) : bridges;

  return (
    <SettingsSection title="Bridges" icon={<BridgesIcon color={theme.textSecondary} size={14} />}>
      {error ? (
        <RetryBlock message={error} onRetry={() => bridgesQuery.refetch()} />
      ) : !visible ? (
        <ThemedText type="small" themeColor="textSecondary">
          Loading…
        </ThemedText>
      ) : visible.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {bridges!.length === 0 ? 'No bridges installed.' : 'No bridges to show — NSFW-flagged bridges are hidden.'}
        </ThemedText>
      ) : (
        visible.map((b) => {
          const status = bridgeStatus(b);
          return (
            <SettingsRow
              key={b.info.id}
              label={b.info.name}
              description={status?.text}
              descriptionColor={status && (status.tone === 'warn' ? theme.badgeWarn : theme.badgeInfo)}
              onPress={() =>
                router.push({
                  pathname: '/bridge-settings',
                  params: {
                    bridgeId: b.info.id,
                    source: b.source,
                    ...(b.availableVersion ? { availableVersion: b.availableVersion } : {}),
                  },
                })
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

/** A visible-in-every-build log of asset-load failures (page images, thumbnails) that would
 *  otherwise fail silently with no way to inspect them off a device attached to Metro. Kept
 *  outside `DeveloperSection` (which is `__DEV__`-only) since it's meant to be usable in a real
 *  build too. */
function DiagnosticsSection() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <SettingsSection title="Diagnostics" icon={<DiagnosticsIcon color={theme.textSecondary} size={14} />}>
      <SettingsRow
        label="Failure log"
        description="Page/thumbnail load failures, kept on-device only"
        onPress={() => router.push('/diagnostics')}
      />
    </SettingsSection>
  );
}

/** Dev-build-only: lets local development iterate against mock data without a
 *  running backend, and shows which server real requests target. Stripped from
 *  real production builds by the `__DEV__` check above. */
function DeveloperSection() {
  const theme = useTheme();
  const [mockEnabled, setMockEnabled] = useMockDataToggle();
  const [apiBase] = useApiBase();
  return (
    <SettingsSection title="Developer" icon={<DeveloperIcon color={theme.textSecondary} size={14} />}>
      <SettingsRow
        label="Use mock data"
        description="Browse/Series/Reader render generated sample content instead of calling the API."
        right={<ThemedSwitch value={mockEnabled} onValueChange={setMockEnabled} />}
      />
      <SettingsRow label="Server" description={apiBase} descriptionSelectable />
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
  pressableCursor: {
    cursor: 'pointer',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 48,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  pickerBody: {
    gap: Spacing.three,
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
});
