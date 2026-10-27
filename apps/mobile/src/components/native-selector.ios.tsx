import { Button, Host, HStack, Image, Label, Menu, Picker, Text } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  menuIndicator,
  menuOrder,
  menuStyle,
  pickerStyle,
  tag,
  truncationMode,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import type { NativeSelectorProps, SystemSymbol } from '@/components/native-selector';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';
import { useMenuThumbFiles } from '@/lib/menu-thumb-files';

/**
 * The bar's selector as the system's: a SwiftUI `Menu` whose trigger is the custom bar's
 * `name ▾` at the bar's title type, opening a UIKit menu of checkmarked rows — a `Picker` inline
 * in the menu — each with its tile, and any `actions` after them. Hosted inside the RN title
 * row (`NativeBarTitle`) beside the RN thumbnail, so the cluster keeps its NSFW hold target and
 * its place at the bar's leading edge.
 *
 * A row's picture is a `Label` icon, which the menu takes as the row's image; the file it is read
 * from is pre-rendered at the row's size (`menu-thumb-files.ts`), since the menu draws it as-is.
 * A row without one shows an SF Symbol: the option's initial in a filled square, standing in for
 * the letter tile the overlay menus draw.
 */
export function NativeSelector({
  title,
  value,
  options,
  onChange,
  labels,
  thumbnails,
  sources,
  tiles,
  glyphs,
  actions,
  maxWidth,
  testID,
}: NativeSelectorProps) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const files = useMenuThumbFiles(thumbnails, sources);
  const current = labels?.[value] ?? value;
  return (
    <Host matchContents colorScheme={scheme} style={styles.host} testID={testID}>
      <Menu
        label={
          <HStack spacing={3} alignment="center">
            <Text
              modifiers={[
                font(BAR_TYPE),
                foregroundStyle(theme.text),
                lineLimit(1),
                truncationMode('tail'),
                ...(maxWidth ? [frame({ maxWidth })] : []),
              ]}>
              {current}
            </Text>
            <Image systemName="chevron.down" modifiers={[font(CARET_TYPE), foregroundStyle(theme.textSecondary)]} />
          </HStack>
        }
        modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), menuOrder('fixed'), accessibilityLabel(title)]}>
        <Picker label={title} selection={value} onSelectionChange={onChange} modifiers={[pickerStyle('inline')]}>
          {options.map((option) => {
            const label = labels?.[option] ?? option;
            const file = files[option];
            if (file) return <Label key={option} title={label} icon={<Image uiImage={file} />} modifiers={[tag(option)]} />;
            if (tiles) {
              return <Label key={option} title={label} systemImage={glyphs?.[option] ?? initialSymbol(label)} modifiers={[tag(option)]} />;
            }
            return (
              <Text key={option} modifiers={[tag(option)]}>
                {label}
              </Text>
            );
          })}
        </Picker>
        {actions?.map((action) => (
          <Button key={action.label} label={action.label} systemImage={action.systemImage} onPress={action.onPress} />
        ))}
      </Menu>
    </Host>
  );
}

/** The overlay `Selector`'s `bar` type (20pt semibold) and its caret. */
const BAR_TYPE = { size: 20, weight: 'semibold' } as const;
const CARET_TYPE = { size: 12, weight: 'bold' } as const;

/** The filled-square symbol for a label's initial — SF has one per letter and digit. */
function initialSymbol(label: string): SystemSymbol {
  const initial = label.trim().charAt(0).toLowerCase();
  const name = /^[a-z0-9]$/.test(initial) ? `${initial}.square.fill` : 'questionmark.square.fill';
  return name as SystemSymbol;
}

const styles = StyleSheet.create({
  host: {
    flexShrink: 1,
    minWidth: 0,
  },
});
