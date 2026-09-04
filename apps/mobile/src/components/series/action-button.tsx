import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
  sublabel,
  variant = 'default',
  caret,
  leading,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: {
  label: string;
  /** A second, quieter line under the label — the chapter a Resume lands on. The label stays a
   *  short verb so it always fits; the part that can run long gets its own line to be cut on,
   *  instead of the verb being clipped along with it in a column 40% of a phone's width. */
  sublabel?: string;
  variant?: 'primary' | 'default';
  /** Show a trailing ▾ (Sources / Trackers menus). */
  caret?: boolean;
  /** Optional glyph before the label (e.g. a download progress radial). */
  leading?: ReactNode;
  onPress?: () => void;
  /** Dim and ignore presses (e.g. Read while a chaptered series' list still loads). */
  disabled?: boolean;
  /** Read out instead of the label(s) — when the visible text alone is ambiguous. */
  accessibilityLabel?: string;
  /** Automation selector — required so every action button is reachable (see src/lib/test-id.ts). */
  testID: string;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  const onColor = primary ? { color: theme.accentOn } : undefined;
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
        <View style={[styles.text, leading ? styles.textWithLeading : undefined]}>
          <ThemedText type="smallBold" numberOfLines={1} style={onColor}>
            {label}
            {caret ? '  ▾' : ''}
          </ThemedText>
          {sublabel ? (
            <ThemedText type="small" numberOfLines={1} style={[styles.sublabel, onColor]}>
              {sublabel}
            </ThemedText>
          ) : null}
        </View>
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
    justifyContent: 'center',
  },
  // The text column shrinks (never the glyph beside it), and centres its lines like the single-line
  // button always did; `minWidth: 0` is what lets a long sublabel ellipsize on web instead of
  // widening the button past its column.
  text: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  textWithLeading: {
    marginLeft: Spacing.two,
  },
  sublabel: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.85,
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
