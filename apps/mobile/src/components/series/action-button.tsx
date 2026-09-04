import { type ReactNode } from 'react';
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
   *  button in the column fills it, so the glyphs line up down the column and the labels start
   *  from one edge; an empty slot is kept, not collapsed, for the same reason. */
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
        style={[
          styles.fill,
          primary && { backgroundColor: hovered ? theme.accentHover : theme.accent },
          // Brighten (not dim) on hover — same neutral-surface treatment as the
          // chapter-tab strip, so hover reads consistently across the screen.
          !primary && hovered && { backgroundColor: theme.backgroundSelected },
        ]}>
        <View style={styles.iconSlot}>{leading}</View>
        <ThemedText type="smallBold" numberOfLines={1} style={[styles.label, { color: onColor }]}>
          {label}
        </ThemedText>
        {caret && <ChevronDownIcon color={theme.textSecondary} size={14} />}
      </ThemedView>
    </Pressable>
  );
}

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
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconSlot: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Centred in whatever the icon slot (and a caret) leave: the glyphs stay in one column down the
  // buttons, and the labels sit in the middle of the rest rather than hugging the slot.
  label: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
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
