import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import { ChevronRightIcon, EyeIcon, EyeOffIcon } from '@/components/icons/ui-icons';
import { MeasuredHeader, OptionList, OverlayHeading, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { BridgeThumbSize } from '@/components/selector';
import { settingsRowFrame, SettingsRow } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

/**
 * The two standard settings CONTROL rows, factored out of `settings-general`'s Appearance/NSFW rows so
 * every settings screen presents the same shapes:
 *   - `SettingsSelectRow` — an enum choice: label + current value on the row, an anchored option-list
 *     picker (each option with an optional description) on tap. The picker style the app standardizes on.
 *   - `SettingsToggleRow` — a boolean: label + a `ThemedSwitch`.
 *
 * Both are thin over `SettingsRow`/`settingsRowFrame`, so they inherit the exact row geometry, gutter
 * escape, hover/press highlight, and one-line-description rule as every other settings row.
 */

/** One choice in a `SettingsSelectRow`. `description` shows in the picker (not on the row); an optional
 *  `thumbnail` URL renders a leading image (e.g. a bridge icon). */
export type SettingsOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  thumbnail?: string;
};

export function SettingsSelectRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  heading,
  placeholder,
}: {
  label: string;
  /** Static one-line description under the label (the current value already shows on the right). */
  description?: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onChange: (value: T) => void;
  /** Heading for the picker sheet. Defaults to `label`. */
  heading?: string;
  /** Muted text shown on the right when `value` matches no option (nothing chosen yet). */
  placeholder?: string;
}) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const current = options.find((o) => o.value === value);
  const base = testId('settings.select', label);
  return (
    <Pressable
      testID={base}
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <SelectPicker heading={heading ?? label} value={value} options={options} onChange={onChange} testID={base} />);
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <View style={[settingsRowFrame.row, settingsRowFrame.escape, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <View style={settingsRowFrame.text}>
          <ThemedText type="small" numberOfLines={1}>
            {label}
          </ThemedText>
          {description && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {description}
            </ThemedText>
          )}
        </View>
        <View style={styles.rowValue}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.valueLabel}>
            {current?.label ?? (value || placeholder || '')}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      </View>
    </Pressable>
  );
}

function SelectPicker<T extends string>({
  heading,
  value,
  options,
  onChange,
  testID,
}: {
  heading: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onChange: (value: T) => void;
  testID: string;
}) {
  const { closeTop } = useOverlay();
  const theme = useTheme();
  return (
    <View style={styles.pickerBody}>
      <MeasuredHeader>
        <OverlayHeading>{heading}</OverlayHeading>
      </MeasuredHeader>
      <OptionList>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            testID={testId(testID, 'option', opt.value)}
            onPress={() => {
              hapticSelection();
              onChange(opt.value);
              closeTop();
            }}
            android_ripple={{ color: theme.backgroundSelected }}
            style={styles.pressableCursor}>
            <ThemedView type="backgroundElement" style={styles.pickerRow}>
              {opt.thumbnail !== undefined && (
                <BridgeThumb uri={opt.thumbnail || undefined} label={opt.label} size={BridgeThumbSize} style={styles.thumb} />
              )}
              <View style={settingsRowFrame.text}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {opt.label}
                </ThemedText>
                {opt.description && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {opt.description}
                  </ThemedText>
                )}
              </View>
              <View style={[styles.check, opt.value === value && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
            </ThemedView>
          </Pressable>
        ))}
      </OptionList>
    </View>
  );
}

/**
 * A string settings row: label on the left, an inline right-aligned text field on the right. Edits
 * apply live via `onChange` (there's no separate save step), matching how the enum/toggle rows commit
 * immediately. `placeholder` shows (muted) when the value is empty — a good spot for an inherited /
 * default value the blank field falls back to.
 */
export function SettingsTextRow({
  label,
  description,
  value,
  placeholder,
  onChange,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  secureTextEntry,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  /** Mask the value (a secret / password). A reveal (eye) button is shown to toggle visibility. */
  secureTextEntry?: boolean;
}) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const base = testId('settings.text', label);
  return (
    <View style={[settingsRowFrame.row, settingsRowFrame.escape]}>
      <View style={styles.textRowLabel}>
        <ThemedText type="small" numberOfLines={1}>
          {label}
        </ThemedText>
        {description && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {description}
          </ThemedText>
        )}
      </View>
      <View style={styles.textRowRight}>
        <TextInput
          testID={testId(base, 'input')}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // Clear the placeholder while editing (it's just noise once you're typing); it returns on blur.
          placeholder={focused ? '' : placeholder}
          placeholderTextColor={theme.textSecondary}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          // Masked while not revealed. `secureTextEntry` also disables autofill/suggestions on native.
          secureTextEntry={secureTextEntry && !revealed}
          returnKeyType="done"
          style={[styles.textRowInput, { color: theme.text }]}
        />
        {/* Reveal toggle only once there's something to reveal — an empty secret has nothing to show. */}
        {secureTextEntry && value.length > 0 && (
          <Pressable
            testID={testId(base, 'reveal')}
            onPress={() => setRevealed((r) => !r)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide' : 'Show'}
            style={styles.revealBtn}>
            {revealed ? (
              <EyeOffIcon color={theme.textSecondary} size={18} />
            ) : (
              <EyeIcon color={theme.textSecondary} size={18} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** A boolean settings row: label (+ optional one-line description) with a `ThemedSwitch` on the right.
 *  A thin, named wrapper over `SettingsRow` so every toggle in the app is spelled the same way. */
export function SettingsToggleRow({
  label,
  description,
  value,
  onChange,
  right,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** Escape hatch to swap the control (rarely needed); defaults to a `ThemedSwitch`. */
  right?: ReactNode;
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      right={right ?? <ThemedSwitch testID={testId('settings.toggle', label)} value={value} onValueChange={onChange} />}
    />
  );
}

const styles = StyleSheet.create({
  pressableCursor: {
    cursor: 'pointer',
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    // Let a long value label shrink/truncate instead of shoving the chevron off the row.
    flexShrink: 1,
    minWidth: 0,
  },
  valueLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  // String row: label hugs its content on the left (shrinking if long); the input fills the rest and
  // right-aligns, so the field reads like the value column of the select/toggle rows.
  textRowLabel: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  // Holds the input (and, for secrets, the reveal button) in the row's value column.
  textRowRight: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  textRowInput: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 16,
    paddingVertical: 0,
  },
  revealBtn: {
    cursor: 'pointer',
  },
  // No `flex: 1` (see `sheetBody` in overlay.tsx) — hugs its MeasuredHeader/OptionList content.
  pickerBody: {
    gap: Spacing.three,
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
  thumb: {
    borderRadius: 6,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(128,128,128,0.5)',
  },
});
