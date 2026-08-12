import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PullIndicator } from '@/components/pull-indicator';
import { SettingsGutter, SettingsRowHeight } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useTopBarHeight } from '@/hooks/use-responsive';
import { useSettingsScrollPadding } from '@/hooks/use-settings-scroll-padding';
import { useTheme } from '@/hooks/use-theme';
import { hapticImpactLight } from '@/lib/haptics';

import type { ReorderableListProps } from './reorderable-list.types';

/**
 * Our own in-place reorderable list — no external DnD library. The live list IS the drag surface: a
 * ~200ms long-press on any row lifts it and drags it into place. Built on the primitives the app
 * already owns (reanimated + gesture-handler + `usePullToRefresh` + the swipe row):
 *
 *  - **Exact swipe-to-uninstall.** `renderRow` (the real `SwipeableSettingsRow`) is wrapped
 *    UNCHANGED; the drag pan (long-press) and swipe pan (quick horizontal) coexist by activation:
 *    a hold drags, a flick swipes, a tap opens.
 *  - **Pull-to-refresh** on the same scroll (the shared `usePullToRefresh` + `PullIndicator`), and
 *    the content fills the viewport so the pull is reachable from anywhere, not just over the rows.
 *  - **Edge autoscroll** while dragging; **lift** = scale + shadow, neighbours spring apart.
 *
 * Rows are a fixed `SettingsRowHeight` — the same constant every other settings row uses — so the
 * slot math is a simple `index * ROW` and rows never overlap. Reusable for any settings list (Bridges,
 * Trackers, …): it's generic over the item type and takes the row via `renderRow`.
 */
const ROW = SettingsRowHeight;
const LIFT_SCALE = 1.03;
const SPRING = { damping: 20, stiffness: 220, mass: 0.6 } as const;
const EDGE = 72; // px from a viewport edge where autoscroll kicks in
const MAX_STEP = 12; // max px/frame autoscroll speed

/** The slot Y for `id` in the current order. */
function slotY(order: string[], id: string): number {
  'worklet';
  const i = order.indexOf(id);
  return (i < 0 ? 0 : i) * ROW;
}

/** Move `id` to the slot its dragged top now falls in, reordering `order`. */
function reorderTo(order: SharedValue<string[]>, id: string, topY: number, count: number): void {
  'worklet';
  const arr = order.value;
  const cur = arr.indexOf(id);
  if (cur < 0) return;
  const target = Math.min(count - 1, Math.max(0, Math.round(topY / ROW)));
  if (target === cur) return;
  const next = [...arr];
  next.splice(cur, 1);
  next.splice(target, 0, id);
  order.set(next);
}

export function ReorderableList<T>({ data, keyOf, renderRow, onReorder, refresh, dragEnabled = true }: ReorderableListProps<T>) {
  const contentPadding = useSettingsScrollPadding();
  const insets = useSafeAreaInsets();
  const barHeight = useTopBarHeight();

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const svTop = useSharedValue(0);
  const svHeight = useSharedValue(0);
  const order = useSharedValue<string[]>(data.map(keyOf));
  const activeId = useSharedValue<string | null>(null);
  const activeTop = useSharedValue(0); // content-Y of the dragged row's top (follows the finger)
  const grabOffset = useSharedValue(0);
  const fingerVY = useSharedValue(0); // finger position within the viewport (for autoscroll edges)

  const count = data.length;
  const contentHeight = count * ROW;
  const pull = usePullToRefresh(scrollY, refresh ?? (async () => {}));

  // Re-sync order when the item set/order changes. A no-op right after our own commit.
  const signature = data.map(keyOf).join(',');
  useEffect(() => {
    order.set(signature.length ? signature.split(',') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });

  // Autoscroll while dragging near an edge, keeping the row + its target tracking the finger.
  useFrameCallback(() => {
    if (activeId.value === null) return;
    const fvy = fingerVY.value;
    let delta = 0;
    if (fvy < EDGE) delta = -MAX_STEP * Math.min(1, (EDGE - fvy) / EDGE);
    else if (fvy > svHeight.value - EDGE) delta = MAX_STEP * Math.min(1, (fvy - (svHeight.value - EDGE)) / EDGE);
    if (delta === 0) return;
    const maxScroll = Math.max(0, contentHeight + contentPadding.paddingTop + contentPadding.paddingBottom - svHeight.value);
    const next = Math.min(maxScroll, Math.max(0, scrollY.value + delta));
    if (next === scrollY.value) return;
    scrollTo(scrollRef, 0, next, false);
    scrollY.set(next);
    activeTop.set(fvy + next - grabOffset.value);
    reorderTo(order, activeId.value, activeTop.value, count);
  });

  const commit = (nextOrder: string[]) => onReorder(nextOrder);

  return (
    // Touch-driven pull (web + Android) is caught here; iOS pulls from the scroll bounce.
    <View style={styles.host} {...pull.touchHandlers}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollEndDrag={pull.onScrollEndDrag}
        // Fill the viewport even for a short list + always allow the bounce, so a pull anywhere on the
        // page engages the refresh — not only over the rows.
        alwaysBounceVertical
        contentContainerStyle={[contentPadding, styles.grow]}>
        <Animated.View style={[styles.grow, { minHeight: contentHeight }, pull.listStyle]}>
          {data.map((item, i) => (
            <DragRow
              key={keyOf(item)}
              id={keyOf(item)}
              count={count}
              divider={i < count - 1}
              dragEnabled={dragEnabled}
              scrollRef={scrollRef}
              scrollY={scrollY}
              svTop={svTop}
              svHeight={svHeight}
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

function DragRow({
  id,
  count,
  divider,
  dragEnabled,
  scrollRef,
  scrollY,
  svTop,
  svHeight,
  order,
  activeId,
  activeTop,
  grabOffset,
  fingerVY,
  onCommit,
  children,
}: {
  id: string;
  count: number;
  divider: boolean;
  dragEnabled: boolean;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  scrollY: SharedValue<number>;
  svTop: SharedValue<number>;
  svHeight: SharedValue<number>;
  order: SharedValue<string[]>;
  activeId: SharedValue<string | null>;
  activeTop: SharedValue<number>;
  grabOffset: SharedValue<number>;
  fingerVY: SharedValue<number>;
  onCommit: (order: string[]) => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const pan = Gesture.Pan()
    // Off while another mode (multi-select) owns row interaction — its own long-presses (range fill)
    // must not lift rows. A fresh recognizer is built every render, so the flag re-applies cleanly.
    .enabled(dragEnabled)
    // Long-press to lift, so a plain vertical drag still scrolls and a quick horizontal is the swipe.
    .activateAfterLongPress(200)
    .onStart((e) => {
      const m = measure(scrollRef);
      if (m) {
        svTop.set(m.pageY);
        svHeight.set(m.height);
      }
      const fvy = e.absoluteY - svTop.value;
      fingerVY.set(fvy);
      const fingerContentY = fvy + scrollY.value;
      grabOffset.set(fingerContentY - slotY(order.value, id));
      activeTop.set(fingerContentY - grabOffset.value);
      activeId.set(id);
      runOnJS(hapticImpactLight)();
    })
    .onUpdate((e) => {
      const fvy = e.absoluteY - svTop.value;
      fingerVY.set(fvy);
      activeTop.set(fvy + scrollY.value - grabOffset.value);
      reorderTo(order, id, activeTop.value, count);
    })
    .onEnd(() => {
      activeId.set(null);
      runOnJS(onCommit)(order.value);
    });

  const style = useAnimatedStyle(() => {
    const active = activeId.value === id;
    return {
      transform: [
        { translateY: active ? activeTop.value : withSpring(slotY(order.value, id), SPRING) },
        { scale: withSpring(active ? LIFT_SCALE : 1, SPRING) },
      ],
      zIndex: active ? 10 : 0,
      shadowColor: '#000',
      shadowOpacity: withSpring(active ? 0.2 : 0),
      shadowRadius: 10,
    };
  });

  return (
    <Animated.View style={[styles.rowAbs, style]}>
      <GestureDetector gesture={pan}>{children}</GestureDetector>
      {/* The same hairline SettingsSection draws between rows (left at the gutter, off the right). */}
      {divider && <View style={[styles.divider, { backgroundColor: theme.hairline }]} pointerEvents="none" />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  rowAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW,
  },
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: -SettingsGutter,
    height: StyleSheet.hairlineWidth,
  },
});
