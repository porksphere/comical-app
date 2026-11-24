import { DropdownMenu, DropdownMenuItem, HorizontalDivider, Icon, Text } from '@expo/ui/jetpack-compose';
import { fillMaxSize, testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { Fragment } from 'react';
import { StyleSheet } from 'react-native';

import type { MenuRowSpec } from '@/components/context-menu-material';
import { materialSymbol } from '@/components/icons/material-symbols';
import { MaterialHost } from '@/components/material-host';
import { useTheme } from '@/hooks/use-theme';

export { MENU_EXIT_MS } from '@/hooks/use-menu-mount';

const CHECK = require('@/assets/material-symbols/check.xml');
const UNCHECKED = '#00000000';

/** A leading `primary` row, then the rest, then the trailing `destructive` rows: the sections the
 *  iOS system menu makes of the same rows (system-context-menu.tsx), divided here. */
function sectionsOf(rows: MenuRowSpec[]): MaterialMenuSection[] {
  const lead = rows[0]?.primary ? 1 : 0;
  let tail = rows.length;
  while (tail > lead && rows[tail - 1]?.destructive) tail--;
  return [rows.slice(0, lead), rows.slice(lead, tail), rows.slice(tail)].filter((s) => s.length > 0).map((s) => ({ rows: s }));
}

/** What the menu draws of a row: a `MenuRowSpec` is one. */
export type MaterialMenuRow = Pick<MenuRowSpec, 'testID' | 'label' | 'onPress'> &
  Partial<Pick<MenuRowSpec, 'symbol' | 'active' | 'destructive' | 'disabled' | 'loading'>>;

export type MaterialMenuSection = { label?: string; rows: MaterialMenuRow[] };

/**
 * Material's dropdown menu of `MenuRowSpec` rows, hosted from Jetpack Compose. It hangs from the
 * view it is laid over: mount it, absolutely filling its anchor, only while the menu is wanted, and
 * unmount `MENU_EXIT_MS` after `expanded` goes false. Each row draws the Material Symbol paired
 * with its SF Symbol (icons/material-symbols.ts) and carries its test id as a Compose test tag.
 * Imported by `.android` files only.
 */
export function MaterialMenu({
  rows,
  sections,
  title,
  expanded,
  onClose,
  staysOpen,
}: {
  rows?: MenuRowSpec[];
  /** The rows already in sections, each under its label, in place of `rows`. */
  sections?: MaterialMenuSection[];
  /** What the menu is of, above its rows. */
  title?: string;
  expanded: boolean;
  onClose: () => void;
  /** A row's press leaves the menu up. */
  staysOpen?: boolean;
}) {
  const theme = useTheme();
  const heading = { disabledTextColor: theme.textSecondary };
  return (
    <MaterialHost style={StyleSheet.absoluteFill}>
      <DropdownMenu expanded={expanded} onDismissRequest={onClose} modifiers={[fillMaxSize()]}>
        <DropdownMenu.Items>
          {title !== undefined && (
            <>
              <DropdownMenuItem enabled={false} elementColors={heading}>
                <DropdownMenuItem.Text>
                  <Text>{title}</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
              <HorizontalDivider />
            </>
          )}
          {(sections ?? sectionsOf(rows ?? [])).map((section, s) => (
            <Fragment key={section.rows[0]?.testID ?? s}>
              {s > 0 && <HorizontalDivider />}
              {section.label !== undefined && (
                <DropdownMenuItem enabled={false} elementColors={heading}>
                  <DropdownMenuItem.Text>
                    <Text>{section.label}</Text>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              )}
              {section.rows.map((row) => {
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
                      if (!staysOpen) onClose();
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
                    {/* Mounted for every row that can be checked, and tinted away when it is
                        not: a slot added to an item already composed is never drawn, so a check
                        that came and went in a menu left up never came back. */}
                    {row.active !== undefined && (
                      <DropdownMenuItem.TrailingIcon>
                        <Icon source={CHECK} size={24} tint={row.active ? theme.text : UNCHECKED} />
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
