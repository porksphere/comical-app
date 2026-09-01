/**
 * The single-select row every overlay menu is built from — the bridge/page selector, both sort
 * menus, the collection picker.
 *
 * It exists because there were FOUR copies of it, identical down to the `rgba(128,128,128,0.5)` in
 * the radio's border, and styling one of them made them four things to remember rather than one. A
 * menu row is one idea; the differences between those copies (a thumbnail, a second line, an action
 * that isn't a selection) are props.
 *
 * ONE look everywhere: transparent at rest on the panel's own surface, `overlaySelected` under the
 * current row, and a check at the end. The row is a list item with a highlight, not a stack of
 * buttons — which is what a filled pill per row read as, and it is the same list the rail draws
 * flat. Exactly two things differ, and both are about the INPUT DEVICE rather than the platform:
 *
 * - **Height.** 44pt where a thumb has to hit it, 34 where a pointer does. A touch target is not a
 *   style choice.
 * - **Feedback before the press resolves.** A pointer hovers, so it gets `overlayHover` under the
 *   cursor; a finger cannot, so it gets the same tint on `pressed` instead. With no fill at rest
 *   there is otherwise nothing at all between touching a row and the sheet closing.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { RowHeight, Spacing } from '@/constants/theme';
import { useHover } from '@/hooks/use-hover';
import { usePointerFine } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

export function OptionRow({
  label,
  hint,
  selected,
  leading,
  onPress,
  testID,
}: {
  label: string;
  /** A second, quieter line under the label (the collection picker's item counts). */
  hint?: string;
  selected: boolean;
  /** Rendered before the label — the selector's bridge thumbnail. */
  leading?: React.ReactNode;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const pointer = usePointerFine();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityState={{ selected }}
      {...handlers}
      style={({ pressed }) => [
        styles.row,
        pointer ? styles.pointerRow : styles.touchRow,
        {
          backgroundColor: selected
            ? theme.overlaySelected
            : hovered || pressed
              ? theme.overlayHover
              : 'transparent',
        },
      ]}>
      {leading}
      <View style={styles.text}>
        <ThemedText
          style={selected ? styles.labelSelected : undefined}
          themeColor={selected ? 'text' : 'textSecondary'}
          numberOfLines={1}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {/* A CHECK, not a radio. The fill already says which row is current, so the mark confirms it
          rather than carrying it — and a ring per row, drawn whether or not anything is selected,
          was the loudest thing in a menu whose job is its labels. The slot is reserved either way,
          so selecting a row never reflows the labels beside it. */}
      <View style={styles.check}>{selected ? <CheckIcon color={theme.accent} size={16} /> : null}</View>
    </Pressable>
  );
}

/** A row that DOES something rather than selecting something (the collection picker's "New
 *  collection…"). Same metrics, accent label, and no indicator slot — it will never show a mark, so
 *  reserving room for one would only push its label out of line with the others' text. */
export function OptionActionRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const pointer = usePointerFine();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      {...handlers}
      style={({ pressed }) => [
        styles.row,
        pointer ? styles.pointerRow : styles.touchRow,
        { backgroundColor: hovered || pressed ? theme.overlayHover : 'transparent' },
      ]}>
      <ThemedText style={{ color: theme.accent }}>{label}</ThemedText>
    </Pressable>
  );
}

/** A group heading inside a menu ("Sort by", "Group by"). Shared with the rows so its indent can't
 *  drift from theirs. */
export function OptionSectionLabel({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // The fill is a selection HIGHLIGHT now, not a button. 8pt hugs the row; the 16 it used to
    // carry made a filled row read as a pill, which is what made a list of them read as a stack of
    // buttons. The rail's own rows use the same corner.
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  // minHeight, not height: a row with a `hint` is two lines, and the collection picker's counts
  // were being clipped by a fixed one.
  touchRow: {
    minHeight: RowHeight,
    paddingVertical: Spacing.one,
  },
  pointerRow: {
    minHeight: 34,
  },
  // `flex: 1` (not `justifyContent: 'space-between'`) so the label always starts right after the
  // leading slot and always ends right before the indicator, whether or not this row has either.
  text: {
    flex: 1,
  },
  labelSelected: {
    fontWeight: '600',
  },
  check: {
    width: 16,
    alignItems: 'center',
  },
  sectionLabel: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.half,
  },
});
