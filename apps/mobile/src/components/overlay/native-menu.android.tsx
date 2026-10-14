import { DropdownMenu, DropdownMenuItem, Host, HorizontalDivider, RNHostView, Text } from '@expo/ui/jetpack-compose';
import { Fragment, useState } from 'react';
import { Pressable } from 'react-native';

import type { NativeMenuProps } from '@/components/overlay/native-menu';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

// Material's menu has no section headers, so a titled section opens with a disabled row carrying the
// title — the shape Material's own guidance draws a grouped menu with.
export function NativeMenu({ sections, testID, children }: NativeMenuProps) {
  const scheme = useActiveColorScheme();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const close = () => setExpanded(false);
  return (
    <Host matchContents colorScheme={scheme}>
      <DropdownMenu expanded={expanded} onDismissRequest={close}>
        <DropdownMenu.Trigger>
          <RNHostView matchContents>
            <Pressable testID={testID} onPress={() => setExpanded(true)} hitSlop={8}>
              {children}
            </Pressable>
          </RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {sections.map((section, i) => (
            <Fragment key={section.key}>
              {i > 0 && <HorizontalDivider />}
              {section.title && (
                <DropdownMenuItem enabled={false} elementColors={{ disabledTextColor: theme.textSecondary }}>
                  <DropdownMenuItem.Text>
                    <Text style={{ typography: 'labelMedium' }}>{section.title}</Text>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              )}
              {section.items.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}>
                  <DropdownMenuItem.Text>
                    <Text>{item.label}</Text>
                  </DropdownMenuItem.Text>
                  {item.checked && (
                    <DropdownMenuItem.TrailingIcon>
                      <Text color={theme.accent}>✓</Text>
                    </DropdownMenuItem.TrailingIcon>
                  )}
                </DropdownMenuItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
