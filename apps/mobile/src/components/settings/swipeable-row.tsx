import { type ComponentType, type ReactNode, useState } from 'react';
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

import { SettingsRow } from '@/components/settings/settings-row';
import { SettingsGutter, Spacing } from '@/constants/theme';
import { useHovered } from '@/hooks/use-hovered';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';
import { claimOpenRow, releaseOpenRow } from '@/lib/swipe-row-registry';

const PILL_WIDTH = 60;
const PILL_GAP = Spacing.two;
/** Corner radius the row's trailing edge grows to as it opens into a slot. */
const SLOT_RADIUS = 14;
/** How many action bubbles fit a row before they'd run past the screen / crowd the content. Beyond
 *  this, extra actions are dropped (and a dev-build error is logged — see `clampActions`). Three
 *  60px pills plus gaps and the gutter already reach ~230px, about as far as a phone row can give. */
const MAX_ROW_ACTIONS = 3;

/** Tuned for a visible trail: soft enough that the row lags a little behind the finger and has to
 *  catch up, stiff and damped enough that it still arrives promptly and doesn't wobble past the
 *  open position. Raising `stiffness` collapses the lag back toward 1:1 tracking. */
const SPRING = { damping: 22, stiffness: 200, mass: 0.7 } as const;

// Constant for the process, so the branch in `SwipeableSettingsRow` is stable and each platform
// only ever renders one of the two implementations below — their hooks never interleave.
const IS_WEB = Platform.OS === 'web';

// Whether this web client has a hovering pointer at all. A touchscreen laptop/tablet on web fires no
// hover events ever, so hover-revealed actions would be permanently invisible there — those clients
// get them shown outright instead.
const CAN_HOVER = IS_WEB && typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;

/** One trailing swipe/hover action. The `icon` is a glyph component from `@/components/icons/ui-icons`
 *  (they all take `{ color, size }`). `destructive` paints the action in the danger colour (a delete);
 *  everything else gets the accent colour (rename, edit, …). */
export type SwipeRowAction = {
  /** Stable list key; defaults to `label`. Set it when two actions could share a label. */
  key?: string;
  /** Verb for the action, e.g. "Delete" / "Rename". Used as the a11y label (`"{label} {row}"`). */
  label: string;
  icon: ComponentType<{ color: string; size?: number }>;
  onPress: () => void;
  /** Danger-coloured (a delete) vs accent-coloured (the default). */
  destructive?: boolean;
};

type Props = {
  label: string;
  description?: string;
  descriptionColor?: string;
  leading?: ReactNode;
  /** Tapping the row body (e.g. opening the item's detail page). */
  onPress?: () => void;
  /**
   * The trailing actions, laid out left→right — so the LAST one sits at the screen edge (the natural
   * primary/destructive slot). At least one; at most `MAX_ROW_ACTIONS` (extra are dropped with a
   * dev-build error). A row with no destructive/secondary actions should just be a plain `SettingsRow`.
   */
  actions: SwipeRowAction[];
};

/** Clamp to what fits, and shout in a dev build when a caller over- (or under-) fills the row — a
 *  `console.error` surfaces in the Metro logs and the RN LogBox, without crashing a release build. */
function clampActions(actions: SwipeRowAction[], rowLabel: string): SwipeRowAction[] {
  if (__DEV__) {
    if (actions.length === 0) {
      console.error(
        `SwipeableSettingsRow ("${rowLabel}") was given no actions. A swipeable row needs at least one; use a plain SettingsRow if it has none.`,
      );
    } else if (actions.length > MAX_ROW_ACTIONS) {
      console.error(
        `SwipeableSettingsRow ("${rowLabel}") was given ${actions.length} actions, but at most ${MAX_ROW_ACTIONS} fit a row. Dropping the last ${actions.length - MAX_ROW_ACTIONS}.`,
      );
    }
  }
  return actions.length > MAX_ROW_ACTIONS ? actions.slice(0, MAX_ROW_ACTIONS) : actions;
}

/**
 * A `SettingsRow` whose actions are reached by swiping. Dragging left slides the row away; its
 * trailing edge rounds into a slot as it goes, and the action pills are uncovered beneath it — the
 * iOS Notes shape. A swipe alone never commits anything: you then tap a pill (a destructive pill's
 * handler should still confirm).
 *
 * Generic over its `actions` (up to `MAX_ROW_ACTIONS`): a delete, a rename, an edit — any mix. The
 * last action sits at the screen edge. The swipe is DETENTED — it reveals one pill at a time, with a
 * haptic tick as each clears, and rests at whichever pill count you release on (so a two-action row
 * can rest showing just the edge action, or both). Hand-rolled on a pan gesture rather than gesture-handler's
 * `ReanimatedSwipeable`, which only hands the drag progress to the ACTION it renders — the row itself
 * can't see it, so there'd be no way to round the row's corners in step with the drag.
 *
 * Android gets the same rest-open behavior rather than Material's fling-to-dismiss: dismissal there
 * is only safe paired with an undo snackbar, and this app has no snackbar system.
 *
 * On web there is no swipe at all — dragging a row with a mouse is not something anyone would try.
 * The row instead reveals the action buttons on hover (and shows them unconditionally on a touch
 * screen, which never hovers).
 */
export function SwipeableSettingsRow({ actions, ...rest }: Props) {
  const shown = clampActions(actions, rest.label);
  return IS_WEB ? <HoverActionsRow {...rest} actions={shown} /> : <SwipeRow {...rest} actions={shown} />;
}

function SwipeRow({ label, description, descriptionColor, leading, onPress, actions }: Props) {
  const theme = useTheme();
  // Where the row is BEING DRAGGED to — set straight from the finger, with no smoothing.
  const target = useSharedValue(0);
  // Which detent the row is resting at: 0 = closed, k = k action pills revealed. The swipe stops one
  // pill at a time, so this is an index, not a boolean. Read on the JS thread by the tap handler.
  const restIndex = useSharedValue(0);
  // How many pills are fully revealed at the CURRENT drag position — compared frame to frame so a
  // haptic ticks exactly as each new pill clears the edge (in either direction).
  const crossLevel = useSharedValue(0);
  // Stable per-row identity for `swipe-row-registry`. Lazy state, not a ref, for the same reason.
  const [token] = useState(() => ({}));

  const pillCount = Math.max(1, actions.length);
  // Rest positions along the drag: detents[0] = 0 (closed), detents[k] = far enough to reveal k pills;
  // detents[pillCount] is fully open. A plain number array, captured into the worklets by value.
  const detents: number[] = [0];
  for (let k = 1; k <= pillCount; k++) detents.push(SettingsGutter + k * (PILL_WIDTH + PILL_GAP));
  const openX = detents[pillCount];

  // Deliberately NOT useCallback: a shared value listed in a hook's dependency array may not then be
  // mutated (react-hooks/immutability, which the React Compiler enforces here). These are cheap
  // closures, and the compiler memoizes what's worth memoizing.
  function close() {
    restIndex.value = 0;
    crossLevel.value = 0;
    releaseOpenRow(token);
    target.value = 0;
  }

  // After a drag settles on a detent (JS thread): keep the "only one row open at a time" registry in
  // sync — an open row registers its own close, a closed one releases.
  function settle(index: number) {
    if (index > 0) claimOpenRow(token, close);
    else releaseOpenRow(token);
  }

  const pan = Gesture.Pan()
    // Only claim the gesture once it's clearly horizontal, so vertical scrolling of the list still
    // belongs to the ScrollView.
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      'worklet';
      // Track haptics from wherever the row is currently resting, so resuming a drag from an already
      // open detent doesn't fire a spurious tick on the first frame.
      crossLevel.value = restIndex.value;
    })
    .onUpdate((e) => {
      'worklet';
      const from = -detents[restIndex.value];
      // Clamp: nothing to reveal past the last pill, and nothing to the row's left at all.
      const t = Math.min(0, Math.max(-openX, from + e.translationX));
      target.value = t;
      // Count pills fully revealed at this position and tick a haptic whenever it changes — so you
      // feel every pill clear (or re-cover) as you drag through the detents.
      const absX = -t;
      let level = 0;
      for (let k = 1; k < detents.length; k++) if (absX + 0.5 >= detents[k]) level = k;
      if (level !== crossLevel.value) {
        crossLevel.value = level;
        runOnJS(hapticImpactLight)();
      }
    })
    .onEnd((e) => {
      'worklet';
      const absX = -target.value;
      // Snap to the NEAREST detent by position …
      let idx = 0;
      let best = 1e9;
      for (let k = 0; k < detents.length; k++) {
        const d = absX - detents[k];
        const dist = d < 0 ? -d : d;
        if (dist < best) {
          best = dist;
          idx = k;
        }
      }
      // … then let a firm flick carry it one more stop in the fling direction, so a quick swipe still
      // advances (or dismisses) rather than snapping back to where it was released.
      if (e.velocityX < -500 && idx < detents.length - 1) idx += 1;
      else if (e.velocityX > 500 && idx > 0) idx -= 1;
      target.value = -detents[idx];
      restIndex.value = idx;
      crossLevel.value = idx;
      runOnJS(settle)(idx);
    });

  /**
   * What the row actually DRAWS at — a spring chasing `target`, never `target` itself. Because the
   * spring is re-evaluated against a moving target every frame, the row trails the finger slightly
   * while you drag and settles after you let go, instead of being welded to the touch point. That
   * lag IS the effect: 1:1 tracking is what made the old version feel linear and lifeless.
   */
  const tx = useDerivedValue(() => withSpring(target.value, SPRING));

  // The row's lift onto the slot (rounded corner + elevated bg) reaches full by the FIRST detent —
  // once it's open at all it reads as lifted, not half-lifted at a one-pill rest.
  const liftProgress = useDerivedValue(() => Math.min(1, -tx.value / detents[1]));

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    borderTopRightRadius: liftProgress.value * SLOT_RADIUS,
    borderBottomRightRadius: liftProgress.value * SLOT_RADIUS,
    // At rest the row is indistinguishable from the page (an edge-to-edge list, not a card); as it
    // opens it lifts onto the elevated surface, which is what makes the rounded slot legible.
    backgroundColor: interpolateColor(liftProgress.value, [0, 1], [theme.background, theme.backgroundElement]),
  }));

  return (
    <View style={styles.swipeContainer}>
      {/* Notes puts a caption under its pills, but our rows are half the height of a Notes row —
          there is no room for one without the pill shrinking to a dot. The glyph plus the
          accessibility label carry it. Actions lay out left→right, so the last sits at the edge.
          Solid pills, uncovered by the sliding row (no fade) — that's what makes a one-pill rest
          detent read as fully revealed rather than half-faded. */}
      <View
        style={[styles.pillSlot, { width: pillCount * PILL_WIDTH + (pillCount - 1) * PILL_GAP }]}
        pointerEvents="box-none">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Pressable
              key={a.key ?? a.label}
              onPress={() => {
                hapticImpactLight();
                close();
                a.onPress();
              }}
              style={[styles.pill, { backgroundColor: a.destructive ? theme.danger : theme.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`${a.label} ${label}`}>
              <Icon color={theme.accentOn} size={20} />
            </Pressable>
          );
        })}
      </View>

      <GestureDetector gesture={pan}>
        {/* `overflow: hidden` so the row's press/hover highlight — a plain square fill on the child
            below — is CLIPPED to the rounded slot as it opens. Without it the highlight keeps its
            square corners and visibly pokes out past the row it's meant to be filling. */}
        <Animated.View style={[styles.rowClip, rowStyle]}>
          <SettingsRow
            label={label}
            description={description}
            descriptionColor={descriptionColor}
            leading={leading}
            escapeGutter={false}
            // A tap on an open row closes it instead of navigating — the same rule iOS lists use, and
            // without it the tap that "cancels" a swipe would silently push a screen.
            onPress={onPress && (() => (restIndex.value > 0 ? close() : onPress()))}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function HoverActionsRow({ label, description, descriptionColor, leading, onPress, actions }: Props) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  // Each action is a SIBLING of the row, not something inside its `right` slot: react-native-web
  // renders an accessibilityRole="button" Pressable as a real <button>, and a <button> inside a
  // <button> is invalid HTML — React rejects it, and the two click targets overlap. So each action
  // gets its own lane to the row's right, which is also exactly where the pills sit on native. Every
  // lane feeds the same `hovered`, so crossing from the row onto an action doesn't hide the set.
  const lastIndex = actions.length - 1;
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
      {actions.map((a, i) => {
        const Icon = a.icon;
        return (
          <Pressable
            key={a.key ?? a.label}
            onPress={a.onPress}
            onHoverIn={onHoverIn}
            onHoverOut={onHoverOut}
            // The trailing (edge) lane carries the gutter padding so it lines up with the screen edge;
            // inner lanes just sit beside it. Faded out until the pointer is over the row — pointer-less
            // clients (a touchscreen on web fires no hover events at all) keep it visible (see CAN_HOVER).
            style={[i === lastIndex ? styles.webEdgeAction : styles.webAction, CAN_HOVER && !hovered && styles.webActionIdle]}
            accessibilityRole="button"
            accessibilityLabel={`${a.label} ${label}`}>
            <Icon color={a.destructive ? theme.danger : theme.accent} size={18} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rowClip: {
    overflow: 'hidden',
  },
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
    // Stretched to the row's height (which varies — a row with a status line is taller), so the
    // pills fill it minus a hair of breathing room. Pinning a fixed pill height instead would leave
    // them floating off-centre on the taller rows. Laid out as a row so multiple pills sit
    // side-by-side; `width` is set inline from the pill count.
    top: Spacing.one,
    bottom: Spacing.one,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: PILL_GAP,
  },
  pill: {
    width: PILL_WIDTH,
    borderRadius: SLOT_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // Cancels the screen's gutter for the same reason the native swipe container does: the row's
    // hover highlight should reach the screen's edge, and the action lanes should sit in the margin
    // rather than inside the text column.
    marginHorizontal: -SettingsGutter,
  },
  webRowBody: {
    flex: 1,
  },
  webEdgeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    // A fixed lane, so the action occupies the same space whether or not it's currently shown and
    // the row's text never reflows as it fades in. The edge lane also pads out to the screen gutter.
    width: SettingsGutter + 20,
    paddingRight: SettingsGutter,
    cursor: 'pointer',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  // An inner action lane, left of the edge one. No gutter padding — only the trailing lane reaches
  // the screen edge; these just sit beside it.
  webAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 34,
    cursor: 'pointer',
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  webActionIdle: {
    opacity: 0,
  },
});
