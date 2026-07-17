/**
 * The multi-select row chrome: a leading check circle wrapping arbitrary row content. Selection is
 * ALWAYS passed in (`selected`) and never held locally, so the row is safe inside a recycled
 * `LegendList` — a reused view can't carry a stale checkmark. `done` renders the settled variant
 * (checked-but-muted, non-interactive): "already have this", distinct from "selected to act on".
 *
 * The range-fill long-press goes through the shared `Holdable` (a gesture-handler LongPress) — a
 * `Pressable`'s `onLongPress` doesn't fire reliably inside iOS scroll views.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Holdable } from '@/components/context-menu';
import { CheckIcon } from '@/components/icons/ui-icons';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SelectableRow({
  selected,
  done,
  onToggle,
  onRangeFill,
  trailing,
  children,
  testID,
}: {
  selected: boolean;
  /** Settled (e.g. already downloaded): checked-but-muted and non-interactive. */
  done?: boolean;
  onToggle: () => void;
  /** Long-press: select the span from the last toggled row to this one. */
  onRangeFill: () => void;
  /** Right-aligned slot (e.g. a download-state glyph). */
  trailing?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const circle = done
    ? { backgroundColor: theme.textSecondary, borderColor: theme.textSecondary }
    : selected
      ? { backgroundColor: theme.accent, borderColor: theme.accent }
      : { borderColor: theme.textSecondary };
  return (
    <Holdable enabled={!done} onHold={onRangeFill}>
      <Pressable testID={testID} onPress={done ? undefined : onToggle} disabled={done} style={done && styles.done}>
        <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.hairline }]}>
          <View style={[styles.circle, circle]}>
            {(selected || done) && <CheckIcon color={theme.accentOn} size={11} />}
          </View>
          <View style={styles.content}>{children}</View>
          {trailing}
        </ThemedView>
      </Pressable>
    </Holdable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  done: {
    opacity: 0.55,
  },
});
