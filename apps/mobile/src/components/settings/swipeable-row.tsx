import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
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
import { hapticImpactLight, hapticImpactMedium } from '@/lib/haptics';
import { claimOpenRow, releaseOpenRow } from '@/lib/swipe-row-registry';
import { testId } from '@/lib/test-id';

/** The action bubbles are perfect CIRCLES: this is their diameter (and so also their layout width in
 *  the detent math). Sized to sit inside a settings row (64) with breathing room, and centred in the
 *  slot rather than stretched to it, so a taller row still gets circles. */
const PILL_WIDTH = 52;
const PILL_GAP = Spacing.two;
/** The glyph inside each circle (and the stretching full-swipe pill, where it stays centred). */
const PILL_ICON = 20;
/** Minimum gap between the last circle and the container's right edge — standardized to the SAME
 *  spacing token as the gap between circles (`PILL_GAP`), so the rail reads evenly: circle · gap ·
 *  circle · gap · edge, and it scales with the spacing system. This is the floor for rows whose
 *  `edgeInset` is 0 (the History list); screens with a real gutter already clear it. */
const PILL_EDGE_GAP = Spacing.two;
/** Corner radius the row's trailing edge grows to as it opens into a slot. */
const SLOT_RADIUS = 14;
/** How many action bubbles fit a row before they'd run past the screen / crowd the content. Beyond
 *  this, extra actions are dropped (and a dev-build error is logged — see `clampActions`). Three
 *  circles plus gaps and the gutter already reach ~200px, about as far as a phone row can give. */
const MAX_ROW_ACTIONS = 3;

/** Tuned for a visible trail: soft enough that the row lags a little behind the finger and has to
 *  catch up, stiff and damped enough that it still arrives promptly and doesn't wobble past the
 *  open position. Raising `stiffness` collapses the lag back toward 1:1 tracking. */
const SPRING = { damping: 22, stiffness: 200, mass: 0.7 } as const;

/** How much of the finger's over-drag past the captured detent the row actually follows. Low = the
 *  drag feels sticky/notched: the row barely moves within a detent, then gives way at the midpoint
 *  (the centre-ish of a button) where it snaps to the next pill and a haptic ticks. */
const DETENT_RESIST = 0.35;

/** Fraction of the row's width a SINGLE-ACTION swipe must cross to ARM the full-swipe commit: past
 *  the open detent the lone circle stretches into a pill under the finger, a medium haptic marks
 *  the arm, and releasing while armed fires the action — the iOS Mail swipe-through. Multi-action
 *  rows never do this (which action would it mean?). */
const FULL_SWIPE_COMMIT = 0.6;

/** Minimum gap between detent haptics. A very fast swipe crosses several midpoints within a few
 *  milliseconds; fired back-to-back the Taptic engine coalesces them into one mushy buzz. We SPACE
 *  them out to at least this far apart (delaying, not dropping) so each detent is felt as its own tap. */
const MIN_HAPTIC_MS = 70;

/** A per-row detent haptic that guarantees `MIN_HAPTIC_MS` between taps by DELAYING bunched ones onto
 *  the next free slot — so a fast swipe's near-simultaneous crossings still land as distinct taps
 *  rather than one buzz. Deferral is capped so frantic back-and-forth can't queue taps far into the
 *  future. Module-level (not in the component) so the `Date.now()` read stays out of render — the
 *  compiler flags impure calls there. Created once per row via a lazy `useState`. */
function createDetentHaptic() {
  let nextAt = 0; // earliest time (ms) the next tap may fire
  return () => {
    const now = Date.now();
    const at = Math.max(now, Math.min(nextAt, now + MIN_HAPTIC_MS * 3));
    nextAt = at + MIN_HAPTIC_MS;
    const delay = at - now;
    if (delay <= 0) hapticImpactLight();
    else setTimeout(hapticImpactLight, delay);
  };
}

// Constant for the process, so the platform branch is stable and each platform only ever renders one
// of the two implementations below — their hooks never interleave.
const IS_WEB = Platform.OS === 'web';

// Whether this web client has a hovering pointer at all. A touchscreen laptop/tablet on web fires no
// hover events ever, so hover-revealed actions would be permanently invisible there — those clients
// get them shown outright instead.
const CAN_HOVER = IS_WEB && typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;

// react-native-web maps these onto the underlying div so the action's opacity change eases; they
// aren't part of RN's ViewStyle, hence the cast (mirrors app-tabs.tsx's FADE_TRANSITION). Web only.
const WEB_ACTION_TRANSITION = {
  transitionProperty: 'opacity',
  transitionDuration: '120ms',
} as unknown as ViewStyle;

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

/** Clamp to what fits, and shout in a dev build when a caller over- (or under-) fills the row — a
 *  `console.error` surfaces in the Metro logs and the RN LogBox, without crashing a release build. */
function clampActions(actions: SwipeRowAction[], rowName: string): SwipeRowAction[] {
  if (__DEV__) {
    if (actions.length === 0) {
      console.error(`SwipeableRow ("${rowName}") was given no actions. A swipeable row needs at least one.`);
    } else if (actions.length > MAX_ROW_ACTIONS) {
      console.error(
        `SwipeableRow ("${rowName}") was given ${actions.length} actions, but at most ${MAX_ROW_ACTIONS} fit a row. Dropping the last ${actions.length - MAX_ROW_ACTIONS}.`,
      );
    }
  }
  return actions.length > MAX_ROW_ACTIONS ? actions.slice(0, MAX_ROW_ACTIONS) : actions;
}

type SwipeableRowProps = {
  /** Accessible name of the row — used in each action's a11y label ("{action} {name}") and dev warnings. */
  name: string;
  /**
   * The trailing actions, laid out left→right — so the LAST one sits at the edge (the natural
   * primary/destructive slot). At least one; at most `MAX_ROW_ACTIONS` (extra are dropped with a
   * dev-build error).
   */
  actions: SwipeRowAction[];
  /** Horizontal inset (px) the row escapes so its pills reach past a container's padding to the screen
   *  edge. Settings screens pass `SettingsGutter`; a plain centred list (e.g. History) leaves it 0. */
  edgeInset?: number;
  /** In a RECYCLING list, the item's stable list key. When the container is reused for a different
   *  item this changes, so the row snaps closed — WITHOUT it, a swiped-open row would inherit onto the
   *  next item. It's the list key (not the item value), so a mere data UPDATE to the same item (e.g. a
   *  download tick) leaves it unchanged and does NOT close an open swipe. Omit outside a recycling list. */
  recycleKey?: string;
  /** Set false to suppress the actions entirely (no swipe gesture, no hover lanes) — e.g. while a
   *  screen's multi-select mode owns row interaction. The row renders as plain content, same layout. */
  swipeEnabled?: boolean;
  /** The row's own content (rendered as the swipeable surface / hover body). */
  children: ReactNode;
};

/**
 * Wraps arbitrary row `children` with trailing actions reached by swiping. Dragging left slides the
 * row away; its trailing edge rounds into a slot, and the action pills are uncovered beneath it — the
 * iOS Notes shape. A swipe alone never commits anything: you then tap a pill (a destructive pill's
 * handler should still confirm), and tapping the open row itself closes it.
 *
 * The swipe is DETENTED — it reveals one pill at a time, with a haptic tick as each clears, and rests
 * at whichever pill count you release on. Hand-rolled on a pan gesture (rather than gesture-handler's
 * `ReanimatedSwipeable`, which only hands the drag progress to the ACTION it renders, so the row
 * itself couldn't round its corners in step with the drag).
 *
 * Android gets the same rest-open behavior rather than Material's fling-to-dismiss (dismissal there is
 * only safe with an undo snackbar, which this app has none of). On web there is no swipe — the actions
 * reveal as buttons on hover (and show unconditionally on a touch screen, which never hovers).
 */
export function SwipeableRow({ name, actions, edgeInset = 0, recycleKey, swipeEnabled = true, children }: SwipeableRowProps) {
  // Nothing to act on: plain content in the same escaped layout, no gesture/lanes. Checked BEFORE
  // clampActions — an intentionally empty action set isn't the dev error it warns on. A DISABLED
  // row (`swipeEnabled: false`) deliberately does NOT take this branch: swapping between the
  // gesture tree and a plain view remounts every visible row's gesture+reanimated stack at once,
  // which made entering a big list's select mode visibly stall — the row stays mounted and its
  // gesture is switched off instead.
  if (actions.length === 0) {
    return <View style={{ marginHorizontal: -edgeInset }}>{children}</View>;
  }
  const shown = clampActions(actions, name);
  return IS_WEB ? (
    <HoverActionsRow name={name} actions={shown} edgeInset={edgeInset} recycleKey={recycleKey} enabled={swipeEnabled}>
      {children}
    </HoverActionsRow>
  ) : (
    <SwipeRow name={name} actions={shown} edgeInset={edgeInset} recycleKey={recycleKey} enabled={swipeEnabled}>
      {children}
    </SwipeRow>
  );
}

/** A `SettingsRow` with trailing swipe/hover actions — the settings-screen flavour of `SwipeableRow`
 *  (escapes the settings gutter so pills reach the screen edge). Existing settings callers use this. */
export function SwipeableSettingsRow({
  label,
  labelBold,
  description,
  descriptionColor,
  contentInset,
  leading,
  right,
  onPress,
  onLongPress,
  actions,
  recycleKey,
  swipeEnabled,
  testID,
}: {
  label: string;
  labelBold?: boolean;
  description?: string;
  descriptionColor?: string;
  /** Indents the row's content under a parent (see `SettingsRow.contentInset`). */
  contentInset?: number;
  leading?: ReactNode;
  /** Trailing content on the row's right (overrides the auto chevron a pressable row would grow). */
  right?: ReactNode;
  /** Tapping the row body (e.g. opening the item's detail page). Suppressed while the row is open. */
  onPress?: () => void;
  /** Long-press on a pressable row (see `SettingsRow.onLongPress`). */
  onLongPress?: (e: GestureResponderEvent) => void;
  actions: SwipeRowAction[];
  /** The item's stable list key in a recycling list — see `SwipeableRow.recycleKey`. */
  recycleKey?: string;
  /** See `SwipeableRow.swipeEnabled` — false renders the row without its actions. */
  swipeEnabled?: boolean;
  /** Automation selector forwarded to the inner row. */
  testID?: string;
}) {
  return (
    <SwipeableRow
      name={label}
      actions={actions}
      edgeInset={SettingsGutter}
      recycleKey={recycleKey}
      {...(swipeEnabled !== undefined ? { swipeEnabled } : {})}>
      <SettingsRow
        label={label}
        labelBold={labelBold}
        description={description}
        descriptionColor={descriptionColor}
        contentInset={contentInset}
        leading={leading}
        right={right}
        escapeGutter={false}
        onPress={onPress}
        onLongPress={onLongPress}
        testID={testID}
      />
    </SwipeableRow>
  );
}

type RowImplProps = { name: string; actions: SwipeRowAction[]; edgeInset: number; recycleKey?: string; enabled: boolean; children: ReactNode };

function SwipeRow({ name, actions, edgeInset, recycleKey, enabled, children }: RowImplProps) {
  const theme = useTheme();
  // Where the row is BEING DRAGGED to — set straight from the finger, with no smoothing.
  const target = useSharedValue(0);
  // Which detent the row is resting at: 0 = closed, k = k action pills revealed. The swipe stops one
  // pill at a time, so this is an index, not a boolean.
  const restIndex = useSharedValue(0);
  // Which detent the finger is currently "captured" at DURING a drag — it flips as the finger crosses
  // the midpoint between detents, which is both the resistance release point and the haptic tick.
  const captured = useSharedValue(0);
  // Where the row was RESTING when this drag began (0 or fully open) — the all-or-nothing release
  // rule is direction-aware, so it needs to know which end the drag set out from (see onEnd).
  const startRest = useSharedValue(0);
  // Stable per-row identity for `swipe-row-registry`. Lazy state, not a ref, for the same reason.
  const [token] = useState(() => ({}));
  // Detent haptic (one per row). Every midpoint crossing calls it via runOnJS; it spaces bunched taps
  // out to MIN_HAPTIC_MS apart so a fast swipe lands as distinct taps rather than one buzz.
  const [tickHaptic] = useState(createDetentHaptic);
  // The all-or-nothing settle (see onEnd) sweeps the detents the finger didn't reach — play their
  // ticks through the SAME queue, so the auto-open clicks through the remaining pills exactly as a
  // full drag would have (MIN_HAPTIC_MS apart, not one mushy buzz).
  function tickMany(n: number) {
    for (let i = 0; i < n; i++) tickHaptic();
  }
  // JS mirror of "is the row open", so a tap-catching overlay can cover the content while open (a tap
  // then closes it instead of triggering the content's own press) without the content knowing.
  const [open, setOpen] = useState(false);

  const pillCount = Math.max(1, actions.length);
  // Where the pill rail ends, from the container's right edge: the screen gutter, floored at
  // PILL_EDGE_GAP so a gutterless row (History) still gives its circles air on the right.
  const trailingInset = Math.max(edgeInset, PILL_EDGE_GAP);
  // Rest positions along the drag: detents[0] = 0 (closed), detents[k] = far enough to reveal k pills;
  // detents[pillCount] is fully open. A plain number array, captured into the worklets by value.
  // MEMOIZED so its reference is stable across the list's frequent re-renders — a fresh array every
  // render changed every worklet's closure and forced Reanimated to re-serialize them each tick.
  const detents = useMemo(() => {
    const d = [0];
    for (let k = 1; k <= pillCount; k++) d.push(trailingInset + k * (PILL_WIDTH + PILL_GAP));
    return d;
  }, [pillCount, trailingInset]);
  const openX = detents[pillCount];

  // ── Full-swipe commit (single-action rows only — see FULL_SWIPE_COMMIT) ──
  const fullSwipeable = actions.length === 1;
  // The row's measured width — the commit threshold is a fraction of it (and the overdrag's clamp).
  const rowW = useSharedValue(0);
  const fullSwipeArmed = useSharedValue(false);
  // Arm/disarm feedback: a medium thump going over the line (this release WILL fire), the ordinary
  // detent tick dropping back under it.
  function armFeedback(armed: boolean) {
    if (armed) hapticImpactMedium();
    else tickHaptic();
  }
  // Read `actions` through a ref so the memoized gesture (below) always fires the LIVE handler without
  // rebuilding when `actions` gets a new identity on a download tick.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  function commitFullSwipe() {
    close();
    actionsRef.current[0]?.onPress();
  }

  // Deliberately NOT useCallback: a shared value listed in a hook's dependency array may not then be
  // mutated (react-hooks/immutability, which the React Compiler enforces here). These are cheap
  // closures, and the compiler memoizes what's worth memoizing.
  function close() {
    restIndex.value = 0;
    captured.value = 0;
    releaseOpenRow(token);
    target.value = 0;
    setOpen(false);
  }

  // After a drag settles on a detent (JS thread): reflect open-ness for the overlay, and keep the
  // "only one row open at a time" registry in sync — an open row registers its own close.
  function settle(index: number) {
    setOpen(index > 0);
    if (index > 0) claimOpenRow(token, close);
    else releaseOpenRow(token);
  }

  // When a recycling list reuses this view for a DIFFERENT item, `recycleKey` changes — snap the row
  // closed so a swiped-open row can't inherit onto the next item. Keyed on the stable LIST KEY (not the
  // item value), so a mere data update to the SAME item (a download tick) doesn't change it and leaves
  // an open swipe alone. Fires once on mount too (a harmless no-op — the row is already closed).
  useEffect(() => {
    restIndex.value = 0;
    captured.value = 0;
    target.value = 0;
    releaseOpenRow(token);
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recycleKey]);

  // If the action set changes while the row is open, its gesture state (rest/captured detent, slid
  // position) references the OLD pill layout — a live status change (a download finishing drops the
  // Pause pill and re-sorts the row) would leave it slid to a stale detent and index past the shorter
  // detents array. Snap it closed whenever the pill count changes. (Shared values are stable refs, so
  // they're intentionally kept out of the dep array — see the immutability note above.)
  const prevPillCount = useRef(pillCount);
  useEffect(() => {
    if (prevPillCount.current === pillCount) return;
    prevPillCount.current = pillCount;
    restIndex.value = 0;
    captured.value = 0;
    target.value = 0;
    releaseOpenRow(token);
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pillCount]);

  // Disabled (e.g. the screen's select mode owns row interaction): snap closed so a swiped-open row
  // can't linger under the selection UI. The gesture below is switched off via `.enabled()`.
  useEffect(() => {
    if (enabled) return;
    restIndex.value = 0;
    captured.value = 0;
    target.value = 0;
    releaseOpenRow(token);
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Disabling rides the HANDLERS (closure-captured `enabled`), not the recognizer's .enabled() config
  // — RNGH doesn't reliably re-apply that to already-mounted recognizers, which left rows mounted
  // during select mode with dead gestures after exiting. `enabled` is a memo dep, so the worklets are
  // rebuilt (and re-capture it) whenever it flips.
  //
  // MEMOIZED: the gesture (and its three worklets) is rebuilt ONLY when something it depends on
  // actually changes — open state, enable, or the detent layout — not on every render. The download
  // list re-renders ~3×/s, and rebuilding every visible row's gesture each time made Reanimated
  // re-serialize all their worklet closures to the UI thread — the single biggest cost in a CPU
  // profile. Shared values (stable refs) and the runOnJS callbacks are captured but kept out of the
  // dep array (the immutability rule forbids listing a mutated shared value; the callbacks only touch
  // stable refs, and the one that needs live data — commitFullSwipe — reads `actions` via a ref).
  const pan = useMemo(() => {
    const g = Gesture.Pan()
    // Vertical movement fails the pan so list scrolling still wins.
    .failOffsetY([-12, 12])
    .onBegin(() => {
      'worklet';
      if (!enabled) return;
      // Capture from wherever the row is currently resting, so resuming a drag from an already-open
      // detent doesn't fire a spurious tick on the first frame. Clamp in case the action set just
      // shrank (a stale rest index would point past the shorter detents array).
      captured.value = Math.min(restIndex.value, detents.length - 1);
      startRest.value = captured.value;
      fullSwipeArmed.value = false;
    })
    .onUpdate((e) => {
      'worklet';
      if (!enabled) return;
      const from = -detents[Math.min(restIndex.value, detents.length - 1)];
      // The finger's raw absolute position (before resistance). A single-action row may be dragged
      // PAST the open detent, clear across the row (the full-swipe commit); others stop at open.
      const maxDrag = fullSwipeable ? Math.max(openX, rowW.value) : openX;
      const absRaw = -Math.min(0, Math.max(-maxDrag, from + e.translationX));
      // Flip the captured detent as the finger crosses the MIDPOINT between detents — the centre-ish
      // of a button, where the resistance gives way. Tick a haptic on each flip (either direction).
      let cap = captured.value;
      while (cap < detents.length - 1 && absRaw > (detents[cap] + detents[cap + 1]) / 2) cap += 1;
      while (cap > 0 && absRaw < (detents[cap - 1] + detents[cap]) / 2) cap -= 1;
      if (cap !== captured.value) {
        captured.value = cap;
        // The JS-side `tickHaptic` throttles taps that land too close together (see its note).
        runOnJS(tickHaptic)();
      }
      // Resisted position: sit at the captured detent, following only a FRACTION of the finger's
      // excursion beyond it — so a drag within a detent is sticky, then releases past the midpoint.
      // PAST the open detent a single-action row follows the finger 1:1 instead: the circle is
      // stretching toward the commit, and resistance there would read as the row fighting the very
      // gesture it's inviting. (Continuous at the boundary — both forms equal openX there.)
      let next = detents[cap] + DETENT_RESIST * (absRaw - detents[cap]);
      if (fullSwipeable && absRaw > openX) next = absRaw;
      target.value = -Math.min(maxDrag, Math.max(0, next));
      // Arm/disarm the full-swipe commit as the finger crosses the threshold, with feedback both
      // ways — the medium thump is the "release now and it fires" signal.
      if (fullSwipeable) {
        const armed = rowW.value > 0 && absRaw >= rowW.value * FULL_SWIPE_COMMIT;
        if (armed !== fullSwipeArmed.value) {
          fullSwipeArmed.value = armed;
          runOnJS(armFeedback)(armed);
        }
      }
    })
    .onEnd((e) => {
      'worklet';
      if (!enabled) return;
      // Full swipe released while ARMED: the row springs home and the lone action fires — the same
      // path as tapping its pill, minus the tap.
      if (fullSwipeable && fullSwipeArmed.value) {
        fullSwipeArmed.value = false;
        target.value = 0;
        restIndex.value = 0;
        captured.value = 0;
        runOnJS(commitFullSwipe)();
        return;
      }
      // ALL-OR-NOTHING rest: the drag itself keeps its per-pill detents (the sticky resistance and
      // the tick as each pill clears), but the row never RESTS partially open — and the release
      // rule is DIRECTION-AWARE, one action's travel committing the whole move either way:
      //   from CLOSED — past the first detent's midpoint springs it fully open; short of it, closed.
      //   from OPEN   — retreating past even one detent's midpoint closes the whole row; the row
      //                 only stays open if the finger never really left the open end.
      // A firm fling overrides in its own direction from anywhere.
      const openIdx = detents.length - 1;
      const threshold = startRest.value === 0 ? 1 : startRest.value;
      let idx = captured.value >= threshold ? openIdx : 0;
      if (e.velocityX < -500) idx = openIdx;
      else if (e.velocityX > 500) idx = 0;
      // The settle crosses every detent between the captured one and the rest — their ticks still
      // play (queued MIN_HAPTIC_MS apart), so the sprung-open row clicks through its pills the same
      // way the finger dragging all the way would have.
      const swept = Math.abs(idx - captured.value);
      if (swept > 0) runOnJS(tickMany)(swept);
      target.value = -detents[idx];
      restIndex.value = idx;
      captured.value = idx;
      runOnJS(settle)(idx);
    });

    // Directional activation, by open-state (RNGH builders mutate in place). CLOSED: reveal on a LEFT
    // drag only, and FAIL a right drag so a swipe from the screen's left edge cedes to the OS
    // edge-swipe-back instead of being swallowed by the row. OPEN: allow a right drag too, so you can
    // swipe the row back closed. `open` is a memo dep, so this rebuilds when it flips.
    if (open) g.activeOffsetX([-12, 12]);
    else g.activeOffsetX(-12).failOffsetX(12);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, open, fullSwipeable, openX, detents, pillCount]);

  /**
   * What the row actually DRAWS at — a spring chasing `target`, never `target` itself. Because the
   * spring is re-evaluated against a moving target every frame, the row trails the finger slightly
   * while you drag and settles after you let go, instead of being welded to the touch point.
   */
  const tx = useDerivedValue(() => withSpring(target.value, SPRING));

  // The row's lift onto the slot (rounded corner + elevated bg) reaches full by the FIRST detent —
  // once it's open at all it reads as lifted, not half-lifted at a one-pill rest.
  const liftProgress = useDerivedValue(() => Math.min(1, -tx.value / detents[1]));

  // Hoist the two colours to local strings so the worklet closes over primitives, not the whole
  // `theme` object (which Reanimated would otherwise deep-clone into the shareable — per row).
  const bgClosed = theme.background;
  const bgOpen = theme.backgroundElement;
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    borderTopRightRadius: liftProgress.value * SLOT_RADIUS,
    borderBottomRightRadius: liftProgress.value * SLOT_RADIUS,
    // At rest the row is indistinguishable from the page; as it opens it lifts onto the elevated
    // surface, which is what makes the rounded slot legible.
    backgroundColor: interpolateColor(liftProgress.value, [0, 1], [bgClosed, bgOpen]),
  }));

  // The lone action's slot stretches LEFTWARD as the row is dragged past open (its right edge is
  // pinned by the slot's `right`): the circle grows into a pill whose width chases the row's live
  // (spring-lagged) position — the fill visibly pursues the finger toward the commit.
  const pillStretchStyle = useAnimatedStyle(() => ({
    width: PILL_WIDTH + Math.max(0, -tx.value - openX),
  }));

  return (
    <View
      style={[styles.swipeContainer, { marginHorizontal: -edgeInset }]}
      onLayout={fullSwipeable ? (e) => rowW.set(e.nativeEvent.layout.width) : undefined}>
      {/* Solid pills, uncovered by the sliding row (no fade) — that's what makes a one-pill rest read
          as fully revealed. Actions lay out left→right, so the last sits at the edge. */}
      <Animated.View
        style={[
          styles.pillSlot,
          { right: trailingInset },
          fullSwipeable ? pillStretchStyle : { width: pillCount * PILL_WIDTH + (pillCount - 1) * PILL_GAP },
        ]}
        pointerEvents="box-none">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Pressable
              key={a.key ?? a.label}
              testID={testId('swipe-action', name, a.key ?? a.label)}
              onPress={() => {
                hapticImpactLight();
                close();
                a.onPress();
              }}
              style={[styles.pill, fullSwipeable && styles.pillFull, { backgroundColor: a.destructive ? theme.danger : theme.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`${a.label} ${name}`}>
              <Icon color={theme.accentOn} size={PILL_ICON} />
            </Pressable>
          );
        })}
      </Animated.View>

      <GestureDetector gesture={pan}>
        {/* `overflow: hidden` so the content's press highlight is CLIPPED to the rounded slot as it
            opens, instead of poking square corners past the row. */}
        <Animated.View style={[styles.rowClip, rowStyle]}>
          {children}
          {/* While open, a transparent overlay catches taps so the row closes instead of the content's
              own handlers firing — the same rule iOS lists use. Absent while closed, so content taps
              (and a fresh swipe) pass straight through. */}
          {open && (
            <Pressable
              testID={testId('swipe-close', name)}
              style={StyleSheet.absoluteFill}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={`Close ${name}`}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function HoverActionsRow({ name, actions, edgeInset, recycleKey, enabled, children }: RowImplProps) {
  const theme = useTheme();
  const { hovered, onHoverIn, onHoverOut } = useHovered();
  // Drop any lingering hover when a recycling list reuses this row for a different item (see SwipeRow).
  useEffect(() => {
    onHoverOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recycleKey]);
  // Hover the WHOLE row (body + action lanes) via pointer enter/leave on the outer element — reliably
  // fires for the entire subtree, unlike an `onHoverIn` on a wrapper the inner row's own Pressable
  // would swallow. Each action is a SIBLING of the content (not nested inside it): react-native-web
  // renders an accessibilityRole="button" Pressable as a real <button>, and a <button> inside a
  // <button> is invalid HTML, so the actions get their own lanes to the row's right.
  const lastIndex = actions.length - 1;
  return (
    <View style={[styles.webRow, { marginHorizontal: -edgeInset }]} onPointerEnter={onHoverIn} onPointerLeave={onHoverOut}>
      <View style={styles.webRowBody}>{children}</View>
      {/* Disabled (select mode): the body stays, the lanes go — no actions to hover. */}
      {enabled &&
        actions.map((a, i) => {
        const Icon = a.icon;
        const isEdge = i === lastIndex;
        return (
          <Pressable
            key={a.key ?? a.label}
            testID={testId('swipe-action', name, a.key ?? a.label)}
            onPress={a.onPress}
            style={[
              styles.webAction,
              WEB_ACTION_TRANSITION,
              isEdge ? { width: edgeInset + 34, paddingRight: edgeInset } : { width: 34 },
              CAN_HOVER && !hovered && styles.webActionIdle,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${a.label} ${name}`}>
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
    // The row slides out under its own left edge; without this it would paint over the neighbouring
    // rows as it goes. (`marginHorizontal` is set inline from `edgeInset`.)
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pillSlot: {
    position: 'absolute',
    // Spans the row's height with the circles CENTRED in it (not stretched) — what keeps them
    // perfect circles whatever the row's height. Laid out as a row so multiple circles sit
    // side-by-side; `right`/`width` are set inline.
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PILL_GAP,
  },
  pill: {
    // A perfect circle (width == height, radius past half of both) — the select-mode pill bar's
    // solo-verb circle, at row scale.
    width: PILL_WIDTH,
    height: PILL_WIDTH,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  // The full-swipe pill (single-action rows): fills the stretching slot. The icon stays CENTRED in
  // the pill (inherited from styles.pill), riding the middle of the stretch as it grows.
  pillFull: {
    width: '100%',
  },
  webRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    // `marginHorizontal` is set inline from `edgeInset` — same reason as the native container.
  },
  webRowBody: {
    flex: 1,
    minWidth: 0,
  },
  webAction: {
    justifyContent: 'center',
    alignItems: 'center',
    // A fixed lane, so the action occupies the same space whether or not it's currently shown and the
    // row's content never reflows as it fades in. The edge lane also pads out to the screen inset.
    cursor: 'pointer',
  },
  webActionIdle: {
    opacity: 0,
  },
});
