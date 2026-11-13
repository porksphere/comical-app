import { createContext, use, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronDownIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';

// The series page's actions. `primary` is the Read button, in ink: the page's text colour, so the
// cover is the only colour on the page. The system blue it had was most of what made it look like
// any app's button. The rest are subtle filled buttons (Library, Download, Favorite, Sources,
// Trackers), and one that is on turns to ink too.

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
  detail,
  progress,
  active,
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
  /** Set quietly after the label: the number of the chapter Read resumes. */
  detail?: string;
  /** How far into that chapter the reader is, 0 to 1: the `hero` capsule is the chapter, ink as far
   *  as it has been read. Absent, the capsule is solid. */
  progress?: number;
  /** A `round` button whose thing is on (saved, downloaded, favorited): its face is ink, and the
   *  caller draws `leading` in `theme.background` to stand on it. */
  active?: boolean;
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
  const subtle = hovered ? theme.backgroundSelected : theme.backgroundElement;
  const fill = primary ? theme.text : subtle;
  const onFill = primary ? theme.background : theme.text;
  const partRead = primary && progress !== undefined && progress > 0 && progress < 1;
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
        <View style={[styles.roundFace, { backgroundColor: active ? theme.text : subtle }, active && hovered && styles.inkHovered]}>
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
        <View
          style={[
            styles.heroFill,
            { backgroundColor: partRead ? theme.inkUnread : fill },
            primary && hovered && styles.inkHovered,
          ]}>
          {partRead && (
            <View style={[styles.heroRead, { width: `${progress * 100}%`, backgroundColor: theme.text }]} />
          )}
          {leading}
          <View style={styles.heroWords}>
            <ThemedText numberOfLines={1} style={[styles.label, styles.heroLabel, { color: onFill }]}>
              {label}
            </ThemedText>
            {detail !== undefined && (
              <ThemedText numberOfLines={1} style={[styles.heroDetail, { color: onFill }]}>
                {detail}
              </ThemedText>
            )}
          </View>
          {caret && <ChevronDownIcon color={primary ? onFill : theme.textSecondary} size={14} />}
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
  // The label and the number after it stand on one baseline: centred, the smaller number rode high.
  heroWords: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  heroDetail: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.8,
    fontVariant: ['tabular-nums'],
  },
  // The part of the chapter already read, from the capsule's leading edge.
  heroRead: {
    position: 'absolute',
    start: 0,
    top: 0,
    bottom: 0,
  },
  inkHovered: {
    opacity: 0.85,
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
