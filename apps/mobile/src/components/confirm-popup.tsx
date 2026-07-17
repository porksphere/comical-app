/**
 * The destructive-action confirmation POPUP — the iOS Photos shape: a floating frosted card in the
 * screen's lower third carrying the explanation and ONE verb; everywhere else is the cancel (tap
 * the backdrop to dismiss). Built from the same material as the hold menus (blur + surface tint,
 * the `plain` backdrop frost) and mounted once at the root (`ConfirmPopupHost` in _layout.tsx);
 * anything opens it via `openConfirm(...)`.
 *
 * The minimal request is `{ message, confirmLabel, onConfirm }` — the pure Photos shape. The rest
 * is opt-in per call: a `title` heading and muted `detail` line for identity-heavy confirms
 * (WHICH registry/bridge), a non-danger `tone`, and an ASYNC `onConfirm` — the popup then stays
 * open with the verb reading `pendingLabel` until it settles, showing a rejection inline (via
 * `friendlyError` + `errorFallback`) so the user can retry or cancel.
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, useSyncExternalStore } from 'react';
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
import { friendlyError } from '@/lib/friendly-error';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const OPEN_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;
const CARD_MAX_WIDTH = 270;

export type ConfirmRequest = {
  /** Optional bold heading above the message, e.g. "Uninstall Tachiyomi?". Omit for the pure
   *  message-only Photos shape. */
  title?: string;
  /** The full-sentence explanation, e.g. "3 chapters will be deleted from this device." */
  message: string;
  /** Optional muted secondary line under the message — the subject's identity (a URL, a path). */
  detail?: string;
  /** The verb-with-noun, e.g. "Delete Chapter". */
  confirmLabel: string;
  /** Verb tint: 'danger' (default) for destructive verbs; 'primary' (accent) for consequential-
   *  but-safe confirmations that still deserve the popup. */
  tone?: 'danger' | 'primary';
  /** A SYNC handler dismisses immediately (fire-and-forget, the original behavior). An ASYNC
   *  handler keeps the popup open — the verb reads `pendingLabel` and goes inert — until it
   *  settles: resolving dismisses; rejecting shows the error inline and leaves the popup open so
   *  the user can retry or cancel. */
  onConfirm: () => void | Promise<void>;
  /** Verb text while an async `onConfirm` runs, e.g. "Removing…". Defaults to `confirmLabel`. */
  pendingLabel?: string;
  /** Fallback for a rejection without a usable message (see `friendlyError`). */
  errorFallback?: string;
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
  // Async-confirm state: the verb goes inert with `pendingLabel` while `onConfirm` runs; a
  // rejection lands here and keeps the popup open (retry or cancel).
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = () => {
    progress.set(
      withTiming(0, { duration: 120 }, (finished) => {
        if (finished) runOnJS(close)();
      }),
    );
  };
  // Only clear the slot if this request still owns it — with async confirms, a late dismiss (e.g.
  // the settle after a backdrop cancel) must not clobber a NEWER popup that opened meanwhile.
  const close = () => {
    if (current === req) setConfirm(null);
  };

  const confirm = async () => {
    if (pending) return;
    setError(null);
    let result: void | Promise<void>;
    try {
      result = req.onConfirm();
    } catch (e) {
      setError(friendlyError(e, req.errorFallback ?? 'Something went wrong'));
      return;
    }
    if (!(result instanceof Promise)) {
      // Sync handler: fire-and-forget, dismiss immediately — the original behavior.
      dismiss();
      return;
    }
    setPending(true);
    try {
      await result;
      dismiss();
    } catch (e) {
      setError(friendlyError(e, req.errorFallback ?? 'Something went wrong'));
    } finally {
      setPending(false);
    }
  };

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
            {/* Text block: its own tighter gap, so title/message/detail read as one passage while
                the card's larger gap separates the passage from the verb. */}
            <View style={styles.body}>
              {req.title && <ThemedText type="smallBold">{req.title}</ThemedText>}
              <ThemedText style={styles.message}>{req.message}</ThemedText>
              {req.detail && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
                  {req.detail}
                </ThemedText>
              )}
              {error && (
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {error}
                </ThemedText>
              )}
            </View>
            <Pressable
              testID="confirm.confirm"
              onPress={() => void confirm()}
              disabled={pending}
              style={({ pressed }) => [
                styles.verb,
                { backgroundColor: theme.backgroundSelected },
                (pressed || pending) && styles.verbPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={req.confirmLabel}>
              <ThemedText
                type="smallBold"
                style={{ color: req.tone === 'primary' ? theme.accent : theme.danger }}>
                {pending ? (req.pendingLabel ?? req.confirmLabel) : req.confirmLabel}
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
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    padding: Spacing.four,
    gap: Spacing.four,
  },
  body: {
    gap: Spacing.two,
  },
  message: {
    textAlign: 'left',
  },
  // A full pill: the radius always exceeds half the button's height, so the ends are semicircles.
  verb: {
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  verbPressed: {
    opacity: 0.7,
  },
});
