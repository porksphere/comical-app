import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { OverlayHeading, useKeyboardAvoidingInput, useOverlay } from '@/components/overlay/overlay';
import { SettingsSelectRow, SettingsToggleRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useApiBase } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyBackgroundDownloads } from '@/data/downloads/background';
import { kickDownloads } from '@/data/downloads/engine';
import { installDownloadProgress } from '@/data/downloads/events';
import { hydrateDownloadIndex } from '@/data/downloads/index-cache';
import { downloadPrefs$, useDownloadPrefs } from '@/data/downloads/prefs';
import { isEmbeddedRuntimeAvailable, swapDataSourceMode, useEmbeddedEnabled } from '@/data/embedded';
import { queryClient } from '@/data/query-client';
import { useNsfwMode, type NsfwMode } from '@/data/source';
import { useTheme, useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { experimental$, useNativeSearchStack } from '@/lib/experimental';
import { lightCards$, useLightCards } from '@/lib/perf-flags';

const NSFW_MODE_OPTIONS: SettingsOption<NsfwMode>[] = [
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

const THEME_OPTIONS: SettingsOption<ThemePreference>[] = [
  { value: 'system', label: 'System', description: 'Follow the device’s light or dark setting.' },
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
];

export default function GeneralSettingsScreen() {
  const contentPadding = useSettingsScrollPadding();
  const [nsfwMode, setNsfwMode] = useNsfwMode();
  const [themePref, setThemePref] = useThemePreference();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  const [apiBase, setApiBaseOverride] = useApiBase();
  const lightCards = useLightCards();
  const nativeSearchStack = useNativeSearchStack();
  const { wifiOnly, background } = useDownloadPrefs();
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
    swapDataSourceMode(enabled); // transport swap + the cache/downloads flushes (see apply-mode.ts)
  };

  const saveApiBase = (url: string | null) => {
    setApiBaseOverride(url);
    queryClient.clear(); // a different server's cached data can't be trusted (mirrors PERSIST_BUSTER)
    bumpDataEpoch(); // refetch useDataSource-backed screens against the new server
    installDownloadProgress(); // the SSE stream targets the new server
    void hydrateDownloadIndex(); // remote /file URLs embed the server base — rebuild them
  };

  return (
    <ThemedView style={styles.container}>
      <TopBar title="General" />
      <ScrollView contentContainerStyle={[styles.content, contentPadding]}>
        {/* One unheadered list. "APPEARANCE" over a row already called Appearance, and "CONTENT"
            over one called NSFW content, said nothing the row didn't — every row here carries its
            own title and a line explaining it. */}
        <SettingsSection>
          <SettingsSelectRow
            label="Appearance"
            description="Light or dark theme."
            value={themePref}
            options={THEME_OPTIONS}
            onChange={setThemePref}
          />
          <SettingsToggleRow
            label="Lightweight cards"
            description="Drop cover animations for smoother scrolling."
            value={lightCards}
            onChange={(v) => lightCards$.light.set(v)}
          />
          <SettingsSelectRow
            label="NSFW content"
            description="Whether NSFW-flagged bridges are visible."
            value={nsfwMode}
            options={NSFW_MODE_OPTIONS}
            onChange={setNsfwMode}
          />
          {embeddedAvailable && (
            <SettingsToggleRow
              label="Run bridges on this device"
              description="Fetch and read on-device, with no server."
              value={onDevice}
              onChange={toggleOnDevice}
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
          {/* The download policies gate the DEVICE engine — meaningless when a remote server owns
              the downloads (it paces itself), so they only appear while running on-device. They used
              to live on the Downloads page but cluttered the queue. */}
          {embeddedActive && (
            <SettingsToggleRow
              label="Download over Wi-Fi only"
              description="Hold downloads until you're on Wi-Fi."
              value={wifiOnly}
              onChange={(v) => {
                downloadPrefs$.wifiOnly.set(v);
                // Turning the gate off (or changing it) should resume held-back downloads right away.
                kickDownloads();
              }}
            />
          )}
          {embeddedActive && (
            <SettingsToggleRow
              label="Download in background"
              description="Continue in OS-granted windows after leaving the app."
              value={background}
              onChange={(v) => {
                downloadPrefs$.background.set(v);
                applyBackgroundDownloads(v);
              }}
            />
          )}
        </SettingsSection>
        {/* TEMPORARY — a live A/B for one open question, not a feature. Deletable in one commit
            along with lib/experimental.ts, app/series/search.tsx and the branch in
            useOpenSearchLayer; see that module for what to compare. */}
        <SettingsSection>
          <SettingsToggleRow
            label="Native nested stack"
            description="Experiment: a series' tag search and any series opened from it become pushed pages instead of in-screen layers. Watch whether the page underneath stays visible while one is swiped away."
            value={nativeSearchStack}
            onChange={(v) => experimental$.nativeSearchStack.set(v)}
          />
        </SettingsSection>
      </ScrollView>
    </ThemedView>
  );
}

/** Sheet/popover form for editing the remote-server override (see its trigger row above) — mirrors
 *  `AddRegistryForm`'s text-input-plus-save shape in `registries.tsx`. */
function RemoteServerForm({ currentUrl, onSave }: { currentUrl: string; onSave: (url: string | null) => void }) {
  const theme = useTheme();
  const { closeTop } = useOverlay();
  const keyboardAvoiding = useKeyboardAvoidingInput();
  const inputRef = useRef<TextInput>(null);
  const [url, setUrl] = useState(currentUrl);

  return (
    <View style={styles.confirmBody}>
      <OverlayHeading>Remote server</OverlayHeading>
      <ThemedText type="small" themeColor="textSecondary">
        The Comical server this app talks to when not running bridges on this device.
      </ThemedText>
      <TextInput
        ref={inputRef}
        testID="settings.general.remote-server.input"
        value={url}
        onChangeText={setUrl}
        onFocus={() => keyboardAvoiding.onFocus(inputRef.current)}
        onBlur={keyboardAvoiding.onBlur}
        placeholder="http://localhost:3100"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <View style={styles.confirmActions}>
        <Pressable
          testID="settings.general.remote-server.reset"
          onPress={() => {
            onSave(null);
            closeTop();
          }}
          style={styles.confirmBtn}>
          <ThemedText type="smallBold">Reset to default</ThemedText>
        </Pressable>
        <Pressable
          testID="settings.general.remote-server.save"
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    // Spacing BETWEEN sections (SettingsSection no longer carries a top margin — see settings-row).
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
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
});
