import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useKeyboardLift } from '@/hooks/use-keyboard-lift';

const HIDDEN_FAINT = 0.6;

/** Bottom-centre "X / Y" pill; tapping reveals a numeric jump input + Go. */
export function ProgressPill({
  current,
  total,
  visible,
  onJump,
  onEditingChange,
}: {
  current: number;
  total: number;
  visible: boolean;
  onJump: (index: number) => void;
  /** Fires at each editing-state transition — lets a caller (the reader's
   *  chrome auto-hide timer) suspend itself while the page-jump input is open,
   *  so typing a page number doesn't get faded/disabled out from under the user. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // Raise the pill above the on-screen keyboard while editing, so the page number stays readable
  // as it's typed. Both platform halves live in use-keyboard-lift — see there for why the previous
  // `Keyboard.addListener` version silently did nothing on Android.
  const keyboardLift = useKeyboardLift(editing);

  // Faint rather than gone with the chrome — the page count is the one thing worth a glance while
  // reading, the same as the native navigator's counter chip. Still inert while hidden.
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : HIDDEN_FAINT, { duration: 200 }),
    transform: [{ translateY: -keyboardLift.value }],
  }));

  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBlurTimer = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };
  useEffect(() => clearBlurTimer, []);

  const startEditing = () => {
    clearBlurTimer();
    // Open EMPTY, with the current page as the placeholder. The old prefill
    // (current page + selectTextOnFocus) relied on focus selecting the text so
    // typing would replace it — but selectTextOnFocus doesn't fire on native
    // for an autoFocus-mounted input (iOS especially), leaving a stale "12"
    // the user had to backspace before typing. An empty field types clean
    // everywhere, and submitting it empty just closes without jumping.
    setText('');
    setEditing(true);
    onEditingChange?.(true);
  };
  const stopEditing = () => {
    clearBlurTimer();
    setEditing(false);
    onEditingChange?.(false);
  };

  // Tapping "Go" blurs the still-focused TextInput first (same event order on
  // web and native), and closing the row synchronously on that blur used to
  // unmount "Go" before its own press could land — so the tap silently did
  // nothing, while Enter (which submits without blurring elsewhere first)
  // worked. Defer the close briefly so a tap on "Go" (or Enter, which calls
  // submit -> stopEditing directly) has a chance to cancel it first.
  const handleBlur = () => {
    clearBlurTimer();
    blurTimer.current = setTimeout(stopEditing, 200);
  };

  const submit = () => {
    const n = parseInt(text, 10);
    stopEditing();
    if (Number.isFinite(n)) onJump(Math.max(0, Math.min(total - 1, n - 1)));
  };

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.wrap, { bottom: insets.bottom + Spacing.two }, style]}>
      {editing ? (
        <View style={styles.pill}>
          <TextInput
            testID="reader.progress-pill.input"
            autoFocus
            keyboardType="number-pad"
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            onBlur={handleBlur}
            placeholder={String(current + 1)}
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={styles.input}
          />
          <ThemedText style={styles.text}>/ {total}</ThemedText>
          <Pressable testID="reader.progress-pill.go" onPress={submit} hitSlop={8} style={styles.go}>
            <ThemedText style={styles.goText}>Go</ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable testID="reader.progress-pill" style={styles.pill} onPress={startEditing}>
          <ThemedText style={styles.text}>
            {current + 1} / {total}
          </ThemedText>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  text: {
    color: 'rgba(255,255,255,0.9)',
    fontVariant: ['tabular-nums'],
  },
  input: {
    minWidth: 40,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  go: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  goText: {
    color: '#fff',
    fontWeight: '600',
  },
});
