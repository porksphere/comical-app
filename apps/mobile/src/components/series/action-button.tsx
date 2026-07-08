import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';

// The series actions column buttons. `primary` is the accent Read button; the
// rest are subtle filled buttons (Library, Sources ▾, Trackers ▾, Favorite).
// Mirrors `.read-primary` / `#lib-toggle` etc. in the reference.

export function ActionButton({
  label,
  variant = 'default',
  caret,
  onPress,
  disabled,
}: {
  label: string;
  variant?: 'primary' | 'default';
  /** Show a trailing ▾ (Sources / Trackers menus). */
  caret?: boolean;
  onPress?: () => void;
  /** Dim and ignore presses (e.g. Read while a chaptered series' list still loads). */
  disabled?: boolean;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      accessibilityRole="button"
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
        <ThemedText
          type="smallBold"
          numberOfLines={1}
          style={primary ? { color: theme.accentOn } : undefined}>
          {label}
          {caret ? '  ▾' : ''}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

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
