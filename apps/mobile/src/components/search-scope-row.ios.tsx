import { Button, Host, HStack, Image, Menu, Picker, ScrollView, Text } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  buttonStyle,
  clipShape,
  frame,
  labelStyle,
  lineLimit,
  padding,
  pickerStyle,
  resizable,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import type { SearchScopeRowProps } from '@/components/search-scope-row';
import { COMICAL_BRIDGE_ID, COMICAL_ICON } from '@/data/selected-bridge';
import { useActiveColorScheme } from '@/hooks/use-theme';
import { initialSymbol } from '@/lib/initial-symbol';
import { MENU_THUMB_RADIUS, useMenuThumbFiles } from '@/lib/menu-thumb-files';

const COMICAL_SOURCES: Record<string, number> = { [COMICAL_BRIDGE_ID]: COMICAL_ICON };

/**
 * Where Music puts its scope bar: under the field, while it is in use. A scope bar is a segmented
 * control and holds two or three; the sources are as many as are installed, so they are a row of
 * glass buttons that scrolls, each with its tile (a SwiftUI image, not a menu row, which UIKit
 * draws at the file's own scale). Filters and sort hold still at its end.
 */
export function SearchScopeRow({ scopes, thumbnails, selected, onSelect, filters, sort }: SearchScopeRowProps) {
  const scheme = useActiveColorScheme();
  const tiles = useMenuThumbFiles(thumbnails, COMICAL_SOURCES, MENU_THUMB_RADIUS);
  return (
    // `ignoreSafeArea`: as the Recent switch's, or the row shifts as the bars come and go.
    <Host colorScheme={scheme} style={styles.host} ignoreSafeArea="all">
      <HStack spacing={0}>
        <ScrollView axes="horizontal" showsIndicators={false}>
          <HStack spacing={8} modifiers={[padding({ horizontal: 16, vertical: 4 })]}>
            {scopes.map((scope) => {
              const tile = tiles[scope.id];
              return (
                <Button
                  key={scope.id}
                  onPress={() => onSelect(scope.id)}
                  modifiers={[
                    buttonStyle(scope.id === selected ? 'glassProminent' : 'glass'),
                    accessibilityIdentifier(`search.scope.${scope.id}`),
                  ]}>
                  <HStack spacing={6}>
                    {tile ? (
                      <Image
                        uiImage={tile}
                        modifiers={[resizable(), frame({ width: 20, height: 20 }), clipShape('roundedRectangle', 5)]}
                      />
                    ) : (
                      <Image systemName={initialSymbol(scope.name)} size={18} />
                    )}
                    <Text modifiers={[lineLimit(1)]}>{scope.name}</Text>
                  </HStack>
                </Button>
              );
            })}
          </HStack>
        </ScrollView>
        {(filters || sort) && (
          <HStack spacing={8} modifiers={[padding({ trailing: 16 })]}>
            {filters && (
              <Button
                label={filters.count > 0 ? `Filters, ${filters.count} set` : 'Filters'}
                systemImage={
                  filters.count > 0 ? 'line.3.horizontal.decrease.circle.fill' : 'line.3.horizontal.decrease.circle'
                }
                onPress={filters.onPress}
                modifiers={[labelStyle('iconOnly'), buttonStyle('glass'), accessibilityIdentifier('search.scope.filters')]}
              />
            )}
            {sort && (
              <Menu
                label="Sort results"
                systemImage="arrow.up.arrow.down"
                modifiers={[labelStyle('iconOnly'), buttonStyle('glass'), accessibilityIdentifier('search.scope.sort')]}>
                <Picker
                  label="Sort by"
                  selection={sort.current}
                  onSelectionChange={(key: string) => sort.onSelect(key)}
                  modifiers={[pickerStyle('inline')]}>
                  {sort.options.map((o) => (
                    <Text key={o.key} modifiers={[tag(o.key)]}>
                      {o.label}
                    </Text>
                  ))}
                </Picker>
              </Menu>
            )}
          </HStack>
        )}
      </HStack>
    </Host>
  );
}

// A glass button with a 20pt picture is 36pt tall; the row's padding takes it to 44.
const styles = StyleSheet.create({
  host: {
    height: 44,
    marginBottom: 8,
  },
});
