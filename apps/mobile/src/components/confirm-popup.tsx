/**
 * The destructive-action confirmation POPUP — the iOS Photos shape: a floating frosted card in the
 * screen's lower third carrying just the explanation and ONE danger verb; everywhere else is the
 * cancel (tap the backdrop to dismiss). Built from the same material as the hold menus (blur +
 * surface tint, the `plain` backdrop frost) and mounted once at the root (`ConfirmPopupHost` in
 * _layout.tsx); anything opens it via `openConfirm(...)`.
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useSyncExternalStore } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ANDROID_BLUR,
  BACKDROP_BLUR,
  BACKDROP_TINT,
  BACKDROP_TINT_OPACITY,
  MENU_BLUR,
  MENU_FILL,
} from '@/components/context-menu-material';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const OPEN_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
const CARD_MAX_WIDTH = 340;

export type ConfirmRequest = {
  /** The full-sentence explanation, e.g. "3 chapters will be deleted from this device." */
  message: string;
  /** The danger verb-with-noun, e.g. "Delete Chapter". */
  confirmLabel: string;
  onConfirm: () => void;
};

// The currently-open confirmation — a plain module store read via useSyncExternalStore. NOT a
// Legend State observable: its typing treats function members (onConfirm) as computeds and mangles
// the request type.
let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();
function setConfirm(req: ConfirmRequest | null): void {
  current = req;
  for (const l of listeners) l();
}

export function openConfirm(req: ConfirmRequest): void {
  setConfirm(req);
}

function useConfirm(): ConfirmRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => current,
    () => current,
  );
}

/** Root-mounted host (see app/_layout.tsx) — renders the open request, if any. */
export function ConfirmPopupHost() {
  const req = useConfirm();
  if (!req) return null;
  return <HostPopup req={req} />;
}

function HostPopup({ req }: { req: ConfirmRequest }) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const dismiss = () => {
    progress.set(
      withTiming(0, { duration: 120 }, (finished) => {
        if (finished) runOnJS(close)();
      }),
    );
  };
  const close = () => setConfirm(null);

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    progress.set(withSpring(1, OPEN_SPRING));
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backdropBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(progress.value, [0, 1], [0, BACKDROP_BLUR.plain]),
  }));
  const scrimOpacity = BACKDROP_TINT_OPACITY[scheme];
  const backdropTintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, scrimOpacity]),
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [16, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.94, 1]) },
    ],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="auto">
      {/* Frosted backdrop; tapping ANYWHERE on it is the cancel. */}
      <AnimatedBlurView
        tint={scheme}
        animatedProps={backdropBlurProps}
        experimentalBlurMethod={ANDROID_BLUR}
        style={StyleSheet.absoluteFill}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP_TINT[scheme] }, backdropTintStyle]}
        />
        <Pressable testID="confirm.cancel" style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Cancel" />
      </AnimatedBlurView>

      {/* The floating card, lower third of the screen. */}
      <View pointerEvents="box-none" style={[styles.cardHost, { paddingBottom: insets.bottom + Spacing.six * 2 }]}>
        <Animated.View style={[styles.cardShadow, cardStyle]}>
          <BlurView tint={scheme} intensity={MENU_BLUR} experimentalBlurMethod={ANDROID_BLUR} style={styles.card}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: MENU_FILL[scheme] }]} />
            <ThemedText type="subtitle" style={styles.message}>
              {req.message}
            </ThemedText>
            <Pressable
              testID="confirm.confirm"
              onPress={() => {
                req.onConfirm();
                dismiss();
              }}
              style={({ pressed }) => [
                styles.verb,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.verbPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={req.confirmLabel}>
              <ThemedText type="subtitle" style={{ color: theme.danger }}>
                {req.confirmLabel}
              </ThemedText>
            </Pressable>
          </BlurView>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
  },
  cardShadow: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  card: {
    borderRadius: 28,
    overflow: 'hidden',
    padding: Spacing.five,
    gap: Spacing.five,
  },
  message: {
    textAlign: 'left',
  },
  verb: {
    borderRadius: 18,
    paddingVertical: Spacing.three + Spacing.one,
    alignItems: 'center',
  },
  verbPressed: {
    opacity: 0.7,
  },
});
