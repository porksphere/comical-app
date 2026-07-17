/**
 * The multi-select row chrome: a leading check circle wrapping arbitrary row content. Selection is
 * ALWAYS passed in (`selected`) and never held locally, so the row is safe inside a recycled
 * `LegendList` — a reused view can't carry a stale checkmark. `done` renders the settled variant
 * (checked-but-muted, non-interactive): "already have this", distinct from "selected to act on".
 *
 * Two presentations:
 *  - `card` (default) — the bordered, rounded overlay row (popover/sheet pickers).
 *  - `list` — a flat full-bleed row at the settings-standard height/gutter, for whole screens whose
 *    content IS the selectable list (the download-selection screen); the screen draws its own
 *    hairline dividers between rows.
 *
 * The range-fill long-press goes through the shared `Holdable` (a gesture-handler LongPress) — a
 * `Pressable`'s `onLongPress` doesn't fire reliably inside iOS scroll views.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useDerivedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Holdable } from '@/components/context-menu';
import { CheckIcon } from '@/components/icons/ui-icons';
import { settingsRowFrame } from '@/components/settings/settings-row';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The fill/ring snap — near-instant, the direct response to the tap. */
const FILL_MS = 60;
/** The check draws in AFTER the fill lands: a beat later, and slower — a two-stage tick. */
const CHECK_DELAY_MS = 40;
const CHECK_MS = 170;

/** The bare check circle — the multi-select mark itself, for rows that compose their own chrome
 *  (e.g. the per-series download screen's animated leading slot).
 *
 *  Selecting is a TWO-STAGE tick: the fill disc and ring colour snap in near-instantly (the tap's
 *  direct response), then the check draws in a beat later and slower (a soft scale+fade). The fill
 *  never scales, so it stays pixel-perfect inside its ring. Driven by derived timings, so a
 *  freshly-mounted circle renders its state instantly (no mount animation — recycled list views
 *  would otherwise ripple while scrolling); only a real toggle plays it. */
export function SelectCircle({ selected, done }: { selected: boolean; done?: boolean }) {
  const theme = useTheme();
  const on = selected || !!done;
  const fillColor = done ? theme.textSecondary : theme.accent;
  // Two stages: the fill + ring colour snap in near-instantly (the tap's direct response), then the
  // check draws in a beat later and slower. Deselecting drops everything fast together.
  const p = useDerivedValue(() => withTiming(on ? 1 : 0, { duration: FILL_MS }));
  const check = useDerivedValue(() =>
    on
      ? withDelay(CHECK_DELAY_MS, withTiming(1, { duration: CHECK_MS, easing: Easing.out(Easing.cubic) }))
      : withTiming(0, { duration: FILL_MS }),
  );
  const ring = useAnimatedStyle(() => ({
    borderColor: interpolateColor(p.value, [0, 1], [theme.textSecondary, fillColor]),
  }));
  const fill = useAnimatedStyle(() => ({
    opacity: p.value,
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: 0.4 + 0.6 * check.value }],
  }));
  // Ring and fill are SIBLING layers of one borderless box, both absolutely filling it — never a
  // child inside the ring's border box, whose 1.5px inset subpixel-snaps and reads as the disc
  // sitting slightly down-and-right of the ring.
  return (
    <View style={styles.circleBox}>
      <Animated.View style={[styles.circleLayer, styles.circleRing, ring]} />
      <Animated.View style={[styles.circleLayer, { backgroundColor: fillColor }, fill]}>
        <Animated.View style={checkStyle}>
          <CheckIcon color={theme.accentOn} size={11} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function SelectableRow({
  selected,
  done,
  onToggle,
  onRangeFill,
  trailing,
  variant = 'card',
  children,
  testID,
}: {
  selected: boolean;
  /** Settled (e.g. already downloaded): checked-but-muted and non-interactive. */
  done?: boolean;
  onToggle: () => void;
  /** Long-press: select the span from the last toggled row to this one. */
  onRangeFill: () => void;
  /** Right-aligned slot (e.g. a download-state glyph). */
  trailing?: ReactNode;
  /** `card` = bordered overlay row; `list` = flat settings-height row (see module docstring). */
  variant?: 'card' | 'list';
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const inner = (
    <>
      <SelectCircle selected={selected} done={done} />
      <View style={styles.content}>{children}</View>
      {trailing}
    </>
  );
  return (
    <Holdable enabled={!done} onHold={() => onRangeFill()}>
      {({ onLongPress }) => (
        <Pressable
          testID={testID}
          onPress={done ? undefined : onToggle}
          onLongPress={onLongPress}
          disabled={done}
          android_ripple={variant === 'list' ? { color: theme.backgroundSelected } : undefined}
          style={done && styles.done}>
          {({ pressed }) =>
            variant === 'list' ? (
              <View
                style={[
                  settingsRowFrame.row,
                  settingsRowFrame.escape,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                {inner}
              </View>
            ) : (
              <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.hairline }]}>
                {inner}
              </ThemedView>
            )
          }
        </Pressable>
      )}
    </Holdable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  circleBox: {
    width: 20,
    height: 20,
  },
  // One 20px layer — the ring and the fill both use it, so they can't disagree about geometry.
  circleLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleRing: {
    borderWidth: 1.5,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  done: {
    opacity: 0.55,
  },
});
