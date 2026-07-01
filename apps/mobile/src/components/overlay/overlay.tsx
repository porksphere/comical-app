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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A small stacked-overlay system: each overlay is a bottom sheet with a drag
// handle (swipe down to dismiss). Opening a new overlay pushes the one below it
// back (scale + lift + dim); dismissing the top one zooms the previous back in.
// Works on iOS, Android and web (reanimated + gesture-handler).

type OverlayApi = {
  open: (render: () => ReactNode) => void;
  closeTop: () => void;
};

const OverlayContext = createContext<OverlayApi | null>(null);

export function useOverlay(): OverlayApi {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlay must be used within an OverlayProvider');
  return ctx;
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

type Item = { id: number; render: () => ReactNode };

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

  const open = useCallback((render: () => ReactNode) => {
    setItems((prev) => [...prev, { id: idRef.current++, render }]);
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

  const depth = items.length;
  const appProgress = useSharedValue(0);
  useEffect(() => {
    appProgress.value = withSpring(depth > 0 ? 1 : 0, SPRING);
  }, [depth, appProgress]);

  const appStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(appProgress.value, [0, 1], [1, 0.93]) }],
    borderRadius: interpolate(appProgress.value, [0, 1], [0, 28]),
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(appProgress.value, [0, 1], [0, 0.5]),
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

        {items.map((it, i) => (
          <OverlaySheet
            key={it.id}
            id={it.id}
            depthFromTop={items.length - 1 - i}
            onClosed={() => remove(it.id)}
            register={register}>
            {it.render()}
          </OverlaySheet>
        ))}
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
      <SheetScrollContext.Provider value={sheetScroll}>
        {/* `backgroundPanel` (not the default `background`) so the sheet's own
            surface — including the safe-area padding below the last row — reads
            as one consistent panel color instead of showing a seam where the
            base page background peeks through; distinct from `backgroundElement`
            (used by the rows on it) so those still stand out against the panel.
            Just `insets.bottom`, no extra: the sheet itself adds no cushion
            beyond the real home-indicator clearance — breathing room below the
            *content* (so a short list doesn't sit flush) belongs to the
            scrollable list's own trailing padding (`listContent` in
            filter-editors.tsx) / the overflow-filters sheet's own content
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
});
