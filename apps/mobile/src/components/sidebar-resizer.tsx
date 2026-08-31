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

/** Wider than the hairline it sits on: a 1pt grab target is a coin toss with a mouse and impossible
 *  with a finger. Centred over the border so the rail doesn't visibly gain padding. */
const HANDLE_WIDTH = Spacing.two + Spacing.one;

export function SidebarResizer({ width }: { width: number }) {
  const theme = useTheme();
  const dragging = useSharedValue(false);
  const live = useSharedValue(width);

  const gesture = Gesture.Pan()
    .onBegin(() => {
      live.value = width;
      dragging.value = true;
    })
    .onUpdate((e) => {
      // The POINTER's position, not `width + translationX`: a pan reports translation from where it
      // ACTIVATED, which is a threshold's distance after the press, so accumulating it left the edge
      // trailing the cursor by ~15pt for the whole drag. The rail starts at x = 0 (see
      // `sidebarWrap`), so the pointer's absolute x IS the width it is asking for.
      // Clamped on the UI thread with the same bounds the commit uses, so the guide can never show a
      // width the release won't honour.
      live.value = Math.min(SidebarMaxWidth, Math.max(SidebarMinWidth, e.absoluteX));
    })
    .onEnd(() => {
      runOnJS(setSidebarWidth)(live.value);
    })
    .onFinalize(() => {
      dragging.value = false;
    });

  const guide = useAnimatedStyle(() => ({
    opacity: dragging.value ? 1 : 0,
    transform: [{ translateX: live.value - width }],
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
