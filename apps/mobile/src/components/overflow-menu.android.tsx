import { DropdownMenu, DropdownMenuItem, Host, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import { fillMaxSize, testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MenuRowSpec } from '@/components/context-menu-material';
import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import type { OverflowMenuProps } from '@/components/overflow-menu';
import { Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

// How long Material's menu takes to fade out; the host it hangs from stays until then.
const EXIT_MS = 150;

// Long press in an Android list selects; an item's actions sit behind its ⋮.
export const OVERFLOW_MENU = true;

/**
 * Android: a ⋮ button whose Material menu, hosted from Jetpack Compose, hangs from it. The rows are
 * built and the Compose host mounted only when the button is pressed, so a scrolling list carries
 * nothing but the button. Text only, like the overflow menus in Google's own apps.
 */
export function OverflowMenu({ rows, testID, label, disabled }: OverflowMenuProps) {
  const theme = useTheme();
  const [open, setOpen] = useState<MenuRowSpec[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (exit.current) clearTimeout(exit.current);
    setOpen(rows());
    setExpanded(true);
  };
  const close = () => {
    setExpanded(false);
    exit.current = setTimeout(() => setOpen(null), EXIT_MS);
  };

  return (
    <View style={styles.slot}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        hitSlop={8}
        onPress={show}
        android_ripple={{ color: theme.backgroundSelected, borderless: true, radius: 18 }}
        style={styles.button}>
        <MoreVerticalIcon color={theme.textSecondary} size={18} />
      </Pressable>
      {open && <MaterialMenu rows={open} expanded={expanded} onClose={close} />}
    </View>
  );
}

function MaterialMenu({ rows, expanded, onClose }: { rows: MenuRowSpec[]; expanded: boolean; onClose: () => void }) {
  const scheme = useActiveColorScheme();
  const { error } = useMaterialColors({ colorScheme: scheme });
  return (
    <Host colorScheme={scheme} style={StyleSheet.absoluteFill}>
      <DropdownMenu expanded={expanded} onDismissRequest={onClose} modifiers={[fillMaxSize()]}>
        <DropdownMenu.Items>
          {rows.map((row) => (
            <DropdownMenuItem
              key={row.testID}
              enabled={!row.disabled && !row.loading}
              elementColors={row.destructive ? { textColor: error } : undefined}
              modifiers={[testTag(row.testID)]}
              onClick={() => {
                onClose();
                row.onPress();
              }}>
              <DropdownMenuItem.Text>
                <Text>{row.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}

const styles = StyleSheet.create({
  // Tucked into the row's trailing padding, the way the versions chevron beside it is.
  slot: {
    width: 28,
    height: 28,
    marginRight: -Spacing.two,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
