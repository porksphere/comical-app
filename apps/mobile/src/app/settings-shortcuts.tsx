import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { openConfirm } from '@/components/confirm-popup';
import { UndoIcon } from '@/components/icons/ui-icons';
import { setKeyZoomSpeed, useKeyZoomSpeed } from '@/components/reader/desktop-zoom';
import { RangeSlider } from '@/components/settings/range-slider';
import { SettingsSelectRow, type SettingsOption } from '@/components/settings/settings-fields';
import { SettingsRow, SettingsSection } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { showToast } from '@/components/toast';
import { TopBar } from '@/components/top-bar';
import { MaxContentWidth, SettingsCardInset, Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { KEY_SPEED_MAX, KEY_SPEED_MIN, KEY_SPEED_STEP, setKeyPanSpeed, useKeyPanSpeed } from '@/lib/key-hold';
import {
  captureChord,
  KEY_ACTIONS,
  resetAllKeyBindings,
  resetKeyBinding,
  setKeyBinding,
  setKeyOverrides,
  useKeyOverrides,
} from '@/lib/keybindings';
import {
  bindingsFor,
  chordConflicts,
  chordLabel,
  KEY_SCOPE_LABELS,
  matchesPreset,
  MIRRORED_KEYS,
  type KeyAction,
  type KeyChord,
  type KeyOverrides,
  type KeyScope,
} from '@/lib/keymap';
import { scrollbarInset } from '@/lib/scrollbar-inset';

const MAC = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

// Empty is your own: no layout matches, which is what shows the placeholder.
type Layout = 'left' | 'right' | '';

const LAYOUT_OPTIONS: SettingsOption<Layout>[] = [
  { value: 'left', label: 'Left hand', description: 'WASD to move, with everything else around it.' },
  { value: 'right', label: 'Right hand', description: 'The same layout six keys over: IJKL to move.' },
];

const SCOPES: KeyScope[] = ['global', 'lists', 'reader'];

const RESET_SIZE = 24;

const actionsIn = (scope: KeyScope) => (Object.keys(KEY_ACTIONS) as KeyAction[]).filter((a) => KEY_ACTIONS[a].scope === scope);

const layoutOf = (overrides: KeyOverrides): Layout =>
  matchesPreset(overrides, {}) ? 'left' : matchesPreset(overrides, MIRRORED_KEYS) ? 'right' : '';

function rebind(action: KeyAction, chord: KeyChord, overrides: KeyOverrides): void {
  const clashes = chordConflicts(action, chord, overrides);
  const fixed = clashes.find((a) => 'fixed' in KEY_ACTIONS[a]);
  if (fixed) return showToast(`${chordLabel(chord, MAC)} is kept for ${KEY_ACTIONS[fixed].label}`);
  if (!clashes.length) return setKeyBinding(action, chord);
  const names = clashes.map((a) => KEY_ACTIONS[a].label).join(', ');
  openConfirm({
    title: `${chordLabel(chord, MAC)} is already ${names}`,
    message: `Use it for ${KEY_ACTIONS[action].label} instead? ${names} will lose it.`,
    confirmLabel: 'Use it',
    tone: 'primary',
    onConfirm: () => setKeyBinding(action, chord, clashes),
  });
}

export default function KeyboardShortcutsScreen() {
  const contentPadding = useSettingsScrollPadding(MaxContentWidth);
  const overrides = useKeyOverrides();
  const panSpeed = useKeyPanSpeed();
  const zoomSpeed = useKeyZoomSpeed();
  const [capturing, setCapturing] = useState<KeyAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    return captureChord((chord) => {
      setCapturing(null);
      if (chord) rebind(capturing, chord, overrides);
    });
  }, [capturing, overrides]);

  const changed = Object.keys(overrides).length > 0;

  return (
    <ThemedView style={styles.container}>
      <TopBar title="Keyboard shortcuts" />
      <ScrollView style={scrollbarInset(contentPadding.paddingTop)} contentContainerStyle={[styles.content, contentPadding]}>
        <SettingsSection
          title="Layout"
          footer="Every key sits under one hand, so the other is free. Press a shortcut below to give it a different key; Esc cancels.">
          <SettingsSelectRow
            label="Keys for"
            value={layoutOf(overrides)}
            options={LAYOUT_OPTIONS}
            placeholder="Your own"
            onChange={(v) => setKeyOverrides(v === 'right' ? MIRRORED_KEYS : {})}
          />
          <SettingsRow testID="shortcuts.reset-all" label="Reset all shortcuts" disabled={!changed} onPress={resetAllKeyBindings} />
        </SettingsSection>
        {SCOPES.map((scope) => (
          <SettingsSection
            key={scope}
            title={KEY_SCOPE_LABELS[scope]}
            footer={scope === 'reader' ? 'The speeds are the keys’ alone: the mouse, the wheel and the zoom buttons keep their own pace.' : undefined}>
            {actionsIn(scope).map((action) => (
              <ShortcutRow
                key={action}
                action={action}
                keys={bindingsFor(action, overrides)}
                changed={!!overrides[action]}
                capturing={capturing === action}
                onPress={() => setCapturing((c) => (c === action ? null : action))}
              />
            ))}
            {scope === 'reader' ? (
              <>
                <SettingsRow
                  testID="shortcuts.pan-speed"
                  label="Pan speed"
                  right={<SpeedSlider value={panSpeed} onChange={setKeyPanSpeed} testIdPrefix="shortcuts.pan-speed" />}
                />
                <SettingsRow
                  testID="shortcuts.zoom-speed"
                  label="Zoom speed"
                  right={<SpeedSlider value={zoomSpeed} onChange={setKeyZoomSpeed} testIdPrefix="shortcuts.zoom-speed" />}
                />
              </>
            ) : null}
          </SettingsSection>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

function ShortcutRow({
  action,
  keys,
  changed,
  capturing,
  onPress,
}: {
  action: KeyAction;
  keys: readonly KeyChord[];
  changed: boolean;
  capturing: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const def = KEY_ACTIONS[action];
  const fixed = 'fixed' in def;
  const resettable = changed && !capturing;
  // The reset sits over the row rather than in it: the row is itself a button on web, and a button
  // can't hold another.
  return (
    <View>
      <SettingsRow
        testID={`shortcuts.${action}`}
        label={def.label}
        description={'hint' in def ? def.hint : undefined}
        onPress={fixed ? undefined : onPress}
        right={
          <View style={styles.right}>
            {capturing ? (
              <ThemedText type="small" themeColor="textSecondary">
                Press a key…
              </ThemedText>
            ) : keys.length ? (
              keys.map((c) => <KeyCap key={chordLabel(c)} label={chordLabel(c, MAC)} />)
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                None
              </ThemedText>
            )}
            {resettable ? <View style={styles.resetSpace} /> : null}
          </View>
        }
      />
      {resettable ? (
        <Pressable
          testID={`shortcuts.${action}.reset`}
          accessibilityRole="button"
          accessibilityLabel={`Reset ${def.label}`}
          onPress={() => resetKeyBinding(action)}
          hitSlop={6}
          style={styles.reset}>
          <UndoIcon color={theme.textSecondary} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

function KeyCap({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.cap, { borderColor: theme.barHairline, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small">{label}</ThemedText>
    </View>
  );
}


/** One keyboard speed over the shared range (lib/key-hold), read as a multiple of the default. */
function SpeedSlider({ value, onChange, testIdPrefix }: { value: number; onChange: (v: number) => void; testIdPrefix: string }) {
  return (
    <RangeSlider
      value={value}
      min={KEY_SPEED_MIN}
      max={KEY_SPEED_MAX}
      step={KEY_SPEED_STEP}
      onChange={onChange}
      format={(v) => `${v}×`}
      testIdPrefix={testIdPrefix}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  cap: {
    minWidth: 28,
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resetSpace: {
    width: RESET_SIZE,
  },
  reset: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: SettingsCardInset,
    width: RESET_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
