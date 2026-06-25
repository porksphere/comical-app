import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

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

  return (
    <OverlayContext.Provider value={api}>
      <View style={styles.root}>
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

  const pan = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        translateY.value = withTiming(height, { duration: 220 }, (finished) => {
          if (finished) runOnJS(onClosed)();
        });
      } else {
        translateY.value = withSpring(0, SPRING);
      }
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
      <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
        <GestureDetector gesture={pan}>
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
        </GestureDetector>

        <View style={styles.sheetBody}>{children}</View>

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}
        />
      </ThemedView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
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
