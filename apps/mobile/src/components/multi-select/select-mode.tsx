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
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';

import { openContextMenu } from '@/components/context-menu-host';
import { ANDROID_BLUR, type MenuRowSpec } from '@/components/context-menu-material';
import type { IconProps } from '@/components/icons/ui-icons';
import { SelectModeIcon, SelectOptionsIcon } from '@/components/icons/ui-icons';
import { SelectCircle } from '@/components/multi-select/selectable-row';
import { Spacing } from '@/constants/theme';
import { hapticSelection } from '@/lib/haptics';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

/** The circles' slide-in/out: a quick, strongly-decelerating ease-out — smooth arrival (no spring
 *  overshoot), but nowhere near linear: it launches fast and lands soft. */
export const SELECT_ANIM_MS = 170;
export const SELECT_EASING = Easing.bezier(0.22, 1, 0.36, 1);
/** The leading slot the circles occupy when open: circle + the row's gap. */
export const CIRCLE_SLOT = 20 + Spacing.three;
/** The floating bulk-verb pills. A pill with ONE action renders as a full circle (width == height);
 *  more actions stretch it horizontally into a pill. */
export const PILL_HEIGHT = 50;
export const PILL_BLUR = 70;
/** The pills' surface tints — deliberately FAR lighter than the menu material's, so the pills read
 *  as glass over the list rather than solid chips: the blur does all the legibility work, the tint
 *  only says which surface it is. A hairline border defines the glass edge. */
export const PILL_FILL = { light: 'rgba(255,255,255,0.18)', dark: 'rgba(28,30,34,0.22)' } as const;
/** The primary (accent) pill's fill opacity, as a hex-alpha suffix on the theme accent. */
export const PILL_ACCENT_ALPHA = 'CC';

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
    progress.value = withTiming(next ? 1 : 0, { duration: SELECT_ANIM_MS, easing: SELECT_EASING });
  };
  return {
    selecting,
    progress,
    toggle: () => set(!selecting),
    exit: () => set(false),
  };
}

/** The top-bar-left staging trigger (a bare three-dot ellipsis): opens the shared frosted context
 *  menu ANCHORED under the button (fixed placement — a button menu shouldn't wander with where
 *  inside the button the finger landed, unlike a hold menu that floats at the press point). */
export function SelectOptionsTrigger({ rows, testID }: { rows: MenuRowSpec[]; testID: string }) {
  const theme = useTheme();
  const anchorRef = useRef<View>(null);
  return (
    <View ref={anchorRef} collapsable={false}>
      <Pressable
        testID={testID}
        onPress={() =>
          anchorRef.current?.measureInWindow((x, y, _w, h) =>
            openContextMenu({ anchor: 'fixed', x, y: y + h + Spacing.two, rows }),
          )
        }
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Selection options">
        <SelectOptionsIcon color={theme.text} size={24} />
      </Pressable>
    </View>
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
  gesture,
}: {
  progress: SharedValue<number>;
  selected: boolean;
  edgeOffset: number;
  /** The drag-select pan for this row (`useDragSelect().gestureFor(index)`) — pass it only while
   *  select mode is on, so the collapsed slot never steals scrolls in normal mode. */
  gesture?: PanGesture;
}) {
  const slot = useAnimatedStyle(() => ({
    width: Math.max(0, progress.value) * CIRCLE_SLOT,
  }));
  const circle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, progress.value)),
    transform: [{ translateX: (progress.value - 1) * (CIRCLE_SLOT + edgeOffset) }],
  }));
  const lead = (
    <Animated.View style={[styles.selectLead, slot]}>
      <Animated.View style={circle}>
        <SelectCircle selected={selected} />
      </Animated.View>
    </Animated.View>
  );
  return gesture && DRAG_SELECT_SUPPORTED ? <GestureDetector gesture={gesture}>{lead}</GestureDetector> : lead;
}

// ── iOS-style drag-select ─────────────────────────────────────────────────────────
// Start a drag ON a row's check circle and sweep vertically: every row the finger passes flips to
// the anchor row's new state; retreating back over rows restores what they were before the drag
// (the pre-drag snapshot is the baseline, the swept range applies the anchor's toggle). Near the
// screen's edges the list auto-scrolls and the sweep keeps extending.
//
// The math is deliberately RELATIVE — rows are fixed-height, so the swept row is
// `anchor + round((translationY + scrolledSinceStart) / rowHeight)`; no window measurement, no
// header offsets, and programmatic auto-scroll self-corrects through the screen's onScroll.

/** NATIVE-ONLY: on web, react-native-web's Pressable pointer-captures on pointerdown, so a child
 *  RNGH pan never receives the move stream — the sweep can't work there (mouse users tap anyway).
 *  On native the RNGH recognizers sit ahead of the JS responder, same as `Holdable`. */
export const DRAG_SELECT_SUPPORTED = Platform.OS !== 'web';

/** How close to the screen's top/bottom (px) the finger must be before the list auto-scrolls. */
const DRAG_EDGE_ZONE = 110;
/** Max auto-scroll speed (px per 16ms tick), ramping linearly with proximity to the edge. */
const DRAG_MAX_SPEED = 30;

interface DragState {
  snapshot: Set<string>;
  anchor: number;
  /** What the sweep applies — the anchor row's post-toggle state. */
  mode: boolean;
  startScrollY: number;
  lastTranslationY: number;
  lastAbsY: number;
  lastLo: number;
  lastHi: number;
  timer: ReturnType<typeof setInterval> | null;
}

/**
 * The drag-select controller. The screen supplies its ordered keys, live selection, the list ref,
 * and a scroll-offset ref it keeps current via `onScroll`; `gestureFor(index)` returns the pan a
 * row's `SelectLead` wears (pass it only while select mode is on).
 *
 * The gestures are IDENTITY-STABLE (cached per row index) and read the live screen state through a
 * ref refreshed in an effect: the first selection change re-renders the screen, and handing
 * `GestureDetector` a fresh gesture instance mid-drag makes RNGH cancel the active pan — the sweep
 * died on its first crossing.
 */
export function useDragSelect({
  keys,
  selected,
  selectOnly,
  rowHeight,
  scrollRef,
  scrollYRef,
}: {
  keys: readonly string[];
  selected: ReadonlySet<string>;
  selectOnly: (keys: readonly string[]) => void;
  rowHeight: number;
  scrollRef: { current: { scrollToOffset(params: { offset: number; animated?: boolean }): void } | null };
  scrollYRef: { current: number };
}): { gestureFor: (index: number) => PanGesture } {
  const { height: winH } = useWindowDimensions();
  const drag = useRef<DragState | null>(null);
  // Live screen state for the stable gesture handlers — refreshed post-render, read at event time.
  const live = useRef({ keys, selected, selectOnly, rowHeight, winH });
  useEffect(() => {
    live.current = { keys, selected, selectOnly, rowHeight, winH };
  });

  // Stable per-row gestures (a state-held Map, populated during render's own computation).
  const [gestureCache] = useState(() => new Map<number, PanGesture>());

  const stopTimer = (d: DragState) => {
    if (d.timer) clearInterval(d.timer);
    d.timer = null;
  };

  /** Recompute the swept range and apply it over the snapshot (only on a range change). */
  const apply = (d: DragState, effIndex: number) => {
    const lo = Math.min(d.anchor, effIndex);
    const hi = Math.max(d.anchor, effIndex);
    if (lo === d.lastLo && hi === d.lastHi) return;
    d.lastLo = lo;
    d.lastHi = hi;
    const next = new Set(d.snapshot);
    for (let i = lo; i <= hi; i++) {
      const k = live.current.keys[i];
      if (k === undefined) continue;
      if (d.mode) next.add(k);
      else next.delete(k);
    }
    live.current.selectOnly([...next]);
    hapticSelection();
  };

  const effIndexNow = (d: DragState) => {
    const scrolled = scrollYRef.current - d.startScrollY;
    const rel = (d.lastTranslationY + scrolled) / live.current.rowHeight;
    // INCLUSIVE quantization, biased toward the drag direction: the sweep runs from the row the
    // finger STARTED on through the row it's currently over — a row counts as soon as the finger
    // is meaningfully into it (~35% past the boundary from an assumed centre start; the bias also
    // absorbs where within the circle the touch actually landed). A plain round() only flipped at
    // the midpoint, which read as the row under the finger being left out.
    const steps = rel >= 0 ? Math.floor(rel + 0.65) : Math.ceil(rel - 0.65);
    return Math.min(live.current.keys.length - 1, Math.max(0, d.anchor + steps));
  };

  /** Auto-scroll speed for the finger's current screen position (0 outside the edge zones). */
  const zoneSpeed = (absY: number) => {
    if (absY < DRAG_EDGE_ZONE) return -DRAG_MAX_SPEED * (1 - absY / DRAG_EDGE_ZONE);
    const fromBottom = live.current.winH - absY;
    if (fromBottom < DRAG_EDGE_ZONE) return DRAG_MAX_SPEED * (1 - fromBottom / DRAG_EDGE_ZONE);
    return 0;
  };

  const maybeAutoScroll = (d: DragState) => {
    if (zoneSpeed(d.lastAbsY) === 0) {
      stopTimer(d);
      return;
    }
    if (d.timer) return;
    d.timer = setInterval(() => {
      const cur = drag.current;
      if (!cur) return;
      const speed = zoneSpeed(cur.lastAbsY);
      if (speed === 0) {
        stopTimer(cur);
        return;
      }
      // Optimistically advance the tracked offset so the sweep extends immediately; the screen's
      // onScroll corrects it to the clamped truth a frame later (so an end-of-list overshoot heals).
      const next = Math.max(0, scrollYRef.current + speed);
      scrollYRef.current = next;
      scrollRef.current?.scrollToOffset({ offset: next, animated: false });
      apply(cur, effIndexNow(cur));
    }, 16);
  };

  const gestureFor = (index: number) => {
    const cached = gestureCache.get(index);
    if (cached) return cached;
    const gesture = Gesture.Pan()
      // Vertical intent only — a horizontal wobble hands the touch back (there's nothing to swipe
      // in select mode, but scrolling must stay winnable elsewhere on the row).
      .activeOffsetY([-8, 8])
      .failOffsetX([-16, 16])
      // Grab a little of the gutter to the circle's left — the drag target is the whole check rail.
      .hitSlop({ left: 12, right: 4 })
      .runOnJS(true)
      .onStart(() => {
        const { keys: k, selected: sel } = live.current;
        const d: DragState = {
          snapshot: new Set(sel),
          anchor: index,
          mode: !sel.has(k[index] ?? ''),
          startScrollY: scrollYRef.current,
          lastTranslationY: 0,
          lastAbsY: live.current.winH / 2,
          lastLo: -1,
          lastHi: -1,
          timer: null,
        };
        drag.current = d;
        apply(d, index); // the anchor row flips the moment the sweep starts
      })
      .onUpdate((e) => {
        const d = drag.current;
        if (!d) return;
        d.lastTranslationY = e.translationY;
        d.lastAbsY = e.absoluteY;
        apply(d, effIndexNow(d));
        maybeAutoScroll(d);
      })
      .onFinalize(() => {
        const d = drag.current;
        if (d) stopTimer(d);
        drag.current = null;
      });
    gestureCache.set(index, gesture);
    return gesture;
  };

  return { gestureFor };
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
          <BlurView tint={scheme} intensity={PILL_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={[styles.pill, { borderColor: theme.backgroundSelected }]}>
            <View pointerEvents="none" style={[styles.pillFill, { backgroundColor: PILL_FILL[scheme] }]} />
            {verbs.map((v) => (
              <Pressable
                key={v.key}
                testID={v.testID}
                onPress={v.onPress}
                style={styles.pillButton}
                accessibilityRole="button"
                accessibilityLabel={v.label}>
                <v.Icon color={v.color ?? theme.text} size={20} filled={false} />
              </Pressable>
            ))}
          </BlurView>
        </View>
      ) : (
        <View />
      )}
      {primary && (
        <View style={styles.pillShadow}>
          <BlurView tint={scheme} intensity={PILL_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={[styles.pill, { borderColor: theme.backgroundSelected }]}>
            {/* Translucent accent over the blur — reads blue while the page still bleeds through. */}
            <View pointerEvents="none" style={[styles.pillFill, { backgroundColor: `${theme.accent}${PILL_ACCENT_ALPHA}` }]} />
            <Pressable
              testID={primary.testID}
              onPress={primary.onPress}
              style={styles.pillButton}
              accessibilityRole="button"
              accessibilityLabel={primary.label}>
              <primary.Icon color={theme.accentOn} size={22} filled={false} />
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
    // The glass edge — same treatment as the menu surface.
    borderWidth: StyleSheet.hairlineWidth,
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
