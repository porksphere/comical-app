import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MenuRowSpec } from '@/components/context-menu-material';
import { MoreVerticalIcon } from '@/components/icons/ui-icons';
import { MaterialMenu } from '@/components/material-menu';
import type { OverflowMenuProps } from '@/components/overflow-menu';
import { Spacing } from '@/constants/theme';
import { useMenuMount } from '@/hooks/use-menu-mount';
import { useRipple } from '@/hooks/use-ripple';
import { useTheme } from '@/hooks/use-theme';

// Long press in an Android list selects; an item's actions sit behind its ⋮.
export const OVERFLOW_MENU = true;

/**
 * Android: a ⋮ button whose Material menu hangs from it. The rows are built and the Compose host
 * mounted only when the button is pressed, so a scrolling list carries nothing but the button.
 */
export function OverflowMenu({ rows, testID, label, disabled }: OverflowMenuProps) {
  const theme = useTheme();
  const ripple = useRipple({ borderless: true, radius: 18 });
  const menu = useMenuMount();
  const [open, setOpen] = useState<MenuRowSpec[]>([]);
  const show = () => {
    setOpen(rows());
    menu.show();
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
        android_ripple={ripple}
        style={styles.button}>
        <MoreVerticalIcon color={theme.textSecondary} size={18} />
      </Pressable>
      {menu.mounted && <MaterialMenu rows={open} expanded={menu.expanded} onClose={menu.close} />}
    </View>
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
