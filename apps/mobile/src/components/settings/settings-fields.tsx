import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BridgeThumb } from '@/components/bridge-thumb';
import { ChevronRightIcon } from '@/components/icons/ui-icons';
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
}: {
  label: string;
  /** Static one-line description under the label (the current value already shows on the right). */
  description?: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onChange: (value: T) => void;
  /** Heading for the picker sheet. Defaults to `label`. */
  heading?: string;
}) {
  const theme = useTheme();
  const { ref, openAt } = useAnchoredOverlay();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const current = options.find((o) => o.value === value);
  return (
    <Pressable
      ref={ref}
      onPress={() => {
        hapticImpactLight();
        openAt(() => <SelectPicker heading={heading ?? label} value={value} options={options} onChange={onChange} />);
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
            {current?.label ?? value}
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
}: {
  heading: string;
  value: T;
  options: readonly SettingsOption<T>[];
  onChange: (value: T) => void;
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
      right={right ?? <ThemedSwitch value={value} onValueChange={onChange} />}
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
