import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { EyeIcon, EyeOffIcon } from '@/components/icons/ui-icons';
import { singleLineInput } from '@/components/input-style';
import { settingsRowFrame, SettingsRow } from '@/components/settings/settings-row';
import { ThemedSwitch } from '@/components/themed-switch';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { testId } from '@/lib/test-id';

export { SettingsSelectRow } from '@/components/settings/select-row';
export type { SettingsOption } from '@/components/settings/select-row-shared';

/**
 * The standard settings CONTROL rows, factored out of `settings-general`'s Appearance/NSFW rows so
 * every settings screen presents the same shapes:
 *   - `SettingsSelectRow` — an enum choice (`select-row.tsx`, re-exported here): label + current
 *     value on the row; the system menu on iOS, an anchored option-list picker elsewhere.
 *   - `SettingsToggleRow` — a boolean: label + a `ThemedSwitch`.
 *
 * Both are thin over `SettingsRow`/`settingsRowFrame`, so they inherit the exact row geometry,
 * hover/press highlight, and one-line-description rule as every other settings row.
 */

/** The narrowest a text row's value column is ever allowed to get, whatever is on its left.
 *
 * This is a hard guarantee, not a hint: a bridge declares its own setting labels and descriptions, so
 * a long one ("Paste the `cf_clearance` cookie from your browser…") must not be able to squeeze the
 * field it's describing off the row. It could — the label column sized to its content while the value
 * column had a zero flex basis, so the shrink pass (which weights by basis) handed the label 100% of
 * the row and collapsed the input to 0pt wide, leaving an api-key/cookie setting literally
 * un-enterable. The label ellipsizes at one line anyway; the field is the part you can't do without.
 */
const ValueColumnMinWidth = 132;

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
    <View style={settingsRowFrame.row}>
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
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** Escape hatch to swap the control (rarely needed); defaults to a `ThemedSwitch`. */
  right?: ReactNode;
  /** See `SettingsRow`'s `disabled`: greyed out, never hidden. */
  disabled?: boolean;
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      disabled={disabled}
      right={
        right ?? (
          <ThemedSwitch testID={testId('settings.toggle', label)} value={value} onValueChange={onChange} disabled={disabled} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  // String row: label hugs its content on the left (shrinking and ellipsizing if long); the input
  // takes the rest and right-aligns, so the field reads like the value column of the select/toggle
  // rows. The label column is the ONLY shrinkable one — see `ValueColumnMinWidth`.
  textRowLabel: {
    flexShrink: 1,
    minWidth: 0,
    // Never more than a bit over half the row, so a wide (desktop) row spends its extra width on the
    // field rather than on ever more of a description that's clamped to one line anyway. On a phone
    // `ValueColumnMinWidth` is already the tighter of the two limits, so this changes nothing there.
    maxWidth: '60%',
    gap: Spacing.half,
  },
  // Holds the input (and, for secrets, the reveal button) in the row's value column. Grows into
  // whatever the label doesn't take, but never shrinks below `ValueColumnMinWidth`: `flexShrink: 0`
  // over a non-zero basis is what forces a too-wide label/description to absorb the overflow itself.
  textRowRight: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: ValueColumnMinWidth,
    minWidth: ValueColumnMinWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  textRowInput: {
    ...singleLineInput(16),
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    paddingVertical: 0,
  },
  revealBtn: {
    cursor: 'pointer',
  },
});
