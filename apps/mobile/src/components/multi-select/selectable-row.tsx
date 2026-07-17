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
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { Holdable } from '@/components/context-menu';
import { CheckIcon } from '@/components/icons/ui-icons';
import { settingsRowFrame } from '@/components/settings/settings-row';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The tick's fade — quick enough to read as a direct response to the tap. */
const CHECK_FADE_MS = 110;

/** The bare check circle — the multi-select mark itself, for rows that compose their own chrome
 *  (e.g. the per-series download screen's animated leading slot).
 *
 *  Selecting is a plain FADE: the fill disc (with its check) fades up over the ring while the
 *  ring's colour follows — no scaling, so the fill always sits pixel-perfect inside its ring.
 *  Driven by a derived timing, so a freshly-mounted circle renders its state instantly (no mount
 *  animation — recycled list views would otherwise ripple while scrolling); only a real toggle
 *  plays it. */
export function SelectCircle({ selected, done }: { selected: boolean; done?: boolean }) {
  const theme = useTheme();
  const on = selected || !!done;
  const fillColor = done ? theme.textSecondary : theme.accent;
  const p = useDerivedValue(() => withTiming(on ? 1 : 0, { duration: CHECK_FADE_MS }));
  const ring = useAnimatedStyle(() => ({
    borderColor: interpolateColor(p.value, [0, 1], [theme.textSecondary, fillColor]),
  }));
  const fill = useAnimatedStyle(() => ({
    opacity: p.value,
  }));
  return (
    <Animated.View style={[styles.circle, ring]}>
      <Animated.View style={[styles.circleFill, { backgroundColor: fillColor }, fill]}>
        <CheckIcon color={theme.accentOn} size={11} />
      </Animated.View>
    </Animated.View>
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
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // The disc that springs up from the centre on selection, carrying the check with it.
  circleFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  done: {
    opacity: 0.55,
  },
});
