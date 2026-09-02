/**
 * Everything a single-select overlay menu is built from — the frame, the trigger that opens one, the
 * rows inside it. Four screens draw one of these (the bridge/page selector, both sort menus, the
 * collection picker) and every one of them used to carry its own copy.
 *
 * The row came out first, and for the reason the rest followed: there were FOUR copies of it,
 * identical down to the `rgba(128,128,128,0.5)` in the radio's border, and styling one of them made
 * them four things to remember rather than one. A menu row is one idea; the differences between
 * those copies (a thumbnail, a second line, an action that isn't a selection) are props. The same
 * was true a level up, of the heading, the block rhythm and the icon button.
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
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckIcon } from '@/components/icons/ui-icons';
import {
  HEADER_TO_LIST_GAP,
  MeasuredHeader,
  OverlayHeading,
  useAnchoredOverlay,
  useOverlayPresentation,
} from '@/components/overlay/overlay';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, RowHeight, Spacing } from '@/constants/theme';
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
 * The menu itself — the frame all four selectors were repeating around their lists.
 *
 * It owns the two things that are the same wherever a single-select menu is drawn: the heading,
 * which appears on a SHEET and not on a popover (there the trigger you just pressed already names
 * the menu), and the rhythm between the blocks inside it. Each caller had its own copy of both,
 * and its own `styles.menu`, which is exactly the shape the row component was in before it was
 * pulled out: identical copies that had already begun to drift.
 *
 * The popover DROPS the wrapper rather than letting `OverlayHeading` render nothing inside it: the
 * flex `gap` below would still reserve a full step before an empty sibling (see filter-editors'
 * MultiEditor for the same trap). No `flex: 1` — this hugs its content, which already sizes itself
 * (see `sheetBody` in overlay.tsx).
 */
export function OptionMenu({ title, children }: { title: string; children: ReactNode }) {
  const presentation = useOverlayPresentation();
  return (
    <View style={styles.menu}>
      {presentation !== 'popover' && (
        <View style={styles.menuHeader}>
          <MeasuredHeader>
            <OverlayHeading>{title}</OverlayHeading>
          </MeasuredHeader>
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * A bar icon that opens one — the sort controls, which were byte-identical apart from their strings.
 *
 * It owns the anchor as well as the press, so a caller supplies what its menu IS and nothing about
 * how a menu is opened. `popover: true` is not a parameter: these are fixed, short lists, which is
 * the shape both platforms draw as a pull-down rather than a sheet (see MENU_MAX_ROWS).
 */
export function OptionMenuButton({
  testID,
  accessibilityLabel,
  icon,
  render,
}: {
  testID: string;
  accessibilityLabel: string;
  icon: ReactNode;
  render: () => ReactNode;
}) {
  const { ref, openAt } = useAnchoredOverlay();
  const theme = useTheme();
  const { hovered, handlers } = useHover();
  return (
    <Pressable
      testID={testID}
      ref={ref}
      {...handlers}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.menuButton, hovered && { backgroundColor: theme.backgroundSelected }]}
      onPress={() => openAt(render, { popover: true })}>
      {icon}
    </Pressable>
  );
}

export function OptionRow({
  label,
  selected,
  leading,
  onPress,
  testID,
}: {
  label: string;
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
  // The groups inside are divided by a RULE (see OptionSectionLabel), so this is only the rhythm
  // between blocks, not what separates one group from the next.
  menu: {
    gap: Spacing.two,
  },
  // The heading's extra clearance from the list, on top of the gap above — the blocks inside a menu
  // sit closer together than the heading sits above them, and a single flex `gap` can't say both.
  //
  // OUTSIDE `MeasuredHeader`, and that is not a detail: the sheet sizes its list as
  // `budget - headerHeight - HEADER_TO_LIST_GAP`, so anything inside the measured box is counted
  // twice and the list comes up short by it. Derived from that same constant for the same reason —
  // this gap is the one the sheet has already been told to expect.
  menuHeader: {
    marginBottom: HEADER_TO_LIST_GAP - Spacing.two,
  },
  menuButton: {
    ...ContinuousCorner,
    padding: Spacing.one,
    borderRadius: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // The fill is a selection HIGHLIGHT now, not a button. 8pt hugs the row; the 16 it used to
    // carry made a filled row read as a pill, which is what made a list of them read as a stack of
    // buttons. The rail's own rows use the same corner.
    ...ContinuousCorner,
    borderRadius: Spacing.two,
  },
  // minHeight rather than height: the target is a floor, and a label that ever wraps should push
  // the row rather than be clipped by it.
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
