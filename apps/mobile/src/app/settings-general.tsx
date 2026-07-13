import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronRightIcon } from '@/components/icons/ui-icons';
import {
  MeasuredHeader,
  OptionList,
  OverlayHeading,
  useAnchoredOverlay,
  useKeyboardAvoidingInput,
  useOverlay,
} from '@/components/overlay/overlay';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TopBar, useTopBarInset } from '@/components/top-bar';
import { BarContentGap, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useApiBase } from '@/data/api';
import { bumpDataEpoch } from '@/data/data-epoch';
import { applyEmbeddedMode, isEmbeddedRuntimeAvailable, useEmbeddedEnabled } from '@/data/embedded';
import { queryClient } from '@/data/query-client';
import { useNsfwMode, type NsfwMode } from '@/data/source';
import { useTheme, useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { useHovered } from '@/hooks/use-hovered';
import { lightCards$, useLightCards } from '@/lib/perf-flags';
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

const THEME_OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follow the device’s light or dark setting.' },
  { value: 'light', label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
];

function themePreferenceSummary(pref: ThemePreference): string {
  return THEME_OPTIONS.find((o) => o.value === pref)?.label ?? 'System';
}

export default function GeneralSettingsScreen() {
  const insets = useSafeAreaInsets();
  const topBarInset = useTopBarInset();
  const [nsfwMode, setNsfwMode] = useNsfwMode();
  const [themePref, setThemePref] = useThemePreference();
  const [onDevice, setOnDevice] = useEmbeddedEnabled();
  const [apiBase, setApiBaseOverride] = useApiBase();
  const lightCards = useLightCards();
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
    <ThemedView style={styles.container}>
      <TopBar title="General" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // The TopBar is an absolute overlay, so the content pads past it (and scrolls under its frost).
          { paddingTop: topBarInset + BarContentGap, paddingBottom: BottomTabInset + insets.bottom + Spacing.five },
        ]}>
        <SettingsSection title="Appearance">
          <AppearanceRow preference={themePref} onChange={setThemePref} />
          <SettingsRow
            label="Lightweight cards"
            description="Drops the shrink animation and cross-fade from covers and page thumbnails for smoother scrolling."
            right={<ThemedSwitch value={lightCards} onValueChange={(v) => lightCards$.light.set(v)} />}
          />
        </SettingsSection>

        <SettingsSection title="Content">
          <NsfwModeRow mode={nsfwMode} onChange={setNsfwMode} />
        </SettingsSection>

        <SettingsSection title="Where bridges run">
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

/** Row + anchored picker for the 3-way appearance preference (System/Light/Dark),
 *  mirroring `NsfwModeRow` below — a picker rather than a switch since it's a
 *  three-way choice (see `useThemePreference` in `hooks/use-theme.ts`). */
function AppearanceRow({ preference, onChange }: { preference: ThemePreference; onChange: (pref: ThemePreference) => void }) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <AppearancePicker preference={preference} onChange={onChange} />);
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <View style={[styles.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <View style={styles.rowText}>
          <ThemedText type="small">Appearance</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {THEME_OPTIONS.find((o) => o.value === preference)?.description}
          </ThemedText>
        </View>
        <View style={styles.rowValue}>
          <ThemedText type="small" themeColor="textSecondary">
            {themePreferenceSummary(preference)}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      </View>
    </Pressable>
  );
}

function AppearancePicker({ preference, onChange }: { preference: ThemePreference; onChange: (pref: ThemePreference) => void }) {
  const { closeTop } = useOverlay();
  const theme = useTheme();
  return (
    <View style={styles.pickerBody}>
      <MeasuredHeader>
        <OverlayHeading>Appearance</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {THEME_OPTIONS.map((opt) => (
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
              <View style={[styles.check, opt.value === preference && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
            </ThemedView>
          </Pressable>
        ))}
      </OptionList>
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
  const theme = useTheme();
  return (
    <View style={styles.pickerBody}>
      <MeasuredHeader>
        <OverlayHeading>NSFW content</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
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
  // No `flex: 1` (see `sheetBody` in overlay.tsx for why) — this just hugs
  // its `MeasuredHeader`/`OptionList` content, both of which already size
  // themselves to a real number.
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
