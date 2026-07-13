import { type ReactNode, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TrashIcon } from '@/components/icons/ui-icons';
import { SettingsGutter, SettingsRow } from '@/components/settings/settings-row';
import { Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';
import { claimOpenRow, releaseOpenRow } from '@/lib/swipe-row-registry';

const PILL_WIDTH = 60;
const PILL_GAP = Spacing.two;
/** How far the row slides: enough to clear the pill, the gap before it, and the screen's gutter. */
const OPEN_X = SettingsGutter + PILL_WIDTH + PILL_GAP;
/** Corner radius the row's trailing edge grows to as it opens into a slot. */
const SLOT_RADIUS = 14;

/** Snappy rather than floaty — it should arrive, not glide. Slightly under-damped so the pill has a
 *  little life on the way in, which is the part that made the old linear tracking feel dead. */
const SPRING = { damping: 18, stiffness: 260, mass: 0.6 } as const;

// Constant for the process, so the branch in `SwipeableSettingsRow` is stable and each platform
// only ever renders one of the two implementations below — their hooks never interleave.
const IS_WEB = Platform.OS === 'web';

// Whether this web client has a hovering pointer at all. A touchscreen laptop/tablet on web fires no
// hover events ever, so a hover-revealed trash would be permanently invisible there — those clients
// get it shown outright instead.
const CAN_HOVER = IS_WEB && typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;


type Props = {
  label: string;
  description?: string;
  descriptionColor?: string;
  leading?: ReactNode;
  /** Tapping the row body (e.g. opening the item's detail page). */
  onPress?: () => void;
  /** Caption under the pill in the revealed action. */
  actionLabel?: string;
  /** Invoked when the user commits to the destructive action — open a confirm overlay here. */
  onAction: () => void;
};

/**
 * A `SettingsRow` whose destructive action is reached by swiping. Dragging left slides the row
 * away; its trailing edge rounds into a slot as it goes, and a rounded red pill springs in beside
 * it — the iOS Notes shape. The swipe alone never destroys anything: you then tap the pill, and
 * `onAction` should still confirm.
 *
 * Hand-rolled on a pan gesture rather than gesture-handler's `ReanimatedSwipeable`, which only hands
 * the drag progress to the ACTION it renders — the row itself can't see it, so there'd be no way to
 * round the row's corners in step with the drag.
 *
 * Android gets the same rest-open behavior rather than Material's fling-to-dismiss: dismissal there
 * is only safe paired with an undo snackbar, and this app has no snackbar system.
 *
 * On web there is no swipe at all — dragging a row with a mouse is not something anyone would try.
 * The row instead reveals a trash button on hover (and shows it unconditionally on a touch screen,
 * which never hovers).
 */
export function SwipeableSettingsRow(props: Props) {
  return IS_WEB ? <HoverDeleteRow {...props} /> : <SwipeRow {...props} />;
}

function SwipeRow({ label, description, descriptionColor, leading, onPress, actionLabel = 'Delete', onAction }: Props) {
  const theme = useTheme();
  const tx = useSharedValue(0);
  // Whether the row is resting open. A shared value rather than a ref: the pan worklet needs it on
  // the UI thread, the tap handler reads it on the JS thread, and — unlike a ref — the compiler
  // permits closing over it in the gesture callbacks (react-hooks/refs).
  const isOpen = useSharedValue(false);
  // Stable per-row identity for `swipe-row-registry`. Lazy state, not a ref, for the same reason.
  const [token] = useState(() => ({}));

  // Deliberately NOT useCallback: a shared value listed in a hook's dependency array may not then be
  // mutated (react-hooks/immutability, which the React Compiler enforces here). These are cheap
  // closures, and the compiler memoizes what's worth memoizing.
  function close() {
    isOpen.value = false;
    releaseOpenRow(token);
    tx.value = withSpring(0, SPRING);
  }

  function open() {
    claimOpenRow(token, close); // closes whichever row was open before this one
    isOpen.value = true;
    hapticImpactLight();
    tx.value = withSpring(-OPEN_X, SPRING);
  }

  const pan = Gesture.Pan()
    // Only claim the gesture once it's clearly horizontal, so vertical scrolling of the list still
    // belongs to the ScrollView.
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      'worklet';
      const from = isOpen.value ? -OPEN_X : 0;
      // Clamp: there's nothing to reveal past the pill, and nothing to the row's left at all.
      tx.value = Math.min(0, Math.max(-OPEN_X, from + e.translationX));
    })
    .onEnd((e) => {
      'worklet';
      // Velocity, not just position — a quick flick should open even if it barely travelled, which
      // is most of what makes this feel responsive rather than draggy.
      const shouldOpen = tx.value < -OPEN_X / 2 || e.velocityX < -500;
      if (shouldOpen) runOnJS(open)();
      else runOnJS(close)();
    });

  /** 0 closed → 1 fully open. Everything visual hangs off this. */
  const progress = useDerivedValue(() => -tx.value / OPEN_X);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    borderTopRightRadius: progress.value * SLOT_RADIUS,
    borderBottomRightRadius: progress.value * SLOT_RADIUS,
    // At rest the row is indistinguishable from the page (an edge-to-edge list, not a card); as it
    // opens it lifts onto the elevated surface, which is what makes the rounded slot legible.
    backgroundColor: interpolateColor(progress.value, [0, 1], [theme.background, theme.backgroundElement]),
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.7 + progress.value * 0.3 }],
  }));

  return (
    <View style={styles.swipeContainer}>
      {/* Notes puts a caption under its pills, but our rows are half the height of a Notes row —
          there is no room for one without the pill shrinking to a dot. The glyph plus the
          accessibility label carry it. */}
      <Animated.View style={[styles.pillSlot, pillStyle]} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            hapticImpactLight();
            close();
            onAction();
          }}
          style={[styles.pill, { backgroundColor: theme.danger }]}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} ${label}`}>
          <TrashIcon color={theme.accentOn} size={20} />
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          <SettingsRow
            label={label}
            description={description}
            descriptionColor={descriptionColor}
            leading={leading}
            escapeGutter={false}
            // A tap on an open row closes it instead of navigating — the same rule iOS lists use, and
            // without it the tap that "cancels" a swipe would silently push a screen.
            onPress={onPress && (() => (isOpen.value ? close() : onPress()))}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function HoverDeleteRow({ label, description, descriptionColor, leading, onPress, actionLabel = 'Delete', onAction }: Props) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  // The trash is a SIBLING of the row, not something inside its `right` slot: react-native-web
  // renders an accessibilityRole="button" Pressable as a real <button>, and a <button> inside a
  // <button> is invalid HTML — React rejects it, and the two click targets overlap. So the trash
  // gets its own lane to the row's right, which is also exactly where the pill sits on native.
  // Both halves feed the same `hovered`, so crossing from the row onto the trash doesn't hide it.
  return (
    <View style={styles.webRow}>
      <View style={styles.webRowBody}>
        <SettingsRow
          label={label}
          description={description}
          descriptionColor={descriptionColor}
          leading={leading}
          escapeGutter={false}
          onPress={onPress}
          onHoverIn={onHoverIn}
          onHoverOut={onHoverOut}
        />
      </View>
      <Pressable
        onPress={onAction}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        // Faded out until the pointer is somewhere over the row. Pointer-less clients (a touchscreen
        // on web fires no hover events at all) keep it visible — see CAN_HOVER.
        style={[styles.webTrash, CAN_HOVER && !hovered && styles.webTrashIdle]}
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel} ${label}`}>
        <TrashIcon color={theme.danger} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    // Cancels the screen's gutter so the row (and the slot it opens into) reaches the screen's edge.
    marginHorizontal: -SettingsGutter,
    // The row slides out under its own left edge; without this it would paint over the neighbouring
    // rows as it goes.
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pillSlot: {
    position: 'absolute',
    right: SettingsGutter,
    // Stretched to the row's height (which varies — a row with a status line is taller), with the
    // pill flexing to fill it minus a hair of breathing room. Pinning a fixed pill height instead
    // would leave it floating off-centre on the taller rows.
    top: Spacing.one,
    bottom: Spacing.one,
    width: PILL_WIDTH,
  },
  pill: {
    flex: 1,
    borderRadius: SLOT_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // Cancels the screen's gutter for the same reason the native swipe container does: the row's
    // hover highlight should reach the screen's edge, and the trash lane should sit in the margin
    // rather than inside the text column.
    marginHorizontal: -SettingsGutter,
  },
  webRowBody: {
    flex: 1,
  },
  webTrash: {
    justifyContent: 'center',
    alignItems: 'center',
    // A fixed lane, so the trash occupies the same space whether or not it's currently shown and
    // the row's text never reflows as it fades in.
    width: SettingsGutter + 20,
    paddingRight: SettingsGutter,
    cursor: 'pointer',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  webTrashIdle: {
    opacity: 0,
  },
});
