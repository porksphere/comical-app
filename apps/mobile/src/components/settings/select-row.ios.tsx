import { Host, HStack, Image, Label, Menu, Picker, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  menuIndicator,
  menuOrder,
  menuStyle,
  pickerStyle,
  shapes,
  tag,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import type { SettingsSelectRowProps } from '@/components/settings/select-row-shared';
import { SettingsCardInset, SettingsRowHeight, Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useMenuThumbFiles } from '@/lib/menu-thumb-files';
import { testId } from '@/lib/test-id';

/**
 * The enum settings row as the system's: the whole row is a SwiftUI `Menu` trigger — label and
 * description leading, the current value and `chevron.up.chevron.down` trailing, iOS Settings'
 * popup-row shape — opening a UIKit menu of checkmarked options (a `Picker` inline in the menu),
 * each with its thumbnail where it has one (pre-rendered at the row's size by
 * `menu-thumb-files.ts`, since the menu draws it as-is). A system menu has no second line per
 * row, so an option's `description` is not shown here; the row's own `description` still is.
 *
 * The Host is given the settings row's frame outright (as `RangeSlider.ios` is) rather than
 * measured, so the row never jumps as SwiftUI lays out, and `contentShape` makes the empty middle
 * of the row part of the trigger — a tap anywhere on the row opens the menu.
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
  const scheme = useActiveColorScheme();
  const thumbnails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const option of options) if (option.thumbnail) out[option.value] = option.thumbnail;
    return out;
  }, [options]);
  const files = useMenuThumbFiles(thumbnails);
  const current = options.find((o) => o.value === value);
  const valueText = current?.label ?? (value || placeholder || '');
  return (
    <Host colorScheme={scheme} style={styles.host} testID={testId('settings.select', label)} ignoreSafeArea="all">
      <Menu
        label={
          <HStack
            spacing={Spacing.three}
            alignment="center"
            modifiers={[frame({ minHeight: SettingsRowHeight }), contentShape(shapes.rectangle(), 'interaction')]}>
            <VStack alignment="leading" spacing={Spacing.half}>
              <Text modifiers={[font(ROW_TYPE), foregroundStyle(theme.text), lineLimit(1), truncationMode('tail')]}>{label}</Text>
              {description ? (
                <Text modifiers={[font(ROW_TYPE), foregroundStyle(theme.textSecondary), lineLimit(1), truncationMode('tail')]}>
                  {description}
                </Text>
              ) : null}
            </VStack>
            <Spacer />
            <Text modifiers={[font(ROW_TYPE), foregroundStyle(theme.textSecondary), lineLimit(1), truncationMode('tail')]}>
              {valueText}
            </Text>
            <Image systemName="chevron.up.chevron.down" modifiers={[font(CHEVRON_TYPE), foregroundStyle(theme.textSecondary)]} />
          </HStack>
        }
        modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), menuOrder('fixed'), accessibilityLabel(heading ?? label)]}>
        <Picker label={heading ?? label} selection={value} onSelectionChange={(next) => onChange(next as T)} modifiers={[pickerStyle('inline')]}>
          {options.map((option) => {
            const file = files[option.value];
            if (file) return <Label key={option.value} title={option.label} icon={<Image uiImage={file} />} modifiers={[tag(option.value)]} />;
            return (
              <Text key={option.value} modifiers={[tag(option.value)]}>
                {option.label}
              </Text>
            );
          })}
        </Picker>
      </Menu>
    </Host>
  );
}

const ROW_TYPE = { size: 14 } as const;
const CHEVRON_TYPE = { size: 12, weight: 'semibold' } as const;

const styles = StyleSheet.create({
  host: {
    height: SettingsRowHeight,
    paddingHorizontal: SettingsCardInset,
    alignSelf: 'stretch',
  },
});
