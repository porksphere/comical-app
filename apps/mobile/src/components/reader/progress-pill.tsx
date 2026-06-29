import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Bottom-centre "X / Y" pill; tapping reveals a numeric jump input + Go. */
export function ProgressPill({
  current,
  total,
  visible,
  onJump,
}: {
  current: number;
  total: number;
  visible: boolean;
  onJump: (index: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const style = useAnimatedStyle(() => ({ opacity: withTiming(visible ? 1 : 0, { duration: 200 }) }));

  const submit = () => {
    const n = parseInt(text, 10);
    setEditing(false);
    if (Number.isFinite(n)) onJump(Math.max(0, Math.min(total - 1, n - 1)));
  };

  return (
    <Animated.View
      style={[styles.wrap, { bottom: insets.bottom + Spacing.two }, style]}
      pointerEvents={visible ? 'box-none' : 'none'}>
      {editing ? (
        <View style={styles.pill}>
          <TextInput
            autoFocus
            keyboardType="number-pad"
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            onBlur={() => setEditing(false)}
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
        <Pressable
          style={styles.pill}
          onPress={() => {
            setText(String(current + 1));
            setEditing(true);
          }}>
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
