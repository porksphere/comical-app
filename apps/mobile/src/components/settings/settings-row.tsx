import { Children, Fragment, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { SettingsGutter, SettingsRowHeight, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

/**
 * The horizontal gutter every settings screen pads its scroll content by. Rows cancel it out with a
 * negative margin (see `SettingsRow`) so their background, press highlight, and swipe-revealed
 * delete pane all run to the screen's edge, while their TEXT still lines up with everything else at
 * this inset. Anything in a section that isn't a row (save buttons, field editors, chips) just keeps
 * the gutter it inherits.
 *
 * This is the one coupling to be careful about: a screen that pads its content by something other
 * than `Spacing.four` will have its rows overhang or fall short by the difference.
 */
/**
 * The frame every settings row is cut from: fixed height, the gutter escape that lets its background
 * reach the screen's edge while its text stays inset, and the text column beside it.
 *
 * Exported because two rows in the app CAN'T be a `SettingsRow` — the Appearance and NSFW pickers in
 * `settings-general` need their own ref on the Pressable for `useAnchoredOverlay` to anchor to, and
 * the landing screen's category rows carry a leading icon and a count. They were each re-declaring
 * this geometry by hand, which is exactly how a list ends up with one row 8px taller than the rest.
 * Spread these instead.
 */
export const settingsRowFrame = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    height: SettingsRowHeight,
    paddingVertical: Spacing.one,
    // Text sits at the gutter; the background and press/hover highlight run to the screen's edge.
    paddingHorizontal: SettingsGutter,
  },
  /** Cancels the screen's gutter. Omit when an ancestor has already done it (the swipe wrapper has). */
  escape: {
    marginHorizontal: -SettingsGutter,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});

/** A titled group of settings — the Settings screens' section shape. The title sits above a
 *  full-width list of rows separated by hairline dividers.
 *
 *  There is deliberately no card here: rows run edge to edge, the way X, iOS Settings' grouped
 *  lists on a phone, and Android's Material 3 Settings all present a settings list. The old
 *  rounded, bordered card floating inside the screen's padding read as a widget sitting ON the
 *  screen rather than as the screen itself.
 *
 *  `icon` is an optional leading glyph next to the title, for scanability on the top-level
 *  Settings screen where several sections sit in a row (especially on wide desktop layouts,
 *  where a plain text-only heading reads sparse).
 *
 *  `title` is optional: a screen whose whole content IS the list (Bridges, Registries) doesn't need
 *  a header restating the screen's own name, so it renders the list alone. */
export function SettingsSection({
  title,
  icon,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.sectionWrap}>
      {title && (
        <View style={styles.sectionHeader}>
          {icon}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
            {title}
          </ThemedText>
        </View>
      )}
      <View style={styles.section}>
        {items.map((item, i) => (
          <Fragment key={i}>
            {item}
            {/* Starts at the gutter (under the row's text) and runs off the right edge — the
                standard inset-divider look, which reads as a list rather than a stack of slabs. */}
            {i < items.length - 1 && <View style={[styles.divider, { backgroundColor: theme.hairline }]} />}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * One settings row: label (+ optional description) on the left, arbitrary
 * content (`right`, e.g. a `Switch` or a value string) on the right. Pass
 * `onPress` to make the whole row tappable — it grows a trailing chevron unless
 * `right` is already provided (a Switch shouldn't also show a chevron). A
 * pressable row gets a full-bleed rounded highlight on press (touch) and hover
 * (mouse/trackpad on web); Android additionally gets a ripple, which stands in
 * for the highlight there so the two don't visually stack.
 */
export function SettingsRow({
  label,
  description,
  descriptionColor,
  descriptionSelectable,
  escapeGutter = true,
  leading,
  right,
  onPress,
  onHoverIn,
  onHoverOut,
  testID,
}: {
  label: string;
  description?: string;
  /** Optional glyph/artwork before the label (a bridge's icon). See `RowIcon`. */
  leading?: ReactNode;
  /** Overrides the description's color (e.g. an amber/blue status hint) — defaults to `textSecondary`. */
  descriptionColor?: string;
  /** Lets the description text be selected/copied (e.g. a server URL) — off by default. */
  descriptionSelectable?: boolean;
  /** Set false when an ancestor has ALREADY cancelled the screen's gutter (the swipeable wrapper
   *  does, so its delete pane can reach the edge). The row then only pads, and doesn't also pull
   *  itself a second `SettingsGutter` further out. */
  escapeGutter?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  /** Web only: mirrors of the row's own hover state, so a caller rendering something hover-dependent
   *  in `right` (the trash in `SwipeableSettingsRow`) can react to hovering ANYWHERE on the row —
   *  not just the few pixels of the control itself. */
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  /** Automation selector for the row. Defaults to `settings.row.<label>`; pass an explicit id when two
   *  rows would otherwise collide on their label (see src/lib/test-id.ts). */
  testID?: string;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn: markHovered, onHoverOut: markUnhovered } = useHovered();
  const rowTestID = testID ?? testId('settings.row', label);
  // On a pressable row the id lives on the Pressable; on a static row it lives on the root View — never
  // both, so a locator resolves to exactly one node.
  const content = (highlighted?: boolean, rootTestID?: string) => (
    <View
      testID={rootTestID}
      style={[
        settingsRowFrame.row,
        escapeGutter && settingsRowFrame.escape,
        onPress && styles.rowPressable,
        highlighted && Platform.OS !== 'android' && { backgroundColor: theme.backgroundSelected },
      ]}>
      {leading}
      <View style={settingsRowFrame.text}>
        <ThemedText type="small" numberOfLines={1}>
          {label}
        </ThemedText>
        {description && (
          // One line, always — this is what keeps every row the same height (see
          // `SettingsRowHeight`). A description that needs two lines to land is too long for a row.
          <ThemedText
            type="small"
            numberOfLines={1}
            selectable={descriptionSelectable}
            style={{ color: descriptionColor ?? theme.textSecondary }}>
            {description}
          </ThemedText>
        )}
      </View>
      {right ?? (onPress && <ChevronRightIcon color={theme.textSecondary} size={18} />)}
    </View>
  );
  if (!onPress) return content(undefined, rowTestID);
  return (
    <Pressable
      testID={rowTestID}
      onPress={() => {
        hapticImpactLight();
        onPress();
      }}
      onHoverIn={() => {
        markHovered();
        onHoverIn?.();
      }}
      onHoverOut={() => {
        markUnhovered();
        onHoverOut?.();
      }}
      android_ripple={{ color: theme.backgroundSelected }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {({ pressed }) => content(pressed || hovered)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No marginTop: that would also push the FIRST section down, stacking on top of the screen's
  // `BarContentGap` and making every settings-style screen start lower than the other tabs. The space
  // BETWEEN sections is the container's `gap` (Spacing.five), which never applies before the first.
  sectionWrap: {
    width: '100%',
  },
  section: {
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    // Left edge stays at the gutter (aligned under the row's text); the right runs off-screen.
    marginRight: -SettingsGutter,
  },
  rowPressable: {
    cursor: 'pointer',
  },
});
