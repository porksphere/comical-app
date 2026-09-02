/**
 * The rail's drag-to-resize edge.
 *
 * The committed width is written ON RELEASE, not on every frame of the drag. Live-committing would
 * be more direct, but the width feeds `useContentWidth()`, so every screen inside the slot — and
 * `useGridLayout`'s column count and card width with it — would recompute per frame and relayout a
 * virtualized grid 60 times a second. Instead the drag moves a guide line on the UI thread, which
 * costs nothing, and the layout resolves once when you let go.
 *
 * That means the guide is the only feedback mid-drag, so it has to be visible: it is drawn at full
 * accent, at the width the rail WILL take, clamped exactly as the commit will clamp it — a guide
 * that promises a width the release then refuses is worse than no guide.
 */
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setSidebarWidth, SidebarMaxWidth, SidebarMinWidth } from '@/hooks/use-sidebar-width';
import { setSidebarDragWidth, sidebarDragWidth } from '@/lib/sidebar-drag';

/** Wider than the hairline it sits on: a 1pt grab target is a coin toss with a mouse and impossible
 *  with a finger. Centred over the border so the rail doesn't visibly gain padding. */
const HANDLE_WIDTH = Spacing.two + Spacing.one;

/** How far the rail may run ahead of the content before the inset is committed anyway. Small enough
 *  that the overlap reads as the edge leading slightly, large enough that a full drag costs a
 *  handful of relayouts rather than one per frame. */
const COMMIT_SLACK = 48;

/** The grid's own column rule (see `useGridLayout`), duplicated onto the UI thread because a worklet
 *  can't call it. If that rule changes, this has to change with it — the point is to commit at
 *  exactly the widths where the grid would reflow anyway, so a stale copy would commit at the wrong
 *  moments rather than merely being untidy. */
function columnsFor(contentWidth: number): number {
  'worklet';
  return contentWidth < 768 ? 3 : Math.min(6, Math.max(3, Math.floor(contentWidth / 200)));
}

export function SidebarResizer({ width, viewport }: { width: number; viewport: number }) {
  const theme = useTheme();
  const dragging = useSharedValue(false);
  // What the committed width currently represents. A commit fires when the drag would change the
  // COLUMN COUNT — not per pixel, which relayouts the grid for nothing, and not only on release,
  // which leaves the cards wrong for the whole gesture.
  const committedColumns = useSharedValue(0);
  // ...and a distance backstop, because column boundaries are ~200pt of travel apart. The rail is an
  // opaque overlay, so between commits it slides OVER content that hasn't been re-inset yet; without
  // this the overlap could reach the width of a whole column before anything caught up.
  const committedWidth = useSharedValue(0);

  const gesture = Gesture.Pan()
    .onBegin(() => {
      setSidebarDragWidth(width);
      committedColumns.value = columnsFor(viewport - width);
      committedWidth.value = width;
      dragging.value = true;
    })
    .onUpdate((e) => {
      // The POINTER's position, not `width + translationX`: a pan reports translation from where it
      // ACTIVATED, which is a threshold's distance after the press, so accumulating it left the edge
      // trailing the cursor by ~15pt for the whole drag. The rail starts at x = 0 (see
      // `sidebarWrap`), so the pointer's absolute x IS the width it is asking for.
      // Clamped on the UI thread with the same bounds the commit uses, so the guide can never show a
      // width the release won't honour.
      const next = Math.min(SidebarMaxWidth, Math.max(SidebarMinWidth, e.absoluteX));
      setSidebarDragWidth(next);
      const cols = columnsFor(viewport - next);
      if (cols !== committedColumns.value || Math.abs(next - committedWidth.value) > COMMIT_SLACK) {
        committedColumns.value = cols;
        committedWidth.value = next;
        runOnJS(setSidebarWidth)(next);
      }
    })
    .onEnd(() => {
      runOnJS(setSidebarWidth)(sidebarDragWidth.value);
    })
    .onFinalize(() => {
      dragging.value = false;
    });

  // The guide rides the live width the same way the rail does, so the two edges stay together while
  // the committed width lags behind them. The HIT AREA is left at the committed position on purpose:
  // a pan captures the pointer, so where the strip sits during the gesture never matters, and
  // animating it would mean an Animated.View that can't carry the web cursor.
  const guide = useAnimatedStyle(() => ({
    opacity: dragging.value ? 1 : 0,
    transform: [{ translateX: sidebarDragWidth.value - width }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      {/* A plain View, not an Animated one: the `col-resize` cursor is a web-only style key that
          Reanimated's style type doesn't carry, and only the guide inside needs to animate. */}
      <View
        testID="sidebar.resizer"
        // The hit area spans the rail's full height at its trailing edge; the visible guide inside it
        // is a line that only appears while dragging.
        style={[styles.handle, styles.webCursor, { left: width - HANDLE_WIDTH / 2 }]}>
        <Animated.View style={[styles.guide, { backgroundColor: theme.accent }, guide]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    zIndex: 20,
    alignItems: 'center',
  },
  // `col-resize` is a web cursor RN's `CursorValue` doesn't model (it allows only auto/pointer), so
  // it's cast the same way `FADE_TRANSITION` casts its web-only transition keys in `app-tabs`.
  webCursor: (Platform.OS === 'web' ? { cursor: 'col-resize' } : null) as unknown as ViewStyle,
  guide: {
    width: 2,
    height: '100%',
  },
});
