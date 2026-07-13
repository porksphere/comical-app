import { useEffect } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
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
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PullIndicator } from '@/components/pull-indicator';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { hapticImpactLight } from '@/lib/haptics';

import type { ReorderableListProps } from './reorderable-list.types';

/**
 * Our own in-place reorderable list — no external DnD library. The live list IS the drag surface: a
 * ~200ms long-press on any row lifts it and drags it into place. Built on the primitives this app
 * already owns (reanimated + gesture-handler + `usePullToRefresh` + the swipe row), so it does the
 * things a generic library couldn't for us:
 *
 *  - **Dynamic heights.** Each row measures itself (`onLayout` → `heights`), and a row's Y is the
 *    cumulative sum of the heights above it in `order` — so a taller status row never overlaps.
 *  - **Exact swipe-to-uninstall.** `renderRow` (the real `SwipeableSettingsRow`) is wrapped
 *    UNCHANGED; the drag pan (long-press) and the swipe pan (quick horizontal) coexist by activation:
 *    a hold drags, a flick swipes, a tap opens.
 *  - **Pull-to-refresh** on the same scroll (the shared `usePullToRefresh`), and **edge autoscroll**
 *    while dragging.
 *  - **Lift animation** — the held row springs up in scale with a shadow; neighbours part to open a
 *    gap by springing to their new cumulative offsets.
 *
 * ⚠️ Spike: the mechanics are here but the multi-gesture feel needs on-device tuning (esp. the
 * swipe-vs-drag hand-off and autoscroll speed).
 */
const EST_ROW = 56; // fallback height for a row not yet measured
const LIFT_SCALE = 1.03;
const SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;
const EDGE = 72; // px from a viewport edge where autoscroll kicks in
const MAX_STEP = 12; // max px/frame autoscroll speed

/** Cumulative Y of `id`'s top: sum of the heights of everything before it in `order`. UI-thread. */
function offsetOf(order: string[], heights: Record<string, number>, id: string): number {
  'worklet';
  let y = 0;
  for (const k of order) {
    if (k === id) return y;
    y += heights[k] ?? EST_ROW;
  }
  return y;
}

/** Total content height = sum of all row heights. */
function totalOf(order: string[], heights: Record<string, number>): number {
  'worklet';
  let y = 0;
  for (const k of order) y += heights[k] ?? EST_ROW;
  return y;
}

export function ReorderableList<T>({ data, keyOf, renderRow, onReorder, refresh }: ReorderableListProps<T>) {
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const svTop = useSharedValue(0);
  const svHeight = useSharedValue(0);
  const heights = useSharedValue<Record<string, number>>({});
  const order = useSharedValue<string[]>(data.map(keyOf));
  const activeId = useSharedValue<string | null>(null);
  const activeTop = useSharedValue(0); // content-Y of the dragged row's top (follows the finger)
  const grabOffset = useSharedValue(0);
  const fingerVY = useSharedValue(0); // finger position within the viewport (for autoscroll edges)

  const pull = usePullToRefresh(scrollY, refresh ?? (async () => {}));

  // Re-sync order when the item set/order changes (install/uninstall, or a committed reorder that
  // re-sorted `data`). A no-op right after our own commit — data order already equals `order`.
  const signature = data.map(keyOf).join(',');
  useEffect(() => {
    order.value = signature.length ? signature.split(',') : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const contentHeight = useDerivedValue(() => totalOf(order.value, heights.value));
  const containerStyle = useAnimatedStyle(() => ({ height: contentHeight.value }));

  // Autoscroll while dragging near an edge, keeping the row + its target tracking the finger.
  useFrameCallback(() => {
    if (activeId.value === null) return;
    const fvy = fingerVY.value;
    let delta = 0;
    if (fvy < EDGE) delta = -MAX_STEP * Math.min(1, (EDGE - fvy) / EDGE);
    else if (fvy > svHeight.value - EDGE) delta = MAX_STEP * Math.min(1, (fvy - (svHeight.value - EDGE)) / EDGE);
    if (delta === 0) return;
    const maxScroll = Math.max(0, contentHeight.value - svHeight.value);
    const next = Math.min(maxScroll, Math.max(0, scrollY.value + delta));
    if (next === scrollY.value) return;
    scrollTo(scrollRef, 0, next, false);
    scrollY.value = next;
    activeTop.value = fvy + next - grabOffset.value;
    reorderTo(order, heights, activeId.value, activeTop.value);
  });

  const commit = (nextOrder: string[]) => onReorder(nextOrder);

  return (
    // Touch-driven pull (web + Android) is caught here; iOS pulls from the scroll bounce.
    <View style={styles.host} {...pull.touchHandlers}>
      <Animated.ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} onScrollEndDrag={pull.onScrollEndDrag} contentContainerStyle={contentPadding}>
        <Animated.View style={[pull.listStyle, containerStyle]}>
          {data.map((item) => (
            <DragRow
              key={keyOf(item)}
              id={keyOf(item)}
              scrollRef={scrollRef}
              scrollY={scrollY}
              svTop={svTop}
              svHeight={svHeight}
              heights={heights}
              order={order}
              activeId={activeId}
              activeTop={activeTop}
              grabOffset={grabOffset}
              fingerVY={fingerVY}
              onCommit={commit}>
              {renderRow(item)}
            </DragRow>
          ))}
        </Animated.View>
      </Animated.ScrollView>
      <PullIndicator {...pull.indicator} top={insets.top + barHeight} />
    </View>
  );
}

/** Move `id` to the slot its dragged top now falls in (by cumulative offsets), reordering `order`. */
function reorderTo(order: SharedValue<string[]>, heights: SharedValue<Record<string, number>>, id: string, topY: number): void {
  'worklet';
  const arr = order.value;
  const cur = arr.indexOf(id);
  if (cur < 0) return;
  let y = 0;
  let target = arr.length - 1;
  for (let i = 0; i < arr.length; i++) {
    const h = heights.value[arr[i]] ?? EST_ROW;
    if (topY < y + h / 2) {
      target = i;
      break;
    }
    y += h;
  }
  if (target === cur) return;
  const next = [...arr];
  next.splice(cur, 1);
  next.splice(target, 0, id);
  order.value = next;
}

function DragRow({
  id,
  scrollRef,
  scrollY,
  svTop,
  svHeight,
  heights,
  order,
  activeId,
  activeTop,
  grabOffset,
  fingerVY,
  onCommit,
  children,
}: {
  id: string;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  scrollY: SharedValue<number>;
  svTop: SharedValue<number>;
  svHeight: SharedValue<number>;
  heights: SharedValue<Record<string, number>>;
  order: SharedValue<string[]>;
  activeId: SharedValue<string | null>;
  activeTop: SharedValue<number>;
  grabOffset: SharedValue<number>;
  fingerVY: SharedValue<number>;
  onCommit: (order: string[]) => void;
  children: React.ReactNode;
}) {
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && heights.value[id] !== h) heights.value = { ...heights.value, [id]: h };
  };

  const pan = Gesture.Pan()
    // Long-press to lift, so a plain vertical drag still scrolls and a quick horizontal is the swipe.
    .activateAfterLongPress(200)
    .onStart((e) => {
      const m = measure(scrollRef);
      if (m) {
        svTop.value = m.pageY;
        svHeight.value = m.height;
      }
      const fvy = e.absoluteY - svTop.value;
      fingerVY.value = fvy;
      const fingerContentY = fvy + scrollY.value;
      grabOffset.value = fingerContentY - offsetOf(order.value, heights.value, id);
      activeTop.value = fingerContentY - grabOffset.value;
      activeId.value = id;
      runOnJS(hapticImpactLight)();
    })
    .onUpdate((e) => {
      const fvy = e.absoluteY - svTop.value;
      fingerVY.value = fvy;
      activeTop.value = fvy + scrollY.value - grabOffset.value;
      reorderTo(order, heights, id, activeTop.value);
    })
    .onEnd(() => {
      activeId.value = null;
      runOnJS(onCommit)(order.value);
    });

  const style = useAnimatedStyle(() => {
    const active = activeId.value === id;
    const target = offsetOf(order.value, heights.value, id);
    return {
      transform: [
        { translateY: active ? activeTop.value : withSpring(target, SPRING) },
        { scale: withSpring(active ? LIFT_SCALE : 1, SPRING) },
      ],
      zIndex: active ? 10 : 0,
      shadowColor: '#000',
      shadowOpacity: withSpring(active ? 0.2 : 0),
      shadowRadius: 10,
    };
  });

  return (
    <Animated.View style={[styles.rowAbs, style]} onLayout={onLayout}>
      <GestureDetector gesture={pan}>{children}</GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  rowAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
