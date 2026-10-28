import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChevronsUpDownIcon } from '@/components/icons/ui-icons';
import { SettingsSelectRow as OverlaySelectRow } from '@/components/settings/select-row-overlay';
import type { SettingsSelectRowProps } from '@/components/settings/select-row-shared';
import { settingsRowFrame } from '@/components/settings/settings-row';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';
import { testId } from '@/lib/test-id';

import { MenuAnchor } from '../../../modules/menu-anchor';

/**
 * The enum settings row as the system's: label and description leading, the current value and
 * `⌃⌄` trailing — iOS Settings' popup-row shape — and the whole row the trigger of a UIKit menu
 * of checkmarked options, each with its thumbnail where it has one. The row is drawn here, as
 * every other settings row is; the menu is the local `menu-anchor` module's, an invisible button
 * filling the row, which decodes the pictures itself at the screen's scale (pre-rendered to the
 * row's size and corner by `menu-thumb-files.ts`, since a menu draws a bitmap as it is). A system
 * menu has no second line per row, so an option's `description` is not shown here; the row's own
 * `description` still is.
 *
 * Without the module (a build from before it) the row is the overlay picker, as on Android.
 */
export function SettingsSelectRow<T extends string>(props: SettingsSelectRowProps<T>) {
  if (!MenuAnchor) return <OverlaySelectRow {...props} />;
  return <MenuSelectRow {...props} anchor={MenuAnchor} />;
}

function MenuSelectRow<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  heading,
  placeholder,
  anchor: Anchor,
}: SettingsSelectRowProps<T> & { anchor: NonNullable<typeof MenuAnchor> }) {
  const theme = useTheme();
  const thumbnails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const option of options) if (option.thumbnail) out[option.value] = option.thumbnail;
    return out;
  }, [options]);
  const files = useMenuThumbFiles(thumbnails, undefined, MENU_THUMB_RADIUS);
  const current = options.find((o) => o.value === value);
  const valueText = current?.label ?? (value || placeholder || '');
  const menu = options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(files[option.value] ? { image: files[option.value] } : {}),
    on: option.value === value,
  }));
  return (
    <View testID={testId('settings.select', label)} style={settingsRowFrame.row}>
      <View style={settingsRowFrame.text}>
        <ThemedText type="small" numberOfLines={1}>
          {label}
        </ThemedText>
        {description ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {description}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.rowValue}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.valueLabel}>
          {valueText}
        </ThemedText>
        <ChevronsUpDownIcon color={theme.textSecondary} size={14} />
      </View>
      <Anchor
        style={StyleSheet.absoluteFill}
        title={heading ?? label}
        label={heading ?? label}
        options={menu}
        onSelect={(e) => onChange(e.nativeEvent.value as T)}
      />
    </View>
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
  valueLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
});
