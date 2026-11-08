import { createContext, use, type ReactNode } from 'react';
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

/**
 * The shape an `ActionButton` takes, set by the layout around it, so the buttons drawn inside other
 * components (download, trackers) take it too: the series page's large `hero` capsule to read, its
 * labelled `round` buttons for the rest, or a full-width `bar` anywhere else.
 */
export type ActionShape = 'bar' | 'hero' | 'round';
export const ActionShapeContext = createContext<ActionShape>('bar');

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
  /** The glyph before the label — a lucide icon, or a download progress radial. Icon and label are
   *  one centred group, the way a button reads everywhere; an icon pinned to the edge with the
   *  text centred on its own is the shape of a list row, and looked like one. */
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
  const shape = use(ActionShapeContext);
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const fill = primary ? (hovered ? theme.accentHover : theme.accent) : hovered ? theme.backgroundSelected : theme.backgroundElement;
  if (shape === 'round') {
    return (
      <Pressable
        testID={testID}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [styles.round, disabled && styles.disabled, pressed && styles.pressed]}>
        <View style={[styles.roundFace, { backgroundColor: fill }]}>
          <View style={styles.roundIcon}>{leading}</View>
        </View>
        <ThemedText numberOfLines={1} style={[styles.roundLabel, { color: theme.textSecondary }]}>
          {label}
        </ThemedText>
      </Pressable>
    );
  }
  if (shape === 'hero') {
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
        style={({ pressed }) => [styles.heroBtn, disabled && styles.disabled, pressed && styles.pressed]}>
        <View style={[styles.heroFill, { backgroundColor: fill }]}>
          {leading}
          <ThemedText
            numberOfLines={1}
            style={[styles.label, styles.heroLabel, { color: primary ? theme.accentOn : theme.text }]}>
            {label}
          </ThemedText>
          {caret && <ChevronDownIcon color={primary ? theme.accentOn : theme.textSecondary} size={14} />}
        </View>
      </Pressable>
    );
  }
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
        {leading}
        <ThemedText type="smallBold" numberOfLines={1} style={[styles.label, { color: primary ? theme.accentOn : theme.text }]}>
          {label}
        </ThemedText>
        {caret && <ChevronDownIcon color={theme.textSecondary} size={14} />}
      </ThemedView>
    </Pressable>
  );
}

/** A round button's slot, and its face centred in it. */
const ROUND_SLOT = 72;
const ROUND_FACE = 50;
/** The space a round button's slot leaves beside its face: a row pulled out by it on each side
 *  lines its outer faces up with the edges of whatever is above or below. */
export const ROUND_SIDE_SPACE = (ROUND_SLOT - ROUND_FACE) / 2;

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
    height: 36,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
  // The large capsule the series page reads from.
  heroBtn: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  heroFill: {
    height: 50,
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  heroLabel: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  // A round button with its label under it: the series page's other actions.
  round: {
    width: ROUND_SLOT,
    flexShrink: 1,
    minWidth: 56,
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  roundFace: {
    width: ROUND_FACE,
    height: ROUND_FACE,
    borderRadius: ROUND_FACE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The slot's icons are drawn for the bar's 15pt; a round button's face wants them larger.
  roundIcon: {
    transform: [{ scale: 1.35 }],
  },
  roundLabel: {
    fontSize: 12,
    lineHeight: 16,
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
