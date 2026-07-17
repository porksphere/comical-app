/**
 * The GENERIC native hold menu — the series-card popup's menu system, generalized. A long-press on
 * anything (a chapter row today; any future subject) opens the same frosted, point-anchored menu the
 * card popup shows, with the same material (`context-menu-material.tsx`), the same open thump, the
 * same peek-and-commit hold behavior (keep holding, slide onto a row, lift to run it), and the same
 * travelling selection bubble — WITHOUT the card popup's preview panel / cover morph, which belong
 * to series specifically.
 *
 * Architecture mirrors `lib/series-card-menu.ts` + `SeriesCardContextMenuHost`, with its OWN store
 * and hold shared values so the two systems never fight over a touch:
 *  - `openContextMenu(request)` from anywhere; one root-mounted `ContextMenuHost` renders it.
 *  - `ContextMenuHold` is the gesture the pressed row wears: a Pan-after-long-press that opens the
 *    menu at the finger and keeps reporting it so the SAME uninterrupted touch can pick a row
 *    (`activateAfterLongPress` keeps the finger; a GH LongPress would cancel on travel — see the
 *    card's identical reasoning). On web it degrades to the child Pressable's own `onLongPress`
 *    (RNW suppresses the click after its own long-press; a wrapping gesture can't).
 *
 * Native-only presentation by design — web consumers keep their overlay popover affordance, exactly
 * as web series cards keep their 3-dot menu.
 */
import { observable } from '@legendapp/state';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { BackHandler, Platform, StyleSheet, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  makeMutable,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ANDROID_BLUR,
  BACKDROP_BLUR,
  BACKDROP_TINT,
  BACKDROP_TINT_OPACITY,
  EDGE_PAD,
  HIGHLIGHT_OPACITY,
  HOVER_FADE,
  HOVER_SPRING,
  MENU_PAD_V,
  MENU_ROW_HEIGHT,
  MENU_TITLE_HEIGHT,
  MENU_WIDTH,
  MenuSurface,
  menuStyles,
  type MenuRowSpec,
} from '@/components/context-menu-material';
import { HOLD_ARM_DISTANCE } from '@/lib/series-card-menu';
import { useActiveColorScheme } from '@/hooks/use-theme';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
// The menu's entrance/exit — quick springs in the card popup's family.
const OPEN_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
const GAP = 10; // between the press point and the menu's near edge

export type ContextMenuRequest = {
  /** Slim muted title line above the rows (e.g. the chapter name). */
  title?: string;
  rows: MenuRowSpec[];
  /** The press point (window coords) the menu floats at. */
  x: number;
  y: number;
};

/** The currently-open generic hold menu, or null (in-memory local UI state, per the app's split). */
export const contextMenu$ = observable<ContextMenuRequest | null>(null);

export function openContextMenu(req: ContextMenuRequest): void {
  contextMenu$.set(req);
}

export function closeContextMenu(): void {
  contextMenu$.set(null);
}

/** Reactive read via `useSyncExternalStore` — a bare `use$` isn't compiler-recognized as a hook
 *  (same trap the card host documents). */
function useContextMenu(): ContextMenuRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => contextMenu$.onChange(onStoreChange),
    () => contextMenu$.peek(),
    () => contextMenu$.peek(),
  );
}

// ── Peek and commit (the generic host's own hold channel) ───────────────────────
// Same architecture as the card's (see lib/series-card-menu.ts for the full why): the finger stays
// inside the PRESSED ROW's gesture, which reports it here; the host — which knows where its rows
// are — hit-tests and writes back `hoveredRow`; the gesture reads that back on lift to commit.
export const ctxHoldActive = makeMutable(false);
export const ctxHoldArmed = makeMutable(false);
export const ctxHoldX = makeMutable(0);
export const ctxHoldY = makeMutable(0);
export const ctxHoveredRow = makeMutable(-1);

let rowActions: (() => void)[] = [];
function setRowActions(actions: (() => void)[]): void {
  rowActions = actions;
}
function commitRow(index: number): void {
  rowActions[index]?.();
}

function selectionTick(): void {
  void Haptics.selectionAsync();
}

/**
 * The hold gesture a menu-owning row wears. Native: a Pan-after-long-press that opens the menu at
 * the finger, keeps reporting it for the peek, and commits the hovered row on lift. Web: hands the
 * child Pressable a plain `onLongPress` through the render prop (consumers open their web
 * affordance from it) — see the module docstring for why the two must differ.
 */
export function ContextMenuHold({
  enabled = true,
  onOpen,
  children,
}: {
  enabled?: boolean;
  onOpen: (point: { x: number; y: number }) => void;
  children: (api: { onLongPress?: (e: GestureResponderEvent) => void }) => ReactNode;
}) {
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const hold = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(350)
        .enabled(enabled && Platform.OS !== 'web')
        .onStart((e) => {
          ctxHoldActive.set(true);
          // Dormant until the finger travels — a hold you never moved selects nothing, so opening
          // the menu just to look and letting go can't run an action by accident.
          ctxHoldArmed.set(false);
          originX.set(e.absoluteX);
          originY.set(e.absoluteY);
          ctxHoldX.set(e.absoluteX);
          ctxHoldY.set(e.absoluteY);
          ctxHoveredRow.set(-1);
          runOnJS(onOpen)({ x: e.absoluteX, y: e.absoluteY });
        })
        .onUpdate((e) => {
          ctxHoldX.set(e.absoluteX);
          ctxHoldY.set(e.absoluteY);
          if (!ctxHoldArmed.value) {
            const dx = e.absoluteX - originX.value;
            const dy = e.absoluteY - originY.value;
            if (Math.hypot(dx, dy) > HOLD_ARM_DISTANCE) ctxHoldArmed.set(true);
          }
        })
        .onEnd(() => {
          // Lift = commit whatever the finger was over; nothing under it leaves the menu open.
          const row = ctxHoveredRow.value;
          ctxHoldActive.set(false);
          ctxHoldArmed.set(false);
          ctxHoveredRow.set(-1);
          if (row >= 0) runOnJS(commitRow)(row);
        })
        .onFinalize(() => {
          ctxHoldActive.set(false);
          ctxHoldArmed.set(false);
          ctxHoveredRow.set(-1);
        }),
    [enabled, onOpen, originX, originY],
  );
  if (Platform.OS === 'web') {
    return (
      <>
        {children({
          onLongPress: enabled
            ? (e) => onOpen({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })
            : undefined,
        })}
      </>
    );
  }
  return (
    <GestureDetector gesture={hold}>
      <View collapsable={false}>{children({})}</View>
    </GestureDetector>
  );
}

/** Root-mounted host (see app/_layout.tsx) — renders the open request, if any. */
export function ContextMenuHost() {
  const req = useContextMenu();
  if (!req) return null;
  return <HostMenu req={req} />;
}

function HostMenu({ req }: { req: ContextMenuRequest }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scheme = useActiveColorScheme();
  const tint = scheme === 'dark' ? 'dark' : 'light';
  const progress = useSharedValue(0);

  // ── Placement: float at the press point, clamped on screen, flipped above when out of room ──
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const headerH = req.title !== undefined ? MENU_TITLE_HEIGHT : 0;
  const menuW = Math.min(MENU_WIDTH, winW - EDGE_PAD * 2);
  const menuH = MENU_PAD_V * 2 + headerH + MENU_ROW_HEIGHT * req.rows.length;
  const left = clamp(req.x - menuW / 2, EDGE_PAD, winW - menuW - EDGE_PAD);
  const below = req.y + GAP + menuH <= winH - insets.bottom - EDGE_PAD;
  const top = below
    ? req.y + GAP
    : Math.max(insets.top + EDGE_PAD, req.y - GAP - menuH);

  const dismiss = useCallback(() => {
    progress.set(
      withTiming(0, { duration: 130 }, (finished) => {
        if (finished) runOnJS(closeContextMenu)();
      }),
    );
  }, [progress]);

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); // the hold pays off — same thump as the card popup
    progress.set(withSpring(1, OPEN_SPRING));
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [progress, dismiss]);

  // Every row action also dismisses the menu — for a plain press AND a lift-commit alike.
  const rows = useMemo(
    () =>
      req.rows.map((r) => ({
        ...r,
        onPress: () => {
          r.onPress();
          dismiss();
        },
      })),
    [req, dismiss],
  );

  // What a commit (lift over a row) runs — registered, since the lifting finger belongs to the
  // pressed row's gesture, which knows nothing about this component.
  useEffect(() => {
    setRowActions(rows.map((r) => (r.loading || r.disabled ? () => {} : r.onPress)));
    return () => setRowActions([]);
  }, [rows]);

  // ── Peek: hit-test the held finger into a row, light it up, tick as it crosses rows ──
  useAnimatedReaction(
    () => {
      if (!ctxHoldActive.value || !ctxHoldArmed.value) return -1;
      const local = ctxHoldY.value - top - MENU_PAD_V - headerH;
      if (local < 0) return -1;
      const index = Math.floor(local / MENU_ROW_HEIGHT);
      return index >= 0 && index < req.rows.length ? index : -1;
    },
    (row, prev) => {
      if (row === prev) return;
      ctxHoveredRow.set(row);
      if (row >= 0) runOnJS(selectionTick)();
    },
    [top, headerH, req.rows.length],
  );

  // The ONE travelling bubble (see the material module): fades in where the finger enters, slides
  // between rows once showing.
  const hoverY = useSharedValue(0);
  const hoverOn = useSharedValue(0);
  useAnimatedReaction(
    () => ctxHoveredRow.value,
    (row, prev) => {
      if (row === prev) return;
      if (row < 0) {
        hoverOn.set(withTiming(0, HOVER_FADE));
        return;
      }
      const y = MENU_PAD_V + headerH + row * MENU_ROW_HEIGHT;
      if (prev == null || prev < 0) {
        hoverY.set(y);
        hoverOn.set(withTiming(1, HOVER_FADE));
      } else {
        hoverY.set(withSpring(y, HOVER_SPRING));
      }
    },
    [headerH],
  );
  const hoverStyle = useAnimatedStyle(() => ({
    opacity: hoverOn.value * HIGHLIGHT_OPACITY,
    transform: [{ translateY: hoverY.value }],
  }));

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 0.3, 1], [0, 0, BACKDROP_BLUR]),
  }));
  const scrimOpacity = BACKDROP_TINT_OPACITY[tint];
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 0, scrimOpacity]),
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [below ? -8 : 8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.92, 1]) },
    ],
  }));

  // Tap the backdrop to dismiss — a gesture with a distance bound, exactly as the card popup does,
  // so a drag that happens to start on the backdrop isn't counted as a tap.
  const tapDismiss = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .onEnd((_e, success) => {
          if (success) runOnJS(dismiss)();
        }),
    [dismiss],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={tapDismiss}>
        <View style={StyleSheet.absoluteFill}>
          <AnimatedBlurView
            tint={tint}
            experimentalBlurMethod={ANDROID_BLUR}
            animatedProps={backdropBlurProps}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP_TINT[tint] }, backdropTintStyle]}
          />
        </View>
      </GestureDetector>
      <Animated.View style={[menuStyles.menuWrap, { width: menuW, left, top }, menuStyle]}>
        <MenuSurface
          tint={tint}
          rows={rows}
          channel={{ holdActive: ctxHoldActive, hoveredRow: ctxHoveredRow }}
          hoverStyle={hoverStyle}
          {...(req.title !== undefined && { title: req.title })}
        />
      </Animated.View>
    </View>
  );
}
