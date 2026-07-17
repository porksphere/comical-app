/**
 * The app's unified TOAST — a transient, self-dismissing notice for "it happened" feedback (a
 * setting flipped, a bulk action landed). One frosted pill floats near the bottom of the screen,
 * built from the same material as the hold menus, mounted once at the root (`ToastHost` in
 * _layout.tsx); anything announces via `showToast(...)`.
 *
 * Deliberately NOT for questions or errors that need action — those are `openConfirm` / inline
 * retry blocks. A toast never blocks: taps outside it pass through, and tapping the pill itself
 * just dismisses early. A new toast replaces the current one (latest wins, no queue).
 */
import { BlurView } from 'expo-blur';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ANDROID_BLUR, MENU_BLUR, MENU_FILL } from '@/components/context-menu-material';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useActiveColorScheme, useTheme } from '@/hooks/use-theme';

const OPEN_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
const DISMISS_MS = 140;
const DEFAULT_DURATION_MS = 2600;
const PILL_MAX_WIDTH = 420;

type ToastRequest = {
  /** Monotonic key: a new toast REPLACES the current pill (remount via `key`), restarting the
   *  enter animation and the auto-dismiss timer instead of silently swapping the text mid-fade. */
  id: number;
  message: string;
  durationMs: number;
};

// The currently-shown toast — a plain module store read via useSyncExternalStore, exactly the
// confirm-popup pattern (see its note on why not a Legend State observable).
let current: ToastRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
function setToast(req: ToastRequest | null): void {
  current = req;
  for (const l of listeners) l();
}

/** Show a transient notice, e.g. "NSFW enabled until the app is closed". Replaces any toast
 *  already showing. `duration` is the visible time before auto-dismiss. */
export function showToast(message: string, opts?: { durationMs?: number }): void {
  setToast({ id: nextId++, message, durationMs: opts?.durationMs ?? DEFAULT_DURATION_MS });
}

function useToast(): ToastRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => current,
    () => current,
  );
}

/** Root-mounted host (see app/_layout.tsx) — renders the showing toast, if any. */
export function ToastHost() {
  const req = useToast();
  if (!req) return null;
  // Keyed by id so a replacing toast remounts the pill: fresh enter animation, fresh timer.
  return <HostToast key={req.id} req={req} />;
}

function HostToast({ req }: { req: ToastRequest }) {
  const theme = useTheme();
  const scheme = useActiveColorScheme();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const close = () => {
    // Only clear if this pill is still the current one — a replacement already owns the slot.
    if (current?.id === req.id) setToast(null);
  };
  const dismiss = () => {
    progress.set(
      withTiming(0, { duration: DISMISS_MS }, (finished) => {
        if (finished) runOnJS(close)();
      }),
    );
  };

  useEffect(() => {
    progress.set(withSpring(1, OPEN_SPRING));
    const t = setTimeout(dismiss, req.durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [12, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.95, 1]) },
    ],
  }));

  return (
    // box-none: the toast never blocks the screen — only the pill itself is touchable.
    <View
      pointerEvents="box-none"
      style={[styles.host, { paddingBottom: BottomTabInset + insets.bottom + Spacing.four }]}>
      <Animated.View style={[styles.pillShadow, pillStyle]}>
        <BlurView
          tint={scheme}
          intensity={MENU_BLUR}
          experimentalBlurMethod={ANDROID_BLUR}
          style={[styles.pill, { borderColor: theme.backgroundSelected }]}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: MENU_FILL[scheme] }]} />
          <Pressable
            testID="toast.dismiss"
            onPress={dismiss}
            style={styles.pillPress}
            accessibilityRole="alert"
            accessibilityLabel={req.message}>
            <ThemedText type="small" style={styles.message}>
              {req.message}
            </ThemedText>
          </Pressable>
        </BlurView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
  },
  pillShadow: {
    maxWidth: PILL_MAX_WIDTH,
    borderRadius: 999,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  pill: {
    borderRadius: 999,
    overflow: 'hidden',
    // The glass edge — same treatment as the menu surface and the select-mode pills.
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillPress: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  message: {
    textAlign: 'center',
  },
});
