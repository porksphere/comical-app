import { Pressable, StyleSheet, View } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { MeasuredHeading, OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import { BridgeThumbSize } from '@/components/selector';
import type { SettingsOption, SettingsSelectRowProps } from '@/components/settings/select-row-shared';
import { settingsRowFrame } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useIsCompact } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

/**
 * An enum settings row where there is no system menu: label + current value on the row, an
 * anchored option-list picker (each option with an optional description) on tap — the picker
 * style the app standardizes on. iOS renders `select-row.ios.tsx` instead.
 *
 * Where the row's current value goes when the row is too narrow to seat it beside the label:
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

export function SettingsSelectRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  heading,
  placeholder,
}: SettingsSelectRowProps<T>) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const current = options.find((o) => o.value === value);
  const base = testId('settings.select', label);
  // See the docblock: on a narrow viewport the value takes the second line and the description
  // stands down, rather than the two of them splitting one line badly.
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
      <View style={[settingsRowFrame.row, hovered && { backgroundColor: theme.backgroundSelected }]}>
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
      <MeasuredHeading>{heading}</MeasuredHeading>
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
  // No `flex: 1` (see `sheetBody` in overlay.tsx) — hugs its MeasuredHeading/OptionList content.
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
