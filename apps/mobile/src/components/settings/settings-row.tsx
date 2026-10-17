import { Children, Fragment, type ReactNode, useContext } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';

import { ChevronRightIcon } from '@/components/icons/ui-icons';
import { HOVER_RAIL_FADE, HoverRailContext } from '@/components/settings/hover-rail';
import { ThemedText } from '@/components/themed-text';
import { ContinuousCorner, SettingsCardInset, SettingsCardRadius, SettingsRowHeight, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';
import { testId } from '@/lib/test-id';

/**
 * The frame every settings row is cut from: fixed height, the card inset its text sits at, and the
 * text column. A row fills its card's width; the card (`SettingsCard`) is what clips its background,
 * press highlight and swipe pane to the rounded corners.
 *
 * Exported because some rows CAN'T be a `SettingsRow` — the pickers need their own ref on the
 * Pressable for `useAnchoredOverlay` to anchor to, and the landing screen's category rows carry a
 * leading icon tile and a count. Spread these rather than re-declaring the geometry, which is how a
 * list ends up with one row 8px taller than the rest.
 */
export const settingsRowFrame = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    height: SettingsRowHeight,
    paddingVertical: Spacing.one,
    paddingHorizontal: SettingsCardInset,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});

/**
 * The inset divider between two rows of a card: starts under the rows' text, runs to the card's
 * right edge. Lists that lay their rows out themselves (the reorderable list, the downloads list)
 * draw it with the same style so every card reads the same.
 */
export const settingsDivider = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SettingsCardInset,
  },
});

/**
 * The rounded surface a group of settings rows sits on — iOS's inset grouped list. `overflow:
 * hidden` is what rounds the first and last rows' highlight and a swipe pane without any row
 * knowing where in the card it is (a per-corner radius would, and crashes Fabric on Android).
 */
export function SettingsCard({ style, children }: { style?: ViewStyle; children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.card, ContinuousCorner, { backgroundColor: theme.backgroundElement }, style]}>{children}</View>;
}

/** A titled group of settings — the Settings screens' section shape: an uppercase caption above a
 *  card of rows separated by inset hairline dividers, and an optional footer beneath in the muted
 *  caption weight. The footer is where a group's explanation goes, so its rows can stay a single
 *  line; a row's own `description` is for state (a URL, a status), not prose.
 *
 *  `icon` is an optional leading glyph next to the title.
 *
 *  `title` is optional: a screen whose whole content IS the list doesn't need a header restating
 *  the screen's own name, so it renders the card alone.
 *
 *  `plain` drops the card: the content sits directly under the caption at the card's gutter, no
 *  surface and no dividers. For content that isn't rows — a chip row, an editor — which a card
 *  turns into a box of loose controls. */
export function SettingsSection({
  title,
  icon,
  footer,
  plain,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  footer?: string;
  plain?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
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
      {plain ? (
        <View style={styles.plain}>{items}</View>
      ) : (
        <SettingsCard>
          {items.map((item, i) => (
            <Fragment key={i}>
              {item}
              {i < items.length - 1 && <View style={[settingsDivider.line, { backgroundColor: theme.hairline }]} />}
            </Fragment>
          ))}
        </SettingsCard>
      )}
      {footer && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionFooter}>
          {footer}
        </ThemedText>
      )}
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
  labelBold,
  description,
  descriptionColor,
  descriptionSelectable,
  contentInset,
  leading,
  right,
  onPress,
  onLongPress,
  onHoverIn,
  onHoverOut,
  testID,
  disabled,
}: {
  label: string;
  /** Render the label in the bolder weight — used to make a parent row stand above its nested children. */
  labelBold?: boolean;
  description?: string;
  /** Extra left padding for the row's content (leading + text + chevron), indenting a NESTED row under
   *  its parent while its background/press highlight still span the full width. */
  contentInset?: number;
  /** Optional glyph/artwork before the label (a bridge's icon). See `RowIcon`. */
  leading?: ReactNode;
  /** Overrides the description's color (e.g. an amber/blue status hint) — defaults to `textSecondary`. */
  descriptionColor?: string;
  /** Lets the description text be selected/copied (e.g. a server URL) — off by default. */
  descriptionSelectable?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  /** Long-press on a pressable row (e.g. multi-select range-fill). Only fires when `onPress` is set.
   *  Takes the press event so a `Holdable`'s web handler can be passed straight through. */
  onLongPress?: (e: GestureResponderEvent) => void;
  /** Web only: mirrors of the row's own hover state, so a caller rendering something hover-dependent
   *  in `right` (the trash in `SwipeableSettingsRow`) can react to hovering ANYWHERE on the row —
   *  not just the few pixels of the control itself. */
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  /** Automation selector for the row. Defaults to `settings.row.<label>`; pass an explicit id when two
   *  rows would otherwise collide on their label (see src/lib/test-id.ts). */
  testID?: string;
  /** Greys the row out and stops it pressing. A setting that doesn't apply right now is shown this
   *  way, never hidden — hiding it leaves no clue it exists or what would bring it back. Only the
   *  label side is dimmed: a control in `right` dims itself (pass it `disabled` too). */
  disabled?: boolean;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn: markHovered, onHoverOut: markUnhovered } = useHovered();
  // Web, inside a hover rail: the row stays lit while the pointer is on the rail's buttons (siblings,
  // so its own hover has ended), and its trailing slot fades out under them as they fade in.
  const rail = useContext(HoverRailContext);
  const rowTestID = testID ?? testId('settings.row', label);
  // On a pressable row the id lives on the Pressable; on a static row it lives on the root View — never
  // both, so a locator resolves to exactly one node.
  const trailing = right ?? (onPress && <ChevronRightIcon color={theme.textSecondary} size={18} />);
  const content = (highlighted?: boolean, rootTestID?: string) => (
    <View
      testID={rootTestID}
      style={[
        settingsRowFrame.row,
        onPress && styles.rowPressable,
        contentInset ? { paddingLeft: SettingsCardInset + contentInset } : null,
        highlighted && Platform.OS !== 'android' && { backgroundColor: theme.backgroundSelected },
      ]}>
      {leading && <View style={[styles.leading, disabled && styles.disabled]}>{leading}</View>}
      <View style={[settingsRowFrame.text, disabled && styles.disabled]}>
        <ThemedText type={labelBold ? 'smallBold' : 'small'} numberOfLines={1}>
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
      {rail ? (
        <View style={[HOVER_RAIL_FADE, rail.hovered && styles.trailingCovered]}>{trailing}</View>
      ) : (
        trailing
      )}
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
      onLongPress={onLongPress}
      disabled={disabled}
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
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}>
      {({ pressed }) => content(!disabled && (pressed || hovered || !!rail?.hovered))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Lays `leading` out as the row itself would: callers pass fragments (Bridges' select-mode slot +
  // icon), and a plain View stacked those, pushing the icon down by the circle's height.
  leading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: settingsRowFrame.row.gap,
  },
  disabled: {
    opacity: 0.4,
  },
  // No marginTop: the space BETWEEN sections is the container's `gap`, which never applies before
  // the first, so the first card starts at the screen's `SettingsTopGap` like every other screen.
  sectionWrap: {
    width: '100%',
  },
  card: {
    width: '100%',
    borderRadius: SettingsCardRadius,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
    paddingHorizontal: SettingsCardInset,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  plain: {
    gap: Spacing.two,
    paddingHorizontal: SettingsCardInset,
  },
  sectionFooter: {
    marginTop: Spacing.two,
    paddingHorizontal: SettingsCardInset,
  },
  trailingCovered: {
    opacity: 0,
  },
  rowPressable: {
    cursor: 'pointer',
  },
});
