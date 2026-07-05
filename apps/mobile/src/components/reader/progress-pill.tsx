import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

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
  const keyboardHeight = useSharedValue(0);

  // Native: raise the pill above the on-screen keyboard while editing. iOS fires
  // keyboardWill*  with a duration/easing synced to the keyboard's own animation;
  // Android only reliably fires keyboardDid* (abrupt, no duration), so its rise
  // just uses a synthetic ease instead — expected platform difference, not a bug.
  //
  // Listener lifetime is NOT gated on `editing`: tapping "Go" (or blurring)
  // flips `editing` to false immediately, but the real keyboard dismiss (and
  // its keyboardWill/DidHide event) only arrives after its own animation
  // finishes, shortly *after* that. Gating registration on `editing` tore the
  // listener down before that event could arrive, so the pill never came back
  // down. Keyboard state is independent of our own `editing` state — just keep
  // listening for the component's whole lifetime instead.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvent, (e) => {
      keyboardHeight.value = withTiming(Math.max(0, e.endCoordinates.height - insets.bottom), {
        duration: e.duration || 220,
      });
    });
    const subHide = Keyboard.addListener(hideEvent, (e) => {
      keyboardHeight.value = withTiming(0, { duration: e.duration || 220 });
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [insets.bottom, keyboardHeight]);

  // Web: adapts the visualViewport-resize signal search-field.tsx already uses
  // (there, to force a blur on keyboard-close) — here, into a raise-above-keyboard
  // offset instead. `scroll` also fires on some mobile browsers when the keyboard
  // shifts the viewport's offsetTop rather than resizing it.
  useEffect(() => {
    if (Platform.OS !== 'web' || !editing) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const baseline = window.innerHeight;
    const onResize = () => {
      keyboardHeight.value = withTiming(Math.max(0, baseline - vv.height - vv.offsetTop), { duration: 150 });
    };
    onResize();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      keyboardHeight.value = withTiming(0, { duration: 150 });
    };
  }, [editing, keyboardHeight]);

  const style = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, { duration: 200 }),
    transform: [{ translateY: -keyboardHeight.value }],
  }));

  const startEditing = () => {
    setText(String(current + 1));
    setEditing(true);
    onEditingChange?.(true);
  };
  const stopEditing = () => {
    setEditing(false);
    onEditingChange?.(false);
  };

  const submit = () => {
    const n = parseInt(text, 10);
    stopEditing();
    if (Number.isFinite(n)) onJump(Math.max(0, Math.min(total - 1, n - 1)));
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        { bottom: insets.bottom + Spacing.two, pointerEvents: visible ? 'box-none' : 'none' },
        style,
      ]}>
      {editing ? (
        <View style={styles.pill}>
          <TextInput
            autoFocus
            keyboardType="number-pad"
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            onBlur={stopEditing}
            placeholder={String(current + 1)}
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={styles.input}
          />
          <ThemedText style={styles.text}>/ {total}</ThemedText>
          <Pressable onPress={submit} hitSlop={8} style={styles.go}>
            <ThemedText style={styles.goText}>Go</ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.pill} onPress={startEditing}>
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
