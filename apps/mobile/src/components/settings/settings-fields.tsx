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
import { useIsCompact } from '@/hooks/use-responsive';
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

/**
/**
 * Where a select row's current value goes when the row is too narrow to seat it beside the label.
 *
 * Both columns are one line and the row's height is FIXED (see settingsRowFrame — uniform height is
 * what makes a settings list read as a list), so a narrow viewport can't be answered by wrapping or
 * by growing the row. It can be answered by giving the value the second line instead of the
 * description: same two lines, same height, and the value gets the row's whole width rather than the
 * ~110pt left over beside a label. On a 360pt phone that is nearly three times the room, which is
 * the difference between "Show NSFW until app is closed" and "Show NSFW unti…".
 *
 * The DESCRIPTION is what gives way, and that is the right way round. It is static prose about what
 * the setting is; the value is live state, and the state is the thing a settings row exists to
 * report. The prose is also still reachable — the picker this row opens lists every option with its
 * own description, which is where you are going anyway if the row's answer isn't the one you wanted.
 * Title-over-summary is Material's shape for exactly this row, and iOS only gets away with keeping
 * both on one line because its values are short enough to be words.
 *
 * Deliberately keyed on the VIEWPORT rather than on how long this particular value happens to be:
 * a character-count threshold would be a guess about glyph widths that breaks in another language,
 * and would make two rows in the same list disagree about their own shape for no reason a reader
 * could see. Bridges declare their own setting labels, so arbitrary length is the normal case here,
 * not the exception.
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
  // See the note above `ValueColumnMinWidth`: on a narrow viewport the value takes the second line
  // and the description stands down, rather than the two of them splitting one line badly.
  const stacked = useIsCompact();
  const valueText = current?.label ?? (value || placeholder || '');
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
          {stacked ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {valueText}
            </ThemedText>
          ) : description ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {description}
            </ThemedText>
          ) : null}
        </View>
        {/* The chevron stays INSIDE the value column when there is one: `rowValue`'s own gap sits it
            4pt off the value, where the row's gap would push it 16 and read as a detached arrow. */}
        {stacked ? (
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        ) : (
          <View style={styles.rowValue}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.valueLabel}>
              {valueText}
            </ThemedText>
            <ChevronRightIcon color={theme.textSecondary} size={18} />
          </View>
        )}
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
