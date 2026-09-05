import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronDownIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';

// The series actions column buttons. `primary` is the accent Read button; the
// rest are subtle filled buttons (Library, Sources ▾, Trackers ▾, Favorite).
// Mirrors `.read-primary` / `#lib-toggle` etc. in the reference.

export function ActionButton({
  label,
  variant = 'default',
  caret,
  leading,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: {
  label: string;
  variant?: 'primary' | 'default';
  /** Show a trailing chevron (Sources / Trackers menus). */
  caret?: boolean;
  /** The glyph in the button's icon slot — a lucide icon, or a download progress radial. Every
   *  button in the column fills it, so the glyphs line up down the column; an empty slot is kept,
   *  not collapsed, for the same reason. */
  leading?: ReactNode;
  onPress?: () => void;
  /** Dim and ignore presses (e.g. Read while a chaptered series' list still loads). */
  disabled?: boolean;
  /** Read out instead of the label — when the visible text alone is ambiguous. */
  accessibilityLabel?: string;
  /** Automation selector — required so every action button is reachable (see src/lib/test-id.ts). */
  testID: string;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const onColor = primary ? theme.accentOn : theme.text;

  // The label sits on the button's TRUE centre — not the centre of what the icon leaves — and is
  // only pushed right once it would otherwise run into the icon. That needs two widths the layout
  // has to report: the button's and the label's own. From those: where a centred label's left edge
  // would fall, and how far right of the icon's bound it has to move to stay clear of it. The
  // label's width is capped at the span between icon and caret, so a long label also ellipsizes
  // rather than running under either.
  const [fillWidth, setFillWidth] = useState(0);
  const [labelWidth, setLabelWidth] = useState(0);
  const leftBound = FILL_PAD + ICON_SLOT + SLOT_GAP;
  const rightBound = FILL_PAD + (caret ? CARET + SLOT_GAP : 0);
  const available = Math.max(0, fillWidth - leftBound - rightBound);
  const centredLeft = fillWidth / 2 - labelWidth / 2;
  const shift = fillWidth > 0 ? Math.max(0, leftBound - centredLeft) : 0;

  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.btn, disabled && styles.disabled, pressed && styles.pressed]}>
      <ThemedView
        type={primary ? undefined : 'backgroundElement'}
        onLayout={(e) => setFillWidth(e.nativeEvent.layout.width)}
        style={[
          styles.fill,
          primary && { backgroundColor: hovered ? theme.accentHover : theme.accent },
          // Brighten (not dim) on hover — same neutral-surface treatment as the
          // chapter-tab strip, so hover reads consistently across the screen.
          !primary && hovered && { backgroundColor: theme.backgroundSelected },
        ]}>
        <View style={styles.iconSlot}>{leading}</View>
        <View style={styles.labelLayer} pointerEvents="none">
          <ThemedText
            type="smallBold"
            numberOfLines={1}
            onLayout={(e) => setLabelWidth(e.nativeEvent.layout.width)}
            style={[
              { color: onColor },
              available > 0 && { maxWidth: available },
              { transform: [{ translateX: shift }] },
            ]}>
            {label}
          </ThemedText>
        </View>
        {caret && <ChevronDownIcon color={theme.textSecondary} size={CARET} />}
      </ThemedView>
    </Pressable>
  );
}

const FILL_PAD = Spacing.three;
const ICON_SLOT = 18;
const SLOT_GAP = Spacing.two;
const CARET = 14;

/** The size every icon in the slot is drawn at, so a play glyph and a star sit on one baseline. */
export const ACTION_ICON_SIZE = 15;

/** The amber "N new" pill shown in the actions column. */
export function NewBadge({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.newBadge, { backgroundColor: theme.badgeNew }]}>
      <ThemedText style={[styles.newBadgeText, { color: theme.badgeNewOn }]}>
        {count} new
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    ...ContinuousCorner,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
  fill: {
    // A set height rather than padding-driven: the label is out of flow (see `labelLayer`), so
    // nothing in flow would otherwise give the row its height. Matches the old padding + line.
    height: 36,
    paddingHorizontal: FILL_PAD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconSlot: {
    width: ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The label's own layer over the whole button, centred; its translate is what keeps it off the
  // icon (see the measurement in the component).
  labelLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  newBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
