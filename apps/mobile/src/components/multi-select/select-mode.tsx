/**
 * The SELECT-MODE chrome — the reusable shell around `useMultiSelect` for whole screens whose list
 * gains a multi-select mode (the per-series download screen, the Downloads page):
 *
 *  - `useSelectMode()` — the mode flag plus the ONE shared progress value that animates every row's
 *    check circle in sync (and survives view recycling).
 *  - `SelectOptionsTrigger` — the top-bar-left three-dot trigger; opens the shared frosted context
 *    menu with the caller's staging rows (Select all / Select unread / …).
 *  - `SelectToggle` — the top-bar-right circled-check that enters/exits the mode (accent while on).
 *  - `SelectLead` — the animated leading slot rows render: the check circle rides in from the
 *    physical screen edge, fading up, pushing the row's content right.
 *  - `SelectPillBar` — the floating contextual bulk verbs: frosted icon pill bottom-left (it's a
 *    full circle with one verb and stretches into a pill with more), and the accent primary circle
 *    bottom-right. Callers pass only the verbs VALID for the current selection.
 *
 * Screens own their rows, selection semantics, and verb applicability; this module owns the look.
 */
import { BlurView } from 'expo-blur';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useState } from 'react';

import { openContextMenu } from '@/components/context-menu-host';
import { ANDROID_BLUR, type MenuRowSpec } from '@/components/context-menu-material';
import type { IconProps } from '@/components/icons/ui-icons';
import { SelectModeIcon, SelectOptionsIcon } from '@/components/icons/ui-icons';
import { SelectCircle } from '@/components/multi-select/selectable-row';
import { Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

/** How long the check circles take to slide in/out of the rows. */
export const SELECT_ANIM_MS = 220;
/** The leading slot the circles occupy when open: circle + the row's gap. */
export const CIRCLE_SLOT = 20 + Spacing.three;
/** The floating bulk-verb pills. A pill with ONE action renders as a full circle (width == height);
 *  more actions stretch it horizontally into a pill. */
export const PILL_HEIGHT = 50;
export const PILL_BLUR = 55;
/** The pills' surface tints — deliberately much lighter than the menu material's, so the pills read
 *  as glass over the list rather than solid chips (the blur does the legibility work). */
export const PILL_FILL = { light: 'rgba(255,255,255,0.30)', dark: 'rgba(28,30,34,0.30)' } as const;
/** The primary (accent) pill's fill opacity, as a hex-alpha suffix on the theme accent. */
export const PILL_ACCENT_ALPHA = '99';

/** The mode flag + the one shared progress value every row's `SelectLead` animates from. */
export function useSelectMode(initial = false): {
  selecting: boolean;
  progress: SharedValue<number>;
  toggle: () => void;
  exit: () => void;
} {
  const [selecting, setSelecting] = useState(initial);
  const progress = useSharedValue(initial ? 1 : 0);
  const set = (next: boolean) => {
    setSelecting(next);
    progress.value = withTiming(next ? 1 : 0, { duration: SELECT_ANIM_MS });
  };
  return {
    selecting,
    progress,
    toggle: () => set(!selecting),
    exit: () => set(false),
  };
}

/** The top-bar-left staging trigger (a bare three-dot ellipsis): opens the shared frosted context
 *  menu at the press point with the caller's staging rows. */
export function SelectOptionsTrigger({ rows, testID }: { rows: MenuRowSpec[]; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={(e) => openContextMenu({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, rows })}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Selection options">
      <SelectOptionsIcon color={theme.text} size={24} />
    </Pressable>
  );
}

/** The top-bar-right mode toggle: a circled check, accent while the mode is on. */
export function SelectToggle({ selecting, onToggle, testID }: { selecting: boolean; onToggle: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={selecting ? 'Exit selection' : 'Select items'}>
      <SelectModeIcon color={selecting ? theme.accent : theme.text} size={24} />
    </Pressable>
  );
}

/** The animated leading slot rows render in select mode: the check circle SLIDES IN FROM THE
 *  SCREEN'S LEFT EDGE while the slot grows and pushes the row content right, fading up as it
 *  travels. The slot deliberately does NOT clip — clipped, the circle could only ever appear from
 *  the slot's own edge (at the hairline), not the screen's. `edgeOffset` is the slot's distance
 *  from the physical screen edge (the list's side padding), so the ride starts truly off-screen. */
export function SelectLead({
  progress,
  selected,
  edgeOffset,
}: {
  progress: SharedValue<number>;
  selected: boolean;
  edgeOffset: number;
}) {
  const slot = useAnimatedStyle(() => ({
    width: progress.value * CIRCLE_SLOT,
  }));
  const circle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (progress.value - 1) * (CIRCLE_SLOT + edgeOffset) }],
  }));
  return (
    <Animated.View style={[styles.selectLead, slot]}>
      <Animated.View style={circle}>
        <SelectCircle selected={selected} />
      </Animated.View>
    </Animated.View>
  );
}

/** One contextual bulk verb. Pass only verbs VALID for the current selection — the bar renders
 *  exactly what it's given (nothing is disabled-but-visible). */
export interface SelectVerb {
  key: string;
  /** Accessible label, e.g. "Pause 3 chapters". */
  label: string;
  Icon: (props: IconProps) => ReactElement;
  /** Icon colour override (danger for a delete); defaults to the theme text colour. */
  color?: string;
  onPress: () => void;
  testID: string;
}

/**
 * The floating bulk-verb layer: the secondary verbs share one frosted pill at the bottom-left, the
 * `primary` verb gets the bigger accent circle at the bottom-right. Renders nothing without verbs.
 */
export function SelectPillBar({
  verbs,
  primary,
  left,
  right,
  bottom,
}: {
  verbs: SelectVerb[];
  primary?: SelectVerb;
  left: number;
  right: number;
  bottom: number;
}) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  if (verbs.length === 0 && !primary) return null;
  return (
    <View pointerEvents="box-none" style={[styles.pills, { left, right, bottom }]}>
      {verbs.length > 0 ? (
        <View style={styles.pillShadow}>
          <BlurView tint={scheme} intensity={PILL_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={styles.pill}>
            <View pointerEvents="none" style={[styles.pillFill, { backgroundColor: PILL_FILL[scheme] }]} />
            {verbs.map((v) => (
              <Pressable
                key={v.key}
                testID={v.testID}
                onPress={v.onPress}
                style={styles.pillButton}
                accessibilityRole="button"
                accessibilityLabel={v.label}>
                <v.Icon color={v.color ?? theme.text} size={20} />
              </Pressable>
            ))}
          </BlurView>
        </View>
      ) : (
        <View />
      )}
      {primary && (
        <View style={styles.pillShadow}>
          <BlurView tint={scheme} intensity={PILL_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={styles.pill}>
            {/* Translucent accent over the blur — reads blue while the page still bleeds through. */}
            <View pointerEvents="none" style={[styles.pillFill, { backgroundColor: `${theme.accent}${PILL_ACCENT_ALPHA}` }]} />
            <Pressable
              testID={primary.testID}
              onPress={primary.onPress}
              style={styles.pillButton}
              accessibilityRole="button"
              accessibilityLabel={primary.label}>
              <primary.Icon color={theme.accentOn} size={22} />
            </Pressable>
          </BlurView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The animated leading slot the circle slides into. NOT clipped — the circle rides in from the
  // physical screen edge, outside the slot's own bounds (its fade keeps it invisible at rest).
  selectLead: {
    justifyContent: 'center',
  },
  // The floating layer: pills at the two bottom corners, taps pass through between them.
  pills: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  // Shadow lives on an unclipped wrapper — the BlurView inside must clip to its radius.
  pillShadow: {
    borderRadius: PILL_HEIGHT / 2,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // Each icon button is exactly one pill-height square, so ONE action renders as a full circle and
  // additional icons stretch the pill horizontally on their own — no per-count styling.
  pill: {
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pillButton: {
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
