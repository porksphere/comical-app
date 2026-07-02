import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useIsLargeScreen } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';

// A small stacked-overlay system. On phones (and mobile web / iOS) each overlay
// is a bottom sheet with a drag handle (swipe down to dismiss); opening a new
// one pushes the one below it back (scale + lift + dim). On wide desktop
// viewports (≥768px) the same content is instead presented as an anchored
// popover that drops in next to the trigger that opened it. Works on iOS,
// Android and web (reanimated + gesture-handler).

/** On-screen rectangle of the trigger that opened an overlay, in window
 *  coordinates (from `measureInWindow`). Used to position the desktop popover. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

type OverlayApi = {
  open: (render: () => ReactNode, anchor?: AnchorRect | null) => void;
  closeTop: () => void;
};

const OverlayContext = createContext<OverlayApi | null>(null);

export function useOverlay(): OverlayApi {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlay must be used within an OverlayProvider');
  return ctx;
}

/**
 * Opens an overlay anchored to its trigger: attach the returned `ref` to the
 * trigger (a `Pressable`/`View`) and call `openAt(render)` on press. It measures
 * the trigger's on-screen rect and hands it to `open`, so the desktop popover
 * can position itself next to the trigger. On phones the rect is ignored and the
 * bottom sheet is shown as before. Falls back to a plain `open` if the ref isn't
 * measurable yet.
 */
export function useAnchoredOverlay() {
  const { open } = useOverlay();
  const ref = useRef<View>(null);
  const openAt = useCallback(
    (render: () => ReactNode) => {
      const node = ref.current;
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow((x, y, width, height) => open(render, { x, y, width, height }));
      } else {
        open(render);
      }
    },
    [open],
  );
  return { ref, openAt };
}

// Lets a scrollable inside a sheet hand its scroll to the sheet's drag-to-
// dismiss: it reports its vertical offset (so the sheet only takes over a
// downward drag once the list is at the top) and registers its ref so the
// sheet's pan can run simultaneously with the list's own scroll.
type SheetScroll = {
  scrollRef: RefObject<ComponentType | null>;
  scrollOffset: SharedValue<number>;
};

const SheetScrollContext = createContext<SheetScroll | null>(null);

/** Available to content rendered inside an overlay sheet; null elsewhere. */
export function useSheetScroll(): SheetScroll | null {
  return useContext(SheetScrollContext);
}

// How the current overlay content is being presented: the mobile bottom sheet or
// the desktop anchored popover. Lets shared interior bits (e.g. the heading)
// adapt without each call site knowing which container wraps it.
type OverlayPresentation = 'sheet' | 'popover';
const OverlayPresentationContext = createContext<OverlayPresentation>('sheet');

/** Whether overlay content is shown as the mobile sheet or the desktop popover. */
export function useOverlayPresentation(): OverlayPresentation {
  return useContext(OverlayPresentationContext);
}

/**
 * The heading for overlay content — the single place overlay titles live, shared
 * by every editor / menu / sheet. Rendered on the mobile sheet; hidden in the
 * desktop popover, which is anchored to the trigger that already names it.
 */
export function OverlayHeading({ children }: { children: string }) {
  if (useOverlayPresentation() === 'popover') return null;
  return (
    <ThemedText type="subtitle" style={styles.heading}>
      {children}
    </ThemedText>
  );
}

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

// The sheet itself (`OverlaySheet` below) has no max-height/scroll of its
// own — only a list rendered via `OptionList` scrolls internally — so an
// under-budgeted cap could make the sheet's total height (handle + header +
// list + safe-area padding) exceed a short viewport, clipping the list
// against the screen edge instead of scrolling into view. Rather than guess
// that budget per caller (title-only vs title+helper vs chips+input+helper
// all reserve different amounts), each caller measures its own header via
// `MeasuredHeader` and `useListMaxHeight` computes exactly what's left.
// A `row`'s rendered height (paddingVertical × 2 + ~24px text line) plus its
// list's own inter-row gap is ~64px. A cap that isn't a whole multiple of
// that slices the last visible row mid-height instead of showing it in full
// — e.g. a 6-option list (6 × 64 - 4 = 380px of content) against a 360px cap
// left an option showing at ~40 of its 56px, looking cut in half rather than
// like an intentional scroll-affordance peek. 7 whole rows covers ordinary
// lists (a handful of genres/tags/bridges); longer ones still scroll —
// they're well past any reasonable cap.
const ROW_UNIT_HEIGHT = 64;
const LIST_MAX_HEIGHT = ROW_UNIT_HEIGHT * 7 - Spacing.two;
const LIST_MIN_HEIGHT = 160;
// Matches this file's own handleArea (paddingTop + handle height + paddingBottom).
const HANDLE_AREA_HEIGHT = Spacing.two + 5 + Spacing.three;
// The gap between a `MeasuredHeader` and the `OptionList` below it (set on
// each caller's own wrapping `View`), plus rounding slack.
const HEADER_TO_LIST_GAP = Spacing.three;
const SAFETY_MARGIN = Spacing.two;
// Trailing space *inside* the scrollable list's own content, after the last
// row — part of `listContent` below, not a separately-painted view and not
// outer margin on the sheet (that either paints a bar-shaped block in the
// panel's own fill or, worse, exposes the dimmed backdrop as a stripe below
// the sheet — both tried and rejected). This just gives the content itself a
// bit more height, so the last row isn't flush against the sheet's own
// bottom edge (or, for a short list, against the screen).
const LIST_TRAILING_SPACE = Spacing.four;

/** How tall an `OptionList` in the current sheet can be, given the height its
 *  own `MeasuredHeader` (title, helper text, search input, …) measured at. */
export function useListMaxHeight(headerHeight: number): number {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // `insets.bottom` matches the sheet's own `paddingBottom` (the real
  // home-indicator clearance); LIST_TRAILING_SPACE matches this list's own
  // contentContainerStyle paddingBottom below.
  const reserved =
    insets.top + HANDLE_AREA_HEIGHT + headerHeight + HEADER_TO_LIST_GAP + insets.bottom + LIST_TRAILING_SPACE + SAFETY_MARGIN;
  return Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, windowHeight - reserved));
}

/** Wraps a sheet's non-list content (title, helper text, search input, …)
 *  and reports its rendered height so `useListMaxHeight` can size the list to
 *  whatever's actually left, instead of guessing a fixed budget per caller. */
export function MeasuredHeader({ children, onHeight }: { children: ReactNode; onHeight: (h: number) => void }) {
  return (
    <View style={listStyles.header} onLayout={(e) => onHeight(e.nativeEvent.layout.height)}>
      {children}
    </View>
  );
}

/** Caps long option lists with an internal scroll so the sheet stays usable.
 * `fixed` keeps a constant height (so the sheet doesn't resize while searching).
 *
 * Reports its scroll offset to the enclosing overlay sheet (and registers its
 * ref) so a downward drag at the top of the list chains into dismissing the
 * sheet. A gesture-handler ScrollView lets that drag run simultaneously with
 * this list's own scroll.
 *
 * Below the last row, both the gaps between rows and the sheet's own
 * trailing safe-area padding read as the sheet's own panel color — the same
 * color, so no spacer/bleed view is needed here. An earlier version painted
 * a separate block in this gap to patch a suspected seam; because that block
 * was `pointerEvents: 'none'`, pixel probes done via `elementFromPoint` never
 * saw it (that API skips non-interactive elements), so it shipped even
 * though it was clearly visible on screen. Screenshots (not DOM color
 * probing) are what caught it. */
export function OptionList({
  children,
  fixed,
  maxHeight,
}: {
  children: ReactNode;
  fixed?: boolean;
  maxHeight: number;
}) {
  const sheet = useSheetScroll();
  const localOffset = useSharedValue(0);
  const offset = sheet?.scrollOffset ?? localOffset;
  const onScroll = useAnimatedScrollHandler((e) => {
    offset.value = e.contentOffset.y;
  });
  return (
    <AnimatedScrollView
      ref={sheet?.scrollRef as never}
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={fixed ? { height: maxHeight } : { maxHeight }}
      contentContainerStyle={listStyles.listContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </AnimatedScrollView>
  );
}

const listStyles = StyleSheet.create({
  header: {
    gap: Spacing.three,
  },
  listContent: {
    gap: Spacing.two,
    paddingBottom: LIST_TRAILING_SPACE,
  },
});

type Item = { id: number; render: () => ReactNode; anchor?: AnchorRect | null };

const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const idRef = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  const closers = useRef(new Map<number, () => void>());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const open = useCallback((render: () => ReactNode, anchor?: AnchorRect | null) => {
    setItems((prev) => [...prev, { id: idRef.current++, render, anchor }]);
  }, []);

  const remove = useCallback((id: number) => {
    closers.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const register = useCallback((id: number, fn: () => void) => {
    closers.current.set(id, fn);
  }, []);

  const closeTop = useCallback(() => {
    const top = itemsRef.current[itemsRef.current.length - 1];
    if (top) closers.current.get(top.id)?.();
  }, []);

  const api = useMemo(() => ({ open, closeTop }), [open, closeTop]);

  // Desktop shows anchored popovers; the mobile sheet's scale-the-app-back and
  // heavy dim are skipped there (the backdrop stays as a transparent
  // click-catcher so an outside click still closes the top popover).
  const isLargeScreen = useIsLargeScreen();

  const depth = items.length;
  const appProgress = useSharedValue(0);
  useEffect(() => {
    appProgress.value = withSpring(depth > 0 ? 1 : 0, SPRING);
  }, [depth, appProgress]);

  const appStyle = useAnimatedStyle(() =>
    isLargeScreen
      ? { transform: [{ scale: 1 }], borderRadius: 0 }
      : {
          transform: [{ scale: interpolate(appProgress.value, [0, 1], [1, 0.93]) }],
          borderRadius: interpolate(appProgress.value, [0, 1], [0, 28]),
        },
  );
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: isLargeScreen ? 0 : interpolate(appProgress.value, [0, 1], [0, 0.5]),
  }));

  // The app scales down + rounds its corners while any overlay is open (below),
  // exposing this root color in the margin around it — was hardcoded black
  // regardless of theme, showing as a stray dark bar (most visible behind a
  // bottom sheet) instead of matching the actual page background.
  const theme = useTheme();

  return (
    <OverlayContext.Provider value={api}>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <Animated.View style={[styles.appWrap, appStyle]}>{children}</Animated.View>

        <AnimatedPressable
          style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
          pointerEvents={depth > 0 ? 'auto' : 'none'}
          onPress={closeTop}
        />

        {items.map((it, i) =>
          isLargeScreen && it.anchor ? (
            <OverlayPopover
              key={it.id}
              id={it.id}
              anchor={it.anchor}
              onClosed={() => remove(it.id)}
              register={register}>
              {it.render()}
            </OverlayPopover>
          ) : (
            <OverlaySheet
              key={it.id}
              id={it.id}
              depthFromTop={items.length - 1 - i}
              onClosed={() => remove(it.id)}
              register={register}>
              {it.render()}
            </OverlaySheet>
          ),
        )}
      </View>
    </OverlayContext.Provider>
  );
}

function OverlaySheet({
  id,
  depthFromTop,
  onClosed,
  register,
  children,
}: {
  id: number;
  depthFromTop: number;
  onClosed: () => void;
  register: (id: number, fn: () => void) => void;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(height);
  const depthSV = useSharedValue(depthFromTop);
  const isTop = depthFromTop === 0;

  // Scroll coordination for drag-to-dismiss from the content (see SheetScroll).
  const scrollRef = useRef<ComponentType | null>(null);
  const scrollOffset = useSharedValue(0);
  // True once a content drag has "engaged" the sheet (list at top, pulling
  // down); the baseline is the drag distance at that moment, so the sheet
  // doesn't jump by however far the list was scrolled first.
  const dragging = useSharedValue(false);
  const dragBaseline = useSharedValue(0);
  const sheetScroll = useMemo<SheetScroll>(() => ({ scrollRef, scrollOffset }), [scrollOffset]);

  const close = useCallback(() => {
    translateY.value = withTiming(height, { duration: 240 }, (finished) => {
      if (finished) runOnJS(onClosed)();
    });
  }, [height, onClosed, translateY]);

  // Mount: slide up + register the imperative close used by the backdrop.
  useEffect(() => {
    translateY.value = withSpring(0, SPRING);
    register(id, close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    depthSV.value = withSpring(depthFromTop, SPRING);
  }, [depthFromTop, depthSV]);

  const dismissOrSnapBack = (translation: number, velocity: number) => {
    'worklet';
    if (translation > 120 || velocity > 900) {
      translateY.value = withTiming(height, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onClosed)();
      });
    } else {
      translateY.value = withSpring(0, SPRING);
    }
  };

  // Drag the handle down to dismiss (always available — the handle sits above
  // any scrollable content).
  const handlePan = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      dismissOrSnapBack(e.translationY, e.velocityY);
    });

  // Drag the sheet down from its content too, but only once the inner list is
  // at the top: while the list can still scroll up the gesture runs
  // simultaneously and leaves the sheet put; at the top a continued downward
  // drag chains into dismissal.
  const contentPan = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetY(12)
    .simultaneousWithExternalGesture(scrollRef)
    .onBegin(() => {
      dragging.value = false;
    })
    .onUpdate((e) => {
      if (!dragging.value) {
        if (scrollOffset.value <= 0 && e.translationY > 0) {
          dragging.value = true;
          dragBaseline.value = e.translationY;
        } else {
          return;
        }
      }
      // Reversed back into scrollable content — hand control back to the list.
      if (scrollOffset.value > 0) {
        dragging.value = false;
        translateY.value = 0;
        return;
      }
      translateY.value = Math.max(0, e.translationY - dragBaseline.value);
    })
    .onEnd((e) => {
      const moved = dragging.value;
      dragging.value = false;
      if (moved) dismissOrSnapBack(translateY.value, e.velocityY);
    });

  const sheetStyle = useAnimatedStyle(() => {
    const scale = interpolate(depthSV.value, [0, 1, 2], [1, 0.92, 0.86], Extrapolation.CLAMP);
    const lift = interpolate(depthSV.value, [0, 1, 2], [0, -14, -26], Extrapolation.CLAMP);
    return { transform: [{ translateY: translateY.value + lift }, { scale }] };
  });

  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(depthSV.value, [0, 1], [0, 0.45], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[styles.sheetWrap, sheetStyle]} pointerEvents="box-none">
      <OverlayPresentationContext.Provider value="sheet">
      <SheetScrollContext.Provider value={sheetScroll}>
        {/* `backgroundPanel` (not the default `background`) so the sheet's own
            surface — including the safe-area padding below the last row — reads
            as one consistent panel color instead of showing a seam where the
            base page background peeks through; distinct from `backgroundElement`
            (used by the rows on it) so those still stand out against the panel.
            Just `insets.bottom`, no extra: the sheet itself adds no cushion
            beyond the real home-indicator clearance — breathing room below the
            *content* (so a short list doesn't sit flush) belongs to the
            scrollable list's own trailing padding (`OptionList`'s
            `listContent` above) / the overflow-filters sheet's own content
            padding, not this outer container. Putting it out here as an
            offset (a prior attempt) exposed the dimmed backdrop behind the
            sheet as a large flat stripe — worse than what it replaced. */}
        <ThemedView type="backgroundPanel" style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          <GestureDetector gesture={handlePan}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
          </GestureDetector>

          <GestureDetector gesture={contentPan}>
            <View style={styles.sheetBody}>{children}</View>
          </GestureDetector>

          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}
          />
        </ThemedView>
      </SheetScrollContext.Provider>
      </OverlayPresentationContext.Provider>
    </Animated.View>
  );
}

// Desktop presentation: a card anchored next to its trigger. Drops in below the
// anchor by default, flips above when it would overflow the bottom, clamps
// horizontally to stay on-screen, and fades + scales in. No drag handle or pan
// gestures (those are sheet-only); the shared backdrop handles outside-click
// dismissal. Long content scrolls inside via the content's own list.
const POPOVER_WIDTH = 320;
const POPOVER_GAP = Spacing.one; // distance from the anchor edge
const POPOVER_PAD = Spacing.three; // keep-off-the-viewport-edges padding

function OverlayPopover({
  id,
  anchor,
  onClosed,
  register,
  children,
}: {
  id: number;
  anchor: AnchorRect;
  onClosed: () => void;
  register: (id: number, fn: () => void) => void;
  children: ReactNode;
}) {
  const { width: vw, height: vh } = useWindowDimensions();
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const progress = useSharedValue(0);
  const entered = useRef(false);

  const close = useCallback(() => {
    progress.value = withTiming(0, { duration: 120 }, (finished) => {
      if (finished) runOnJS(onClosed)();
    });
  }, [onClosed, progress]);

  useEffect(() => {
    register(id, close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fade in only once measured, so the entrance plays at the final (possibly
  // flipped) position with no visible jump.
  useEffect(() => {
    if (card && !entered.current) {
      entered.current = true;
      progress.value = withTiming(1, { duration: 140 });
    }
  }, [card, progress]);

  const width = Math.min(POPOVER_WIDTH, vw - POPOVER_PAD * 2);
  const left = Math.min(Math.max(POPOVER_PAD, anchor.x), vw - width - POPOVER_PAD);
  const spaceBelow = vh - (anchor.y + anchor.height) - POPOVER_GAP - POPOVER_PAD;
  const spaceAbove = anchor.y - POPOVER_GAP - POPOVER_PAD;
  const h = card?.height ?? 0;
  const below = h <= spaceBelow || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(160, below ? spaceBelow : spaceAbove);
  const top = below
    ? anchor.y + anchor.height + POPOVER_GAP
    : Math.max(POPOVER_PAD, anchor.y - POPOVER_GAP - Math.min(h, maxHeight));

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [below ? -6 : 6, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.96, 1]) },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.popoverWrap, { left, top, width }, animStyle]}>
      <ThemedView
        style={[styles.popover, { maxHeight }]}
        onLayout={(e) => {
          const { width: w, height: hh } = e.nativeEvent.layout;
          setCard((prev) => (prev && prev.height === hh && prev.width === w ? prev : { width: w, height: hh }));
        }}>
        <OverlayPresentationContext.Provider value="popover">{children}</OverlayPresentationContext.Provider>
      </ThemedView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    // backgroundColor set inline from the theme (see OverlayProvider) — this
    // is only the layout half of the style.
    flex: 1,
  },
  appWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.four,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
  sheetBody: {
    gap: Spacing.two,
  },
  dim: {
    backgroundColor: '#000000',
  },
  popoverWrap: {
    position: 'absolute',
  },
  popover: {
    borderRadius: 16,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    overflow: 'hidden',
    // The card shares the sheet's background, so on the (also dark) page a light
    // edge — not the shadow — is what separates it; the shadow only lifts it on
    // lighter surroundings.
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  heading: {
    marginBottom: Spacing.one,
  },
});
