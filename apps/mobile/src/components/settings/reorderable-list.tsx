import { type ReactNode, useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type AnimatedRef,
  measure,
  runOnJS,
  scrollTo,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ArrowDownIcon, ArrowUpIcon, GripIcon } from '@/components/icons/ui-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

/**
 * A self-contained reorderable scroll surface, following the app's platform-split gesture ethos (see
 * `SwipeableSettingsRow`): long-press-drag on iOS/Android, up/down buttons on web (mouse-drag isn't
 * worth it). It owns its own scroll view — necessary so the native path can autoscroll while a drag
 * nears an edge — so a page renders it *instead of* its normal scroll while editing, not inside it.
 *
 * Fixed-height rows keep the drag math a simple `round(y / ROW_HEIGHT)`. Emits the full new key
 * order on every committed move; the caller persists it (e.g. `setBridgeOrder`) and re-sorts its
 * data, which flows back in as `data`.
 */
const ROW_HEIGHT = 52;
const SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;
const EDGE = 72; // px from a viewport edge where autoscroll kicks in
const MAX_STEP = 12; // max px/frame autoscroll speed
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
  const contentPadding = useSettingsScrollPadding();
  const move = (from: number, to: number) => {
    if (to < 0 || to >= data.length) return;
    const keys = data.map(keyOf);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k as string);
    onReorder(keys);
  };
  return (
    <ScrollView contentContainerStyle={contentPadding} style={styles.host}>
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
    </ScrollView>
  );
}

/** Move `key` to slot `target`, pushing whatever's there into `key`'s old slot. UI-thread worklet. */
function moveTo(positions: SharedValue<Record<string, number>>, key: string, target: number, count: number): void {
  'worklet';
  const cur = positions.value[key] ?? 0;
  const t = Math.min(count - 1, Math.max(0, target));
  if (t === cur) return;
  const next = { ...positions.value };
  for (const k in next) {
    if (next[k] === t) next[k] = cur;
  }
  next[key] = t;
  positions.value = next;
}

// ── Native: long-press drag with edge autoscroll ─────────────────────────────
function DragList<T>({ data, keyOf, label, leading, onReorder }: ReorderableListProps<T>) {
  const contentPadding = useSettingsScrollPadding();
  const keys = data.map(keyOf);
  const count = keys.length;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const positions = useSharedValue<Record<string, number>>(Object.fromEntries(keys.map((k, i) => [k, i])));
  const draggingKey = useSharedValue<string | null>(null);
  const activeTop = useSharedValue(0); // content-Y of the dragged row's top
  const grabOffset = useSharedValue(0); // finger offset within the grabbed row
  const fingerVY = useSharedValue(0); // finger position within the viewport (for autoscroll edges)
  const svTop = useSharedValue(0); // scroll view's screen top (measured on grab)
  const svHeight = useSharedValue(0);

  const contentHeight = count * ROW_HEIGHT + (contentPadding.paddingTop + contentPadding.paddingBottom);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // Re-sync slots when the item set/order changes (install/uninstall, or a committed reorder that
  // re-sorted `data`). Right after our own commit this is a no-op — data order already equals slots.
  const signature = keys.join(',');
  useEffect(() => {
    positions.value = Object.fromEntries(signature.split(',').map((k, i) => [k, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Autoscroll: while dragging and the finger is within EDGE of a viewport edge, scroll that way and
  // keep the dragged row + its target slot tracking the finger as the content moves beneath it.
  useFrameCallback(() => {
    const key = draggingKey.value;
    if (key === null) return;
    const fvy = fingerVY.value;
    let delta = 0;
    if (fvy < EDGE) delta = -MAX_STEP * Math.min(1, (EDGE - fvy) / EDGE);
    else if (fvy > svHeight.value - EDGE) delta = MAX_STEP * Math.min(1, (fvy - (svHeight.value - EDGE)) / EDGE);
    if (delta === 0) return;
    const maxScroll = Math.max(0, contentHeight - svHeight.value);
    const next = Math.min(maxScroll, Math.max(0, scrollY.value + delta));
    if (next === scrollY.value) return;
    scrollTo(scrollRef, 0, next, false);
    scrollY.value = next;
    activeTop.value = fvy + next - grabOffset.value;
    moveTo(positions, key, Math.round(activeTop.value / ROW_HEIGHT), count);
  });

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={[{ height: contentHeight }, { paddingTop: contentPadding.paddingTop, paddingHorizontal: contentPadding.paddingHorizontal }]}
      style={styles.host}>
      {data.map((item) => (
        <DragRow
          key={keyOf(item)}
          itemKey={keyOf(item)}
          count={count}
          scrollRef={scrollRef}
          scrollY={scrollY}
          positions={positions}
          draggingKey={draggingKey}
          activeTop={activeTop}
          grabOffset={grabOffset}
          fingerVY={fingerVY}
          svTop={svTop}
          svHeight={svHeight}
          label={label(item)}
          leading={leading?.(item)}
          onCommit={onReorder}
        />
      ))}
    </Animated.ScrollView>
  );
}

function DragRow({
  itemKey,
  count,
  scrollRef,
  scrollY,
  positions,
  draggingKey,
  activeTop,
  grabOffset,
  fingerVY,
  svTop,
  svHeight,
  label,
  leading,
  onCommit,
}: {
  itemKey: string;
  count: number;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  scrollY: SharedValue<number>;
  positions: SharedValue<Record<string, number>>;
  draggingKey: SharedValue<string | null>;
  activeTop: SharedValue<number>;
  grabOffset: SharedValue<number>;
  fingerVY: SharedValue<number>;
  svTop: SharedValue<number>;
  svHeight: SharedValue<number>;
  label: string;
  leading?: ReactNode;
  onCommit: (orderedKeys: string[]) => void;
}) {
  const theme = useTheme();

  const pan = Gesture.Pan()
    // Long-press to lift, so a plain vertical drag still scrolls the list; drag anywhere on the row.
    .activateAfterLongPress(180)
    .onStart((e) => {
      const m = measure(scrollRef);
      if (m) {
        svTop.value = m.pageY;
        svHeight.value = m.height;
      }
      const fvy = e.absoluteY - svTop.value;
      fingerVY.value = fvy;
      const fingerContentY = fvy + scrollY.value;
      grabOffset.value = fingerContentY - (positions.value[itemKey] ?? 0) * ROW_HEIGHT;
      activeTop.value = fingerContentY - grabOffset.value;
      draggingKey.value = itemKey;
      runOnJS(hapticImpactLight)();
    })
    .onUpdate((e) => {
      const fvy = e.absoluteY - svTop.value;
      fingerVY.value = fvy;
      activeTop.value = fvy + scrollY.value - grabOffset.value;
      moveTo(positions, itemKey, Math.round(activeTop.value / ROW_HEIGHT), count);
    })
    .onEnd(() => {
      draggingKey.value = null;
      const ordered = Object.keys(positions.value).sort((a, b) => positions.value[a] - positions.value[b]);
      runOnJS(onCommit)(ordered);
    });

  const style = useAnimatedStyle(() => {
    const active = draggingKey.value === itemKey;
    const slot = positions.value[itemKey] ?? 0;
    return {
      transform: [
        { translateY: active ? activeTop.value : withSpring(slot * ROW_HEIGHT, SPRING) },
        { scale: withSpring(active ? 1.03 : 1, SPRING) },
      ],
      zIndex: active ? 10 : 0,
      shadowOpacity: withSpring(active ? 0.2 : 0),
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
  host: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    height: ROW_HEIGHT,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
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
    // Absolute rows sit inside the scroll's padding box; offset them past the top inset by hand,
    // since `top`/translateY here are content coordinates measured from the padding box origin.
    paddingHorizontal: 0,
  },
});
