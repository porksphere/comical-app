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

/** The check GLYPH. Its slot is wider — see `ROW_ART`. */
const CHECK_SIZE = 16;
/** A pointer's row. A touch row is `RowHeight`, which is a target size rather than a chosen one. */
const POINTER_ROW_HEIGHT = 34;
/**
 * The size of the row's ART — the leading thumbnail, and the width of the trailing slot the check
 * sits in. ONE number per row, and everything else is derived from it.
 *
 * This is the layer the geometry belongs at, which took two goes to find. A row holds elements of
 * different sizes — a 28pt bridge thumbnail and a 16pt check — and a single side padding cannot
 * frame both evenly, because each one's vertical gap is already fixed by its own height against the
 * row's. Setting the padding from the check left the thumbnail 14 from the side and 8 from the top;
 * setting it from the thumbnail puts the check back where it started.
 *
 * Giving the trailing slot the ART's width instead resolves it: the inset is `(row - art) / 2`, so
 * the art is evenly framed by construction, and the check — centred in a slot that wide — picks up
 * the extra `(art - check) / 2` on its side, which is exactly the difference between their vertical
 * gaps. Both come out evenly inset, from one number. It lands on 8 for both presentations, which is
 * why the label inset is back where it began.
 */
const ROW_ART = { touch: 28, pointer: 18 } as const;
const rowInset = (height: number, art: number) => (height - art) / 2;
const TOUCH_INSET = rowInset(RowHeight, ROW_ART.touch);
const POINTER_INSET = rowInset(POINTER_ROW_HEIGHT, ROW_ART.pointer);
/**
 * Optical centring for the label, and a real offset rather than a taste call.
 *
 * A line box reserves room for a descender whether or not the label has one, so centring the BOX
 * leaves the visible glyphs above the middle. Measured at 3x on a 34pt row: "Recently added" sat 26
 * above / 27 below — balanced, because its `y` fills the reserved space — while "None", identical
 * type, sat 28 / 37. Both share a cap-to-baseline mass, and that mass was a point and a half above
 * centre in each.
 *
 * Padding on a centred box moves its content by HALF what it adds — the box grows, then re-centres
 * — so the correction is twice the error. It goes on the text column rather than the label, so a
 * two-line row (the collection picker's counts) takes it once rather than per line.
 *
 * 2 rather than 3 is a trade, not a rounding: the residual quantises to a pixel either way at that
 * scale, and 3 pushed "Recently added" to 32 / 21, tightening its descender against the bottom edge
 * to fix a label that has none.
 */
const LABEL_OPTICAL_NUDGE = 2;

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
      <View style={pointer ? styles.checkPointer : styles.checkTouch}>
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

/**
 * A group heading inside a menu ("Sort by", "Group by"). Shared with the rows so its indent can't
 * drift from theirs.
 *
 * `divided` draws the RULE above it, which is what both platforms use to separate groups in a menu:
 * iOS puts a separator between a `UIMenu`'s inline sections (and, since 16, the section's title
 * above it), and Material 3 divides menu item groups the same way. Space alone was carrying it here
 * and space alone is weak — two groups four rows long read as one list with a stray caption in it.
 *
 * Pass it on every group but the first: a rule above the first one would fence the list off from
 * the panel's own top edge rather than divide anything.
 */
export function OptionSectionLabel({ children, divided }: { children: string; divided?: boolean }) {
  const theme = useTheme();
  const pointer = usePointerFine();
  const inset = pointer ? POINTER_INSET : TOUCH_INSET;
  return (
    <View>
      {divided ? <View style={[styles.sectionRule, { backgroundColor: theme.overlayHairline }]} /> : null}
      <ThemedText type="small" themeColor="textSecondary" style={[styles.sectionLabel, { paddingHorizontal: inset }]}>
        {children}
      </ThemedText>
    </View>
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
  // As wide as the row's ART, not as the glyph — that width is what carries the check to the same
  // inset the thumbnail has (see ROW_ART).
  checkTouch: {
    width: ROW_ART.touch,
    alignItems: 'center',
  },
  checkPointer: {
    width: ROW_ART.pointer,
    alignItems: 'center',
  },
  sectionLabel: {
    paddingBottom: Spacing.half,
  },
  // FULL BLEED, which is why it pulls back by the panel's own padding: a menu's separator runs the
  // whole width on both platforms, and one that stops where the rows stop reads as an underline for
  // the caption rather than as a division of the menu. The rows keep their inset and sit within it,
  // which is what a Material menu with a selected item looks like anyway.
  sectionRule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: -Spacing.two,
    marginBottom: Spacing.two,
  },
});
