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

/** The indicator's box, and the thing every inset below is measured against. */
const CHECK_SIZE = 16;
/** A pointer's row. A touch row is `RowHeight`, which is a target size rather than a chosen one. */
const POINTER_ROW_HEIGHT = 34;
/**
 * The highlight's inset, DERIVED rather than picked: half the space a centred indicator leaves in
 * its row, applied to the sides as well.
 *
 * A row's height is set by what it has to be — 44 for a thumb, 34 for a pointer — so the vertical
 * gap around a 16pt glyph is already decided, and choosing a side padding independently means the
 * two disagree. They did: on the touch row the check sat 14pt off the top and bottom against 8pt
 * off the right, which reads as a mark shoved into the edge of its own highlight.
 */
const rowInset = (height: number) => (height - CHECK_SIZE) / 2;
/**
 * Optical centring for the label, and it is a real offset rather than a taste call.
 *
 * A line box reserves room for a descender whether or not the label has one, so centring the BOX
 * leaves the visible glyphs above the middle. Measured at 3x on a 34pt row: "Recently added" sat 26
 * above / 27 below — balanced, because its `y` fills the reserved space — while "None", identical
 * type, sat 28 / 37. The eye reads the second as high, and it is: both labels share a cap-to-
 * baseline mass, and that mass was 1.5pt above centre in each.
 *
 * Padding on a centred box moves its content by HALF what it adds — the box grows, then re-centres
 * — so the correction is twice the error. Applied to the text column, so a two-line row (the
 * collection picker's counts) takes it once rather than per line.
 *
 * 2 rather than 3, and the difference is a real trade: the residual quantises to a pixel either way
 * at 3x, and 3 pushed "Recently added" to 32 above / 21 below, tightening its descender against the
 * bottom edge to fix a label that has none. 2 leaves both within a point of centre.
 */
const LABEL_OPTICAL_NUDGE = 2;
const TOUCH_INSET = rowInset(RowHeight);
const POINTER_INSET = rowInset(POINTER_ROW_HEIGHT);

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
      <View style={styles.check}>
        {/* `text`, not `accent` — the rail marks its current row with weight and the plain text
            colour, and this is the same list. A blue tick was also the one hue in a menu whose job
            is its labels (the hold menu's material carries the same rule, at more length). */}
        {selected ? <CheckIcon color={theme.text} size={CHECK_SIZE} /> : null}
      </View>
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
  const pointer = usePointerFine();
  return (
    <ThemedText
      type="small"
      themeColor="textSecondary"
      style={[styles.sectionLabel, { paddingHorizontal: pointer ? POINTER_INSET : TOUCH_INSET }]}>
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
  },
  // minHeight, not height: a row with a `hint` is two lines, and the collection picker's counts
  // were being clipped by a fixed one.
  touchRow: {
    minHeight: RowHeight,
    paddingHorizontal: TOUCH_INSET,
    paddingVertical: Spacing.one,
  },
  pointerRow: {
    minHeight: POINTER_ROW_HEIGHT,
    paddingHorizontal: POINTER_INSET,
  },
  // `flex: 1` (not `justifyContent: 'space-between'`) so the label always starts right after the
  // leading slot and always ends right before the indicator, whether or not this row has either.
  text: {
    flex: 1,
    paddingTop: LABEL_OPTICAL_NUDGE,
  },
  labelSelected: {
    fontWeight: '600',
  },
  check: {
    width: CHECK_SIZE,
    alignItems: 'center',
  },
  sectionLabel: {
    paddingBottom: Spacing.half,
  },
});
