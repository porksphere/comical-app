import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, LinearTransition } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';

/** The strip's height, for a control that sits in a row with one. */
export const SEGMENTED_HEIGHT = 32;
const PAD = 3;
const GAP = 4;

/** A row of mutually-exclusive options with a sliding highlight pill behind
 *  the active one — the chapter tab strip (All/Read/Unread) and a comment
 *  thread's sort are both one of these. Each option is sized to its
 *  own content (not an equal slice of the strip), so the pill's geometry has
 *  to be measured per-option via `onLayout` rather than computed from a
 *  shared segment width.
 *
 *  The pill animates via Reanimated's `layout` prop (`LinearTransition`)
 *  instead of a hand-rolled `useSharedValue`/`withTiming` pair driven from a
 *  `useEffect` — that JS-side approach could visibly snap the pill to the
 *  strip's left edge for a frame before sliding to the new tab (a stale
 *  `activeBox` briefly reading as unmeasured on some renders). `layout`
 *  hands the interpolation to the UI thread instead: it only animates a
 *  transition between two committed layouts of an already-mounted view, so
 *  there's no intermediate JS-computed frame to glitch through. On first
 *  mount there's nothing to transition from, so it just appears in place —
 *  no unwanted slide-in. */
export function Segmented<T extends string>({
  options,
  active,
  onChange,
  fill = false,
}: {
  options: { id: T; render: (active: boolean) => ReactNode; accessibilityLabel?: string; testID: string }[];
  active: T;
  onChange: (id: T) => void;
  /** The strip takes the row's width and its options share it equally, for a row too narrow for
   *  options at their own widths. */
  fill?: boolean;
}) {
  const theme = useTheme();
  const [layouts, setLayouts] = useState<Partial<Record<T, { x: number; width: number }>>>({});
  const onOptLayout = (id: T, x: number, width: number) => {
    setLayouts((prev) => (prev[id]?.x === x && prev[id]?.width === width ? prev : { ...prev, [id]: { x, width } }));
  };
  const activeBox = layouts[active];
  return (
    <ThemedView type="backgroundElement" style={[styles.strip, fill && styles.stripFill]}>
      {activeBox && (
        <Animated.View
          pointerEvents="none"
          // A real spring (`.springify()`) only runs as physics on native — the
          // web fallback for layout animations (react-native-web) is a CSS
          // keyframe that ignores damping/stiffness/mass entirely and falls
          // back to a linear curve, so the "spring" was invisible on web. An
          // explicit overshoot bezier (the standard ease-out-back curve) gives
          // the same bounce-then-settle feel on both, since it's just a plain
          // easing curve rather than physics.
          layout={LinearTransition.duration(260).easing(Easing.bezier(0.34, 1.2, 0.64, 1))}
          style={[
            styles.pill,
            {
              backgroundColor: theme.chipFill,
              left: activeBox.x,
              width: activeBox.width,
            },
          ]}
        />
      )}
      {options.map((opt) => (
        <SegmentButton
          key={opt.id}
          testID={opt.testID}
          active={opt.id === active}
          fill={fill}
          accessibilityLabel={opt.accessibilityLabel}
          onPress={() => onChange(opt.id)}
          onLayout={(x, width) => onOptLayout(opt.id, x, width)}>
          {opt.render(opt.id === active)}
        </SegmentButton>
      ))}
    </ThemedView>
  );
}

/** An option's text, in the strip's own type. */
export function SegmentLabel({ label, active }: { label: string; active: boolean }) {
  const theme = useTheme();
  return (
    <ThemedText
      type="small"
      numberOfLines={1}
      style={[styles.label, active ? { color: theme.chipText, fontWeight: '600' } : { color: theme.textSecondary }]}>
      {label}
    </ThemedText>
  );
}

/** One `Segmented` option button. Its own component (rather than a raw
 *  `Pressable` inside `options.map`) so each option gets its own `useHovered`
 *  call — same reasoning as chip.tsx's `PressableChip`. */
function SegmentButton({
  active,
  fill,
  accessibilityLabel,
  testID,
  onPress,
  onLayout,
  children,
}: {
  active: boolean;
  fill: boolean;
  accessibilityLabel?: string;
  testID: string;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        fill ? styles.optionFill : styles.option,
        // Brighten (not dim) on hover — never on the already-highlighted
        // active option, which already reads as selected via the pill.
        hovered && !active && { backgroundColor: theme.backgroundSelected },
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    // Content-sized (not `flex: 1` on each child, and not `flex: 1` on the
    // strip itself) — an option's width follows its own label, so "All" and
    // "Unread" don't get forced to the same width, and the whole strip
    // doesn't stretch to the row's full width leaving a big dead-space pill
    // before whatever stands beside it. Fixed height rather than letting
    // padding drive it, so a row of controls reads as one consistent height.
    height: SEGMENTED_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: SEGMENTED_HEIGHT / 2,
    padding: PAD,
    gap: GAP,
  },
  // `minWidth: 0` lets it shrink on react-native-web (default `min-width: auto` would overflow).
  stripFill: {
    flex: 1,
    minWidth: 0,
  },
  // Tighter padding than `option`, so even the longest label fits its share without pushing the
  // strip wider.
  optionFill: {
    flex: 1,
    height: SEGMENTED_HEIGHT - PAD * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    borderRadius: SEGMENTED_HEIGHT / 2 - PAD,
  },
  // Sliding highlight behind the active option — sized to
  // exactly overlay the active option's own rect (same top/bottom inset from
  // the strip's padding, same radius as `option`), so the selected
  // state reads as the same shape as the hover highlight, just filled with
  // the accent color instead of `backgroundSelected`. x/width come from the
  // active option's own measured layout, and transition via the `layout` prop
  // when that changes.
  pill: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: 0,
    borderRadius: SEGMENTED_HEIGHT / 2 - PAD,
  },
  option: {
    height: SEGMENTED_HEIGHT - PAD * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: SEGMENTED_HEIGHT / 2 - PAD,
  },
  label: {
    fontSize: 13,
    textAlign: 'center',
  },
});
