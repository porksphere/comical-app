import { Stack } from 'expo-router';

import type { SelectPillBarProps } from '@/components/multi-select/select-mode';
import type { BarSymbol } from '@/components/top-bar';

/**
 * The select mode's bulk verbs as the screen's system bottom toolbar, where iOS puts them (Mail,
 * Files): the staging rows as a `⋯` menu at the leading end, the verbs as buttons at the trailing
 * end — a symbol where the verb names one, its label otherwise, in its colour. The pushed settings
 * screens sit over the tab bar, so the toolbar has the bottom to itself; the position props are
 * the floating pills' and go unused. Renders nothing when there is neither a menu nor a verb.
 *
 * Every item is a direct child of `Stack.Toolbar`: the native bar reads the element tree, and a
 * wrapper component is invisible to it.
 */
export function SelectPillBar({ verbs, options }: SelectPillBarProps) {
  const rows = options ?? [];
  if (verbs.length === 0 && rows.length === 0) return null;
  return (
    <Stack.Toolbar placement="bottom">
      {rows.length > 0 ? (
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Selection options">
          {rows.map((row) => (
            <Stack.Toolbar.MenuAction
              key={row.testID}
              icon={row.symbol as BarSymbol | undefined}
              disabled={row.disabled || row.loading}
              isOn={row.active}
              destructive={row.destructive}
              onPress={row.onPress}>
              {row.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      ) : null}
      <Stack.Toolbar.Spacer />
      {verbs.map((verb) => (
        <Stack.Toolbar.Button key={verb.key} icon={verb.symbol} accessibilityLabel={verb.label} tintColor={verb.color} onPress={verb.onPress}>
          {verb.symbol ? undefined : verb.label}
        </Stack.Toolbar.Button>
      ))}
    </Stack.Toolbar>
  );
}
