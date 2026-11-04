import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { MeasuredHeading, OptionList, useAnchoredOverlay, useOverlay } from '@/components/overlay/overlay';
import type { SettingsOption } from '@/components/settings/select-row-shared';
import { settingsRowFrame } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight, hapticSelection } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

export type MultiSelectProps = {
  label: string;
  description?: string;
  value: readonly string[];
  options: readonly SettingsOption<string>[];
  onChange: (value: string[]) => void;
  testID: string;
};

/** A multi-select enum as a settings row: label on the left, a comma-joined summary + chevron on
 *  the right, tapping opens the checklist (which stays open as you toggle options). The checklist
 *  is the overlay's on every platform: a system menu can't hold several checks. */
export function MultiSelectRow({ label, description, value, options, onChange, testID }: MultiSelectProps) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <MultiSelectPicker label={label} value={value} options={options} onChange={onChange} testID={testID} />);
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
          {description && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {description}
            </ThemedText>
          )}
        </View>
        <View style={styles.rowValue}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.summary}>
            {multiSummary(value, options)}
          </ThemedText>
          <ChevronRightIcon color={theme.textSecondary} size={18} />
        </View>
      </View>
    </Pressable>
  );
}

/** The chosen options' labels, comma-joined, on the row. */
export function multiSummary(value: readonly string[], options: readonly SettingsOption<string>[]): string {
  if (value.length === 0) return 'None selected';
  return options
    .filter((o) => value.includes(o.value))
    .map((o) => o.label)
    .join(', ');
}

/** The checklist, in the overlay: the toggles are live, and dismissing commits. */
export function MultiSelectPicker({ label, value, options, onChange, testID }: Omit<MultiSelectProps, 'description'>) {
  const { closeTop } = useOverlay();
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <View style={styles.body}>
      <MeasuredHeading>{label}</MeasuredHeading>
      <OptionList>
        {options.map((opt) => (
          <Option
            key={opt.value}
            testID={testId(testID, 'option', opt.value)}
            label={opt.label}
            on={value.includes(opt.value)}
            onPress={() => toggle(opt.value)}
          />
        ))}
        {/* A "Done" affordance isn't needed — dismissing the sheet commits; the toggles are live. */}
        {value.length > 0 && (
          <Pressable testID={testId(testID, 'done')} onPress={closeTop} style={styles.pressableCursor}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold" style={{ color: '#3478F6' }}>
                Done
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      </OptionList>
    </View>
  );
}

function Option({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      android_ripple={{ color: theme.backgroundSelected }}
      style={styles.pressableCursor}>
      <ThemedView type={hovered ? 'backgroundSelected' : 'backgroundElement'} style={styles.row}>
        <ThemedText>{label}</ThemedText>
        <View style={[styles.check, on && { borderColor: theme.accent, backgroundColor: theme.accent }]} />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
    minWidth: 0,
  },
  summary: {
    flexShrink: 1,
    minWidth: 0,
  },
  // No `flex: 1` (see `sheetBody` in overlay.tsx) — hugs its MeasuredHeading/OptionList content.
  body: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  pressableCursor: {
    cursor: 'pointer',
  },
});
