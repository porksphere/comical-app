import { DropdownMenu, DropdownMenuItem, HorizontalDivider, Icon, Text } from '@expo/ui/jetpack-compose';
import { fillMaxSize, testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { Fragment } from 'react';
import { StyleSheet } from 'react-native';

import type { MenuRowSpec } from '@/components/context-menu-material';
import { materialSymbol } from '@/components/icons/material-symbols';
import { MaterialHost } from '@/components/material-host';
import { useTheme } from '@/hooks/use-theme';

/** How long Material's menu takes to fade out: what hosts it stays mounted until then. */
export const MENU_EXIT_MS = 150;

const CHECK = require('@/assets/material-symbols/check.xml');

/** A leading `primary` row, then the rest, then the trailing `destructive` rows: the sections the
 *  iOS system menu makes of the same rows (system-context-menu.tsx), divided here. */
function sections(rows: MenuRowSpec[]): MenuRowSpec[][] {
  const lead = rows[0]?.primary ? 1 : 0;
  let tail = rows.length;
  while (tail > lead && rows[tail - 1]?.destructive) tail--;
  return [rows.slice(0, lead), rows.slice(lead, tail), rows.slice(tail)].filter((s) => s.length > 0);
}

/**
 * Material's dropdown menu of `MenuRowSpec` rows, hosted from Jetpack Compose. It hangs from the
 * view it is laid over: mount it, absolutely filling its anchor, only while the menu is wanted, and
 * unmount `MENU_EXIT_MS` after `expanded` goes false. Each row draws the Material Symbol paired
 * with its SF Symbol (icons/material-symbols.ts) and carries its test id as a Compose test tag.
 * Imported by `.android` files only.
 */
export function MaterialMenu({
  rows,
  title,
  expanded,
  onClose,
}: {
  rows: MenuRowSpec[];
  /** What the menu is of, above its rows. */
  title?: string;
  expanded: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <MaterialHost style={StyleSheet.absoluteFill}>
      <DropdownMenu expanded={expanded} onDismissRequest={onClose} modifiers={[fillMaxSize()]}>
        <DropdownMenu.Items>
          {title !== undefined && (
            <>
              <DropdownMenuItem enabled={false} elementColors={{ disabledTextColor: theme.textSecondary }}>
                <DropdownMenuItem.Text>
                  <Text>{title}</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
              <HorizontalDivider />
            </>
          )}
          {sections(rows).map((section, s) => (
            <Fragment key={section[0]!.testID}>
              {s > 0 && <HorizontalDivider />}
              {section.map((row) => {
                const icon = materialSymbol(row.symbol);
                return (
                  <DropdownMenuItem
                    key={row.testID}
                    enabled={!row.disabled && !row.loading}
                    elementColors={
                      row.destructive ? { textColor: theme.danger, leadingIconColor: theme.danger } : undefined
                    }
                    modifiers={[testTag(row.testID)]}
                    onClick={() => {
                      onClose();
                      row.onPress();
                    }}>
                    {icon && (
                      <DropdownMenuItem.LeadingIcon>
                        <Icon source={icon} size={24} />
                      </DropdownMenuItem.LeadingIcon>
                    )}
                    <DropdownMenuItem.Text>
                      <Text>{row.label}</Text>
                    </DropdownMenuItem.Text>
                    {row.active && (
                      <DropdownMenuItem.TrailingIcon>
                        <Icon source={CHECK} size={24} />
                      </DropdownMenuItem.TrailingIcon>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </Fragment>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </MaterialHost>
  );
}
