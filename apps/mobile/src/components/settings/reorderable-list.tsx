import { type ReactNode, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ArrowDownIcon, ArrowUpIcon, GripIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/**
 * A reorderable list, following the app's platform-split gesture ethos (see `SwipeableSettingsRow`):
 * long-press-drag on iOS/Android, up/down buttons on web (mouse-drag isn't worth it). It renders a
 * simplified fixed-height row per item and emits the full new key order on every committed move; the
 * caller persists that (e.g. `setBridgeOrder`) and re-sorts its data, which flows back in as `data`.
 *
 * No autoscroll yet — the drag math assumes the list fits the viewport, which the bridge/tracker
 * lists do in practice. A long list would want an autoscroll pass added to the native path.
 */
const ROW_HEIGHT = 52;
const SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;
const IS_WEB = Platform.OS === 'web';

type ReorderableListProps<T> = {
  data: T[];
  keyOf: (item: T) => string;
  label: (item: T) => string;
  leading?: (item: T) => ReactNode;
  /** The full new key order, emitted on every committed move. */
  onReorder: (orderedKeys: string[]) => void;
};

export function ReorderableList<T>(props: ReorderableListProps<T>) {
  return IS_WEB ? <UpDownList {...props} /> : <DragList {...props} />;
}

// ── Web: up / down move buttons ──────────────────────────────────────────────
function UpDownList<T>({ data, keyOf, label, leading, onReorder }: ReorderableListProps<T>) {
  const theme = useTheme();
  const move = (from: number, to: number) => {
    if (to < 0 || to >= data.length) return;
    const keys = data.map(keyOf);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k as string);
    onReorder(keys);
  };
  return (
    <View>
      {data.map((item, i) => (
        <ThemedView key={keyOf(item)} type="backgroundElement" style={styles.row}>
          {leading?.(item)}
          <ThemedText type="small" style={styles.label} numberOfLines={1}>
            {label(item)}
          </ThemedText>
          <Pressable
            disabled={i === 0}
            onPress={() => move(i, i - 1)}
            style={[styles.moveBtn, i === 0 && styles.moveBtnOff]}
            accessibilityRole="button"
            accessibilityLabel={`Move ${label(item)} up`}>
            <ArrowUpIcon color={theme.text} size={18} />
          </Pressable>
          <Pressable
            disabled={i === data.length - 1}
            onPress={() => move(i, i + 1)}
            style={[styles.moveBtn, i === data.length - 1 && styles.moveBtnOff]}
            accessibilityRole="button"
            accessibilityLabel={`Move ${label(item)} down`}>
            <ArrowDownIcon color={theme.text} size={18} />
          </Pressable>
        </ThemedView>
      ))}
    </View>
  );
}

// ── Native: long-press drag ──────────────────────────────────────────────────
function DragList<T>({ data, keyOf, label, leading, onReorder }: ReorderableListProps<T>) {
  const keys = data.map(keyOf);
  const positions = useSharedValue<Record<string, number>>(Object.fromEntries(keys.map((k, i) => [k, i])));
  const draggingKey = useSharedValue<string | null>(null);
  const dragY = useSharedValue(0);

  // Re-sync slots when the set/order of items changes (install/uninstall, or a committed reorder that
  // re-sorted `data`). Right after our own commit this is a no-op — data order already equals slots.
  const signature = keys.join(',');
  useEffect(() => {
    positions.value = Object.fromEntries(signature.split(',').map((k, i) => [k, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <View style={{ height: keys.length * ROW_HEIGHT }}>
      {data.map((item) => (
        <DragRow
          key={keyOf(item)}
          itemKey={keyOf(item)}
          count={keys.length}
          positions={positions}
          draggingKey={draggingKey}
          dragY={dragY}
          label={label(item)}
          leading={leading?.(item)}
          onCommit={onReorder}
        />
      ))}
    </View>
  );
}

function DragRow({
  itemKey,
  count,
  positions,
  draggingKey,
  dragY,
  label,
  leading,
  onCommit,
}: {
  itemKey: string;
  count: number;
  positions: SharedValue<Record<string, number>>;
  draggingKey: SharedValue<string | null>;
  dragY: SharedValue<number>;
  label: string;
  leading?: ReactNode;
  onCommit: (orderedKeys: string[]) => void;
}) {
  const theme = useTheme();

  const pan = Gesture.Pan()
    // Long-press to lift, so a normal vertical drag still scrolls the page; drag anywhere on the row.
    .activateAfterLongPress(180)
    .onStart(() => {
      draggingKey.value = itemKey;
      dragY.value = 0;
      runOnJS(hapticImpactLight)();
    })
    .onUpdate((e) => {
      dragY.value = e.translationY;
      const cur = positions.value[itemKey] ?? 0;
      const target = Math.min(count - 1, Math.max(0, Math.round((cur * ROW_HEIGHT + e.translationY) / ROW_HEIGHT)));
      if (target !== cur) {
        // The item currently occupying `target` takes our old slot; we take `target`.
        const next = { ...positions.value };
        for (const k in next) {
          if (next[k] === target) next[k] = cur;
        }
        next[itemKey] = target;
        positions.value = next;
      }
    })
    .onEnd(() => {
      dragY.value = 0;
      draggingKey.value = null;
      const ordered = Object.keys(positions.value).sort((a, b) => positions.value[a] - positions.value[b]);
      runOnJS(onCommit)(ordered);
    });

  const style = useAnimatedStyle(() => {
    const active = draggingKey.value === itemKey;
    const base = (positions.value[itemKey] ?? 0) * ROW_HEIGHT;
    return {
      transform: [
        { translateY: active ? base + dragY.value : withSpring(base, SPRING) },
        { scale: withSpring(active ? 1.02 : 1, SPRING) },
      ],
      zIndex: active ? 10 : 0,
      shadowOpacity: withSpring(active ? 0.18 : 0),
    };
  });

  return (
    <Animated.View style={[styles.dragRowAbs, style]}>
      <GestureDetector gesture={pan}>
        <ThemedView type="backgroundElement" style={styles.row}>
          {leading}
          <ThemedText type="small" style={styles.label} numberOfLines={1}>
            {label}
          </ThemedText>
          <View style={styles.handle} accessible accessibilityLabel={`Drag ${label} to reorder`}>
            <GripIcon color={theme.textSecondary} size={20} />
          </View>
        </ThemedView>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    height: ROW_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    // Native drag rows are absolutely stacked; a shadow needs a colour to render on iOS.
    shadowColor: '#000',
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  label: {
    flex: 1,
  },
  handle: {
    paddingHorizontal: Spacing.one,
  },
  moveBtn: {
    padding: Spacing.two,
    cursor: 'pointer',
  },
  moveBtnOff: {
    opacity: 0.3,
  },
  dragRowAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
  },
});
